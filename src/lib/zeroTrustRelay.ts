/**
 * Zero-Trust Ephemeral Data Relay
 *
 * Implements NIP-XX for relaying encrypted data through Nostr relays
 * with zero trust assumptions. Security is cryptographic, not behavioral.
 *
 * Key properties:
 * - Relays see only throwaway keys (unlinkable to real identities)
 * - Content is E2E encrypted (relays see opaque blobs)
 * - Forward secrecy (keys deleted after use, past messages safe)
 * - No relay cooperation required (assume hostile relays)
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

// Event kinds for zero-trust relay
export const ZERO_TRUST_OUTER_KIND = 21111;
export const ZERO_TRUST_INNER_KIND = 21112;

// Utility functions
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function uint64ToBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = (num >> (i * 8)) & 0xff;
  }
  return bytes;
}

function secureDelete(arr: Uint8Array): void {
  arr.fill(0);
}

/**
 * Derive shared secret using ECDH
 */
function deriveSharedSecret(
  myPrivkey: Uint8Array,
  theirPubkey: Uint8Array
): Uint8Array {
  // Ensure pubkey is compressed (33 bytes with 02 prefix)
  // nostr-tools returns x-only 32-byte keys, but ECDH needs compressed format
  const compressedPubkey = theirPubkey.length === 32
    ? concatBytes(new Uint8Array([0x02]), theirPubkey)
    : theirPubkey;
  const sharedPoint = secp256k1.getSharedSecret(myPrivkey, compressedPubkey);
  // Remove the prefix byte and hash
  return sha256(sharedPoint.slice(1));
}

/**
 * Convert string to Uint8Array
 */
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Derive session key from shared secret and session ID
 */
function deriveSessionKey(
  sharedSecret: Uint8Array,
  sessionId: string
): Uint8Array {
  const salt = sha256(stringToBytes(sessionId));
  const info = stringToBytes('nip-xx-session-v1');
  return hkdf(sha256, sharedSecret, salt, info, 32);
}

/**
 * Derive per-message key for forward secrecy
 */
function deriveMessageKey(
  sessionKey: Uint8Array,
  sequenceNumber: number
): Uint8Array {
  const salt = uint64ToBytes(sequenceNumber);
  const info = stringToBytes('nip-xx-message-v1');
  return hkdf(sha256, sessionKey, salt, info, 32);
}

/**
 * Encrypt data with XChaCha20-Poly1305
 */
function encrypt(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  return concatBytes(nonce, ciphertext);
}

/**
 * Decrypt data with XChaCha20-Poly1305
 */
function decrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const nonce = data.slice(0, 24);
  const ciphertext = data.slice(24);
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Randomize timestamp within ±24 hours to prevent timing correlation
 */
function randomizeTimestamp(): number {
  const now = Math.floor(Date.now() / 1000);
  const offset = Math.floor(Math.random() * 172800) - 86400; // ±24 hours
  return now + offset;
}

/**
 * Session state for zero-trust communication
 */
export interface ZeroTrustSession {
  sessionId: string;
  sessionKey: Uint8Array;
  mySessionPubkey: string;
  theirSessionPubkey: string;
  currentThrowawayPrivkey: Uint8Array;
  currentThrowawayPubkey: string;
  theirThrowawayPubkey: string;
  sequenceNumber: number;
  lastReceivedSeq: number;
}

/**
 * Create a new zero-trust session
 */
export function createSession(
  sessionId: string,
  myPrivkey: Uint8Array,
  theirPubkey: string
): ZeroTrustSession {
  const myPubkey = getPublicKey(myPrivkey);
  const theirPubkeyBytes = hexToBytes(theirPubkey);

  // Derive session key
  const sharedSecret = deriveSharedSecret(myPrivkey, theirPubkeyBytes);
  const sessionKey = deriveSessionKey(sharedSecret, sessionId);

  // Generate first throwaway keypair
  const throwawayPrivkey = generateSecretKey();
  const throwawayPubkey = getPublicKey(throwawayPrivkey);

  // Clean up shared secret (no longer needed)
  secureDelete(sharedSecret);

  return {
    sessionId,
    sessionKey,
    mySessionPubkey: myPubkey,
    theirSessionPubkey: theirPubkey,
    currentThrowawayPrivkey: throwawayPrivkey,
    currentThrowawayPubkey: throwawayPubkey,
    theirThrowawayPubkey: '', // Will be set when we receive their first message or from QR
    sequenceNumber: 0,
    lastReceivedSeq: -1,
  };
}

/**
 * Set the recipient's throwaway pubkey (from QR code or first message)
 */
export function setTheirThrowaway(
  session: ZeroTrustSession,
  theirThrowawayPubkey: string
): void {
  session.theirThrowawayPubkey = theirThrowawayPubkey;
}

/**
 * Build a zero-trust encrypted message
 * Returns the outer event ready to publish to relays
 */
