/**
 * Session Keypair for P2P Signaling
 *
 * Generates ephemeral keypairs for P2P WebRTC signaling events.
 * This eliminates browser extension signing prompts (Alby, nos2x, etc.)
 * while still allowing verification of the user's real identity via tags.
 *
 * Session keys are stored in sessionStorage and cleared on browser close.
 */

import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

interface P2PEventTemplate {
  kind: number;
  created_at?: number;
  content: string;
  tags: string[][];
}

const SESSION_KEY_STORAGE = 'sathunter:session-key';

interface SessionKey {
  secretKey: Uint8Array;
  pubkey: string;
}

let cachedSessionKey: SessionKey | null = null;

/**
 * Get or create session keypair for P2P signing
 * Keys persist in sessionStorage for the browser session
 */
export function getSessionKey(): SessionKey {
  // Return cached key if available
  if (cachedSessionKey) {
    return cachedSessionKey;
  }

  // Try to restore from sessionStorage
  const stored = sessionStorage.getItem(SESSION_KEY_STORAGE);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const secretKey = new Uint8Array(parsed.secretKey);
      const pubkey = getPublicKey(secretKey);
      cachedSessionKey = { secretKey, pubkey };
      return cachedSessionKey;
    } catch {
      // Invalid stored key, generate new one
    }
  }

  // Generate new session key
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  cachedSessionKey = { secretKey, pubkey };

  // Store in sessionStorage (cleared on browser close)
  sessionStorage.setItem(SESSION_KEY_STORAGE, JSON.stringify({
    secretKey: Array.from(secretKey),
    pubkey,
  }));

  return cachedSessionKey;
}

/**
 * Sign a Nostr event with the session key
 * No browser extension prompt required
 */
export function signWithSessionKey(template: P2PEventTemplate): NostrEvent {
  const sessionKey = getSessionKey();

  // finalizeEvent adds id, pubkey, sig to the template
  return finalizeEvent(
    {
      kind: template.kind,
      created_at: template.created_at ?? Math.floor(Date.now() / 1000),
      content: template.content,
      tags: template.tags,
    },
    sessionKey.secretKey
  ) as NostrEvent;
}

/**
 * Clear session key (useful for testing or logout)
 */
export function clearSessionKey(): void {
  cachedSessionKey = null;
  sessionStorage.removeItem(SESSION_KEY_STORAGE);
}

/**
 * Get the session pubkey without exposing the secret key
 */
export function getSessionPubkey(): string {
  return getSessionKey().pubkey;
}
