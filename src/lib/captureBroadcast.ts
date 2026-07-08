/**
 * Capture-state broadcast primitives (Tier 2, tasks/goals/shared-creature-state.md)
 *
 * Stateless, self-healing host->player broadcast of the authoritative captured
 * state over the ephemeral zero-trust relay (outer kind 21111). Mirrors the
 * crypto style of zeroTrustRelay.ts but WITHOUT per-player sessions or seq
 * windows, so any participant can decrypt any broadcast at any time.
 *
 * Authenticity: the encryption only proves hunt membership (the cast keypair is
 * derived from the shareCode, which every participant knows). Host authenticity
 * comes from a SIGNED inner Nostr event under an ephemeral per-hunt broadcast
 * key announced in the encrypted hello. Consumers MUST verifyEvent + match the
 * expected host broadcast pubkey + enforce the freshness window before acting.
 *
 * NEVER log, print, or persist privkeys or the derived cast privkey.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { ZERO_TRUST_OUTER_KIND } from './zeroTrustRelay';

// Signed inner payload kind — ephemeral range (relays forward but don't store).
export const CAPTURE_STATE_INNER_KIND = 21113;

// Freshness window for the signed inner event (lessons.md: 5 min balances clock
// skew against replay). Full-state is idempotent, so replays are harmless too.
export const MAX_CAPTURE_STATE_AGE_SECONDS = 300;

export interface CaptureStateEntry {
  monsterId: string;
  capturedAt: number;
  winnerProof: string;
}

export interface CaptureStatePayload {
  type: 'capture_state';
  huntId: string;
  stateVersion: number;
  entries: CaptureStateEntry[];
}

// --- low-level helpers (same @noble primitives / wire format as zeroTrustRelay) ---

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
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

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

// ECDH shared secret (compressed pubkey, hashed) — identical to zeroTrustRelay.
function deriveSharedSecret(myPrivkey: Uint8Array, theirPubkey: Uint8Array): Uint8Array {
  const compressedPubkey = theirPubkey.length === 32
    ? concatBytes(new Uint8Array([0x02]), theirPubkey)
    : theirPubkey;
  const sharedPoint = secp256k1.getSharedSecret(myPrivkey, compressedPubkey);
  return sha256(sharedPoint.slice(1));
}

function encrypt(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(key, nonce);
  return concatBytes(nonce, cipher.encrypt(plaintext));
}

function decrypt(key: Uint8Array, data: Uint8Array): Uint8Array {
  const nonce = data.slice(0, 24);
  const ciphertext = data.slice(24);
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}

// --- public API ---

/**
 * Well-known per-hunt "cast" keypair derived deterministically from the
 * shareCode. Every participant derives it; a relay observer cannot (they'd need
 * the shareCode — same secrecy level as the PSK). Used only as the broadcast
 * channel address; it does NOT authenticate the host (see file header).
 */
export function deriveCastKeypair(shareCode: string): { privkey: Uint8Array; pubkey: string } {
  // sha256 the domain-separated shareCode, then keep hashing until the 32 bytes
  // land in the valid secp256k1 scalar range (overwhelmingly the first try).
  let material = sha256(new TextEncoder().encode(`sat-hunter-cast:${shareCode}`));
  while (!secp256k1.utils.isValidSecretKey(material)) {
    material = sha256(material);
  }
  return { privkey: material, pubkey: getPublicKey(material) };
}

/**
 * winnerProof = sha256("{monsterId}:{winnerPubkey}") hex. Lets a player answer
 * "did I win this monster?" for rollback UX without the broadcast ever carrying
 * any real npub (winner privacy — goal file Tier 2).
 */
export function computeWinnerProof(monsterId: string, winnerPubkey: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${monsterId}:${winnerPubkey}`)));
}

/**
 * Build an encrypted outer kind-21111 event carrying a SIGNED inner capture_state
 * event under the host's ephemeral broadcast key. One event per broadcast
 * regardless of player count; players subscribe on '#p' = castPubkey.
 */
export function buildCaptureStateEvent(
  hostBroadcastPrivkey: Uint8Array,
  castPubkey: string,
  huntId: string,
  stateVersion: number,
  entries: CaptureStateEntry[]
): NostrEvent {
  const payload: CaptureStatePayload = { type: 'capture_state', huntId, stateVersion, entries };

  // 1. Signed inner event authenticates the host (verifyEvent + pubkey match on
  //    the receiving side). created_at drives the freshness window.
  const innerEvent = finalizeEvent({
    kind: CAPTURE_STATE_INNER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify(payload),
    tags: [],
  }, hostBroadcastPrivkey);

  const innerJson = new TextEncoder().encode(JSON.stringify(innerEvent));

  // 2. Encrypt the signed-event JSON for the cast channel with a fresh ephemeral
  //    sender key (unlinkable outer author, matching zeroTrustRelay's shape).
  const ephemeralPrivkey = generateSecretKey();
  const sharedSecret = deriveSharedSecret(ephemeralPrivkey, hexToBytes(castPubkey));
  const ciphertext = encrypt(sharedSecret, innerJson);

  const outerEvent = finalizeEvent({
    kind: ZERO_TRUST_OUTER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: bytesToBase64(ciphertext),
    tags: [['p', castPubkey]],
  }, ephemeralPrivkey) as NostrEvent;

  ephemeralPrivkey.fill(0);
  sharedSecret.fill(0);

  return outerEvent;
}

/**
 * Decrypt + fully validate a broadcast. Returns the payload only if the inner
 * event is a valid signature, signed by expectedHostBroadcastPubkey, of the
 * right kind, within the freshness window, and well-formed. Returns null
 * otherwise. Never logs keys.
 */
export function decryptCaptureStateEvent(
  castPrivkey: Uint8Array,
  outerEvent: NostrEvent,
  expectedHostBroadcastPubkey: string,
  opts?: { maxAgeSeconds?: number; now?: number }
): CaptureStatePayload | null {
  try {
    const maxAge = opts?.maxAgeSeconds ?? MAX_CAPTURE_STATE_AGE_SECONDS;

    // 1. Decrypt outer envelope (ECDH with the ephemeral sender's pubkey).
    const sharedSecret = deriveSharedSecret(castPrivkey, hexToBytes(outerEvent.pubkey));
    const innerJson = decrypt(sharedSecret, base64ToBytes(outerEvent.content));
    sharedSecret.fill(0);

    const innerEvent = JSON.parse(new TextDecoder().decode(innerJson)) as NostrEvent;

    // 2. Host authenticity: valid signature + expected signer + expected kind.
    if (!verifyEvent(innerEvent)) return null;
    if (innerEvent.pubkey !== expectedHostBroadcastPubkey) return null;
    if (innerEvent.kind !== CAPTURE_STATE_INNER_KIND) return null;

    // 3. Freshness window (replay protection).
    const now = opts?.now ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - innerEvent.created_at) > maxAge) return null;

    // 4. Parse + shape-check payload.
    const payload = JSON.parse(innerEvent.content) as CaptureStatePayload;
    if (payload.type !== 'capture_state' || !Array.isArray(payload.entries)) return null;

    return payload;
  } catch {
    // Any decrypt/parse failure = not a valid broadcast for us.
    return null;
  }
}
