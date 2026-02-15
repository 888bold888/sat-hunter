/**
 * Encrypted Storage
 *
 * Encrypts sensitive data (NWC credentials) at rest using AES-256-GCM.
 * Encryption key is a random 256-bit key, wrapped (encrypted) via NIP-44
 * to the user's own pubkey. This ensures the key is stable across page loads
 * since NIP-44 decryption is deterministic (same privkey + ciphertext = same plaintext).
 *
 * Flow:
 * 1. First use: generate random AES key → wrap with NIP-44 encrypt-to-self → store wrapped key
 * 2. On load: unwrap key via NIP-44 decrypt-from-self → use for AES-256-GCM
 *
 * Privacy: No server, no network calls, no third-party auth. Key never leaves memory.
 */

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { NostrSigner } from '@nostrify/nostrify';

const WRAPPED_KEY_STORAGE = 'sathunter:wrapped-storage-key';

interface EncryptedBlob {
  iv: string;         // hex-encoded 12-byte IV
  ciphertext: string; // hex-encoded ciphertext
  version: 1;
}

/**
 * Derive a stable AES-256-GCM key from a Nostr signer.
 *
 * Uses NIP-44 encrypt-to-self to wrap a random key. On subsequent loads,
 * unwraps the same key via NIP-44 decrypt. Falls back to NIP-04 if NIP-44
 * is unavailable.
 */
export async function deriveStorageKey(signer: NostrSigner): Promise<CryptoKey> {
  const pubkey = await getSignerPubkey(signer);
  const { encrypt, decrypt } = getEncryptionMethods(signer);

  // Try to unwrap an existing key
  const wrappedKey = localStorage.getItem(WRAPPED_KEY_STORAGE);
  if (wrappedKey) {
    try {
      const keyHex = await decrypt(pubkey, wrappedKey);
      return crypto.subtle.importKey(
        'raw',
        hexToBytes(keyHex),
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
      );
    } catch {
      // Wrapped key is corrupted or from a different signer — generate a new one
      console.warn('Failed to unwrap storage key, generating new one');
      localStorage.removeItem(WRAPPED_KEY_STORAGE);
    }
  }

  // Generate a new random key and wrap it
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const keyHex = bytesToHex(rawKey);
  const wrapped = await encrypt(pubkey, keyHex);
  localStorage.setItem(WRAPPED_KEY_STORAGE, wrapped);

  return crypto.subtle.importKey(
    'raw',
    rawKey,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Get the signer's public key.
 */
async function getSignerPubkey(signer: NostrSigner): Promise<string> {
  if (signer.getPublicKey) {
    return signer.getPublicKey();
  }
  // Fallback: sign a throwaway event to extract pubkey
  const event = await signer.signEvent({
    kind: 0,
    created_at: 0,
    content: '',
    tags: [],
  });
  return event.pubkey;
}

/**
 * Get NIP-44 (preferred) or NIP-04 (fallback) encrypt/decrypt methods.
 */
function getEncryptionMethods(signer: NostrSigner): {
  encrypt: (pubkey: string, plaintext: string) => Promise<string>;
  decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
} {
  if (signer.nip44) {
    return {
      encrypt: (pubkey, plaintext) => signer.nip44!.encrypt(pubkey, plaintext),
      decrypt: (pubkey, ciphertext) => signer.nip44!.decrypt(pubkey, ciphertext),
    };
  }
  if (signer.nip04) {
    return {
      encrypt: (pubkey, plaintext) => signer.nip04!.encrypt(pubkey, plaintext),
      decrypt: (pubkey, ciphertext) => signer.nip04!.decrypt(pubkey, ciphertext),
    };
  }
  throw new Error('Signer does not support NIP-44 or NIP-04 encryption');
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