export function buildZeroTrustMessage(
  session: ZeroTrustSession,
  payload: object,
  includeNextThrowaway: boolean = true
): { event: NostrEvent; nextThrowaway: string } {
  // Generate next throwaway for key rotation
  const nextThrowawayPrivkey = generateSecretKey();
  const nextThrowawayPubkey = getPublicKey(nextThrowawayPrivkey);

  // 1. Derive per-message key (forward secrecy)
  const messageKey = deriveMessageKey(session.sessionKey, session.sequenceNumber);

  // 2. Build inner event
  const innerTags: string[][] = [
    ['session', session.sessionId],
    ['seq', String(session.sequenceNumber)],
  ];
  if (session.lastReceivedSeq >= 0) {
    innerTags.push(['ack', String(session.lastReceivedSeq)]);
  }
  if (includeNextThrowaway) {
    innerTags.push(['next_throwaway', nextThrowawayPubkey]);
  }

  const innerEvent = {
    kind: ZERO_TRUST_INNER_KIND,
    pubkey: session.mySessionPubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify(payload),
    tags: innerTags,
  };

  // 3. Encrypt inner event with message key
  const innerPlaintext = new TextEncoder().encode(JSON.stringify(innerEvent));
  const innerCiphertext = encrypt(messageKey, innerPlaintext);

  // 4. Generate throwaway keypair for this message
  const outerThrowawayPrivkey = generateSecretKey();
  // Note: pubkey is derived by finalizeEvent from privkey
  const _outerThrowawayPubkey = getPublicKey(outerThrowawayPrivkey);

  // 5. Derive outer encryption key from ECDH with recipient's throwaway
  const outerSharedSecret = deriveSharedSecret(
    outerThrowawayPrivkey,
    hexToBytes(session.theirThrowawayPubkey)
  );

  // 6. Encrypt inner ciphertext for outer envelope
  const outerCiphertext = encrypt(outerSharedSecret, innerCiphertext);

  // 7. Build outer event with randomized timestamp
  const outerEvent = finalizeEvent({
    kind: ZERO_TRUST_OUTER_KIND,
    created_at: randomizeTimestamp(),
    content: bytesToBase64(outerCiphertext),
    tags: [['p', session.theirThrowawayPubkey]],
  }, outerThrowawayPrivkey) as NostrEvent;

  // 8. Increment sequence number
  session.sequenceNumber++;

  // 9. Rotate throwaway keys
  secureDelete(session.currentThrowawayPrivkey);
  session.currentThrowawayPrivkey = nextThrowawayPrivkey;
  session.currentThrowawayPubkey = nextThrowawayPubkey;

  // 10. Securely delete temporary keys
  secureDelete(messageKey);
  secureDelete(outerSharedSecret);
  secureDelete(outerThrowawayPrivkey);

  return { event: outerEvent, nextThrowaway: nextThrowawayPubkey };
}

/**
 * Decrypt a zero-trust message
 * Returns the payload and updates session state
 */
export function decryptZeroTrustMessage(
  session: ZeroTrustSession,
  event: NostrEvent
): { payload: object; senderNextThrowaway?: string } | null {
  try {
    // 1. Derive outer decryption key
    const senderOuterPubkey = hexToBytes(event.pubkey);
    const outerSharedSecret = deriveSharedSecret(
      session.currentThrowawayPrivkey,
      senderOuterPubkey
    );

    // 2. Decrypt outer layer
    const outerCiphertext = base64ToBytes(event.content);
    const innerCiphertext = decrypt(outerSharedSecret, outerCiphertext);

    // 3. Try to decrypt inner layer with recent sequence numbers
    // (in case of out-of-order delivery)
    let innerEvent: {
      kind: number;
      pubkey: string;
      content: string;
      tags: string[][];
    } | null = null;
    let successSeq = -1;

    // Try sequence numbers around what we expect
    const expectedSeq = session.lastReceivedSeq + 1;
    const seqsToTry = [
      expectedSeq,
      expectedSeq + 1,
      expectedSeq + 2,
      expectedSeq - 1, // In case of reordering
    ].filter(s => s >= 0);

    for (const seq of seqsToTry) {
      try {
        const messageKey = deriveMessageKey(session.sessionKey, seq);
        const innerPlaintext = decrypt(messageKey, innerCiphertext);
        innerEvent = JSON.parse(new TextDecoder().decode(innerPlaintext));
        successSeq = seq;
        secureDelete(messageKey);
        break;
      } catch {
        // Wrong sequence, try next
      }
    }

    if (!innerEvent || successSeq < 0) {
      console.error('[ZeroTrust] Failed to decrypt with any expected sequence number');
      secureDelete(outerSharedSecret);
      return null;
    }

    // 4. Update session state
    session.lastReceivedSeq = Math.max(session.lastReceivedSeq, successSeq);

    // 5. Extract sender's next throwaway for our next message to them
    const nextThrowawayTag = innerEvent.tags.find(t => t[0] === 'next_throwaway');
    const senderNextThrowaway = nextThrowawayTag?.[1];

    if (senderNextThrowaway) {
      session.theirThrowawayPubkey = senderNextThrowaway;
    }

    // 6. Parse payload
    const payload = JSON.parse(innerEvent.content);

    // 7. Clean up
    secureDelete(outerSharedSecret);

    return { payload, senderNextThrowaway };
  } catch (error) {
    console.error('[ZeroTrust] Decryption failed:', error);
    return null;
  }
}

/**
 * Clean up session (securely delete all keys)
 */
export function destroySession(session: ZeroTrustSession): void {
  secureDelete(session.sessionKey);
  secureDelete(session.currentThrowawayPrivkey);
}

/**
 * Get the current throwaway pubkey to share with the other party
 * (e.g., include in QR code or initial handshake)
 */
export function getThrowawayPubkey(session: ZeroTrustSession): string {
  return session.currentThrowawayPubkey;
}

/**
 * Create session data for QR code / share code
 */
export interface SessionHandshake {
  sessionId: string;
  sessionPubkey: string;
  throwawayPubkey: string;
  relays: string[];
}

export function createHandshakeData(
  session: ZeroTrustSession,
  relays: string[]
): SessionHandshake {
  return {
    sessionId: session.sessionId,
    sessionPubkey: session.mySessionPubkey,
    throwawayPubkey: session.currentThrowawayPubkey,
    relays,
  };
}
