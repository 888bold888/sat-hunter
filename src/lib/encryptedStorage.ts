/**
 * Encrypted Storage
 *
 * Encrypts sensitive data (NWC credentials) at rest using AES-256-GCM.
 * Encryption key is derived from the user's Nostr signer — no extra PIN needed.
 *
 * Flow:
 * 1. Ask signer to sign deterministic message → sha256(signature) = encryption key
 * 2. AES-256-GCM encrypt before writing to localStorage
 * 3. On load: re-derive key from signer → decrypt
 *
 * Privacy: No server, no network calls, no third-party auth. Key never leaves memory.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { NostrSigner } from '@nostrify/nostrify';

// Deterministic message signed to derive encryption key
const STORAGE_KEY_MESSAGE = 'sathunter:storage-key:v1';

interface EncryptedBlob {
  iv: string;         // hex-encoded 12-byte IV
  ciphertext: string; // hex-encoded ciphertext
  version: 1;
}

/**
 * Derive an AES-256-GCM key from a Nostr signer.
 * Signs a deterministic message and hashes the signature.
 */
export async function deriveStorageKey(signer: NostrSigner): Promise<CryptoKey> {
  // Sign a deterministic event to get stable key material
  const event = await signer.signEvent({
    kind: 27235, // NIP-98 HTTP Auth (harmless, won't be published)
    created_at: 0, // Fixed timestamp for deterministic output
    content: STORAGE_KEY_MESSAGE,
    tags: [],
  });

  // Hash the signature to get 256-bit key material
  const keyMaterial = sha256(hexToBytes(event.sig));

  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a string with AES-256-GCM.
 */
export async function encryptData(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  const blob: EncryptedBlob = {
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
    version: 1,
  };

  return JSON.stringify(blob);
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * Returns null if decryption fails (wrong key or corrupted data).
 */
export async function decryptData(key: CryptoKey, encrypted: string): Promise<string | null> {
  try {
    const blob: EncryptedBlob = JSON.parse(encrypted);
    if (blob.version !== 1) return null;

    const iv = hexToBytes(blob.iv);
    const ciphertext = hexToBytes(blob.ciphertext);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
