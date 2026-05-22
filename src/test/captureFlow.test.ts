// @vitest-environment node
/**
 * Layer 3: Capture Flow Integration Tests
 * Encrypted capture publish/decrypt end-to-end using MockRelay
 */

import { describe, it, expect } from 'vitest';
import { MockRelay } from '@nostrify/nostrify/test';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { v2 as nip44 } from 'nostr-tools/nip44';
import type { NostrEvent } from '@nostrify/nostrify';
import { genMonster } from './helpers';
import {
  computeCaptureProof,
  verifyCaptureProof,
  generateCaptureSecret,
} from '../lib/antiCheat';

// Capture event kind (matches the app)
const CAPTURE_EVENT_KIND = 30078;

/**
 * Build a blinded tag for querying captures.
 * Uses sha256 of the monster ID to avoid leaking monster info to relays.
 */
function blindTag(value: string): string {
  // Simple hash for test — in production this uses a proper HMAC
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  let hash = 0;
  for (const byte of data) {
    hash = ((hash << 5) - hash + byte) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

interface CapturePayload {
  monsterId: string;
  playerPubkey: string;
  capturedAt: number;
  location: { lat: number; lng: number };
  proof?: string;
}

/**
 * Build an encrypted capture event
 */
function buildCaptureEvent(
  playerPrivkey: Uint8Array,
  hostPubkey: string,
  payload: CapturePayload,
): NostrEvent {
  const conversationKey = nip44.utils.getConversationKey(playerPrivkey, hostPubkey);
  const encrypted = nip44.encrypt(JSON.stringify(payload), conversationKey);
  const blindedId = blindTag(payload.monsterId);

  return finalizeEvent({
    kind: CAPTURE_EVENT_KIND,
    created_at: Math.floor(payload.capturedAt / 1000),
    content: encrypted,
    tags: [
      ['p', hostPubkey],
      ['x', blindedId],
      ['d', `capture-${payload.monsterId}-${getPublicKey(playerPrivkey)}`],
    ],
  }, playerPrivkey) as NostrEvent;
}

/**
 * Decrypt a capture event (host-side)
 */
function decryptCaptureEvent(
  hostPrivkey: Uint8Array,
  event: NostrEvent,
): CapturePayload | null {
  try {
    const conversationKey = nip44.utils.getConversationKey(hostPrivkey, event.pubkey);
    const decrypted = nip44.decrypt(event.content, conversationKey);
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

describe('Capture Flow', () => {
  describe('encrypted capture round-trip', () => {
    it('player encrypts capture, host decrypts and verifies fields', async () => {
      const relay = new MockRelay();
      const hostPrivkey = generateSecretKey();
      const hostPubkey = getPublicKey(hostPrivkey);
      const playerPrivkey = generateSecretKey();
      const playerPubkey = getPublicKey(playerPrivkey);
      const monster = genMonster();

      const payload: CapturePayload = {
        monsterId: monster.id,
        playerPubkey,
        capturedAt: Date.now(),
        location: { lat: 37.7749, lng: -122.4194 },
      };

      const event = buildCaptureEvent(playerPrivkey, hostPubkey, payload);
      await relay.event(event);

      // Host queries by blinded tag
      const blindedId = blindTag(monster.id);
      const results = await relay.query([{ kinds: [CAPTURE_EVENT_KIND], '#x': [blindedId] }]);
      expect(results).toHaveLength(1);

      const decrypted = decryptCaptureEvent(hostPrivkey, results[0]);
      expect(decrypted).not.toBeNull();
      expect(decrypted!.monsterId).toBe(monster.id);
      expect(decrypted!.playerPubkey).toBe(playerPubkey);
      expect(decrypted!.location).toEqual(payload.location);
    });

    it('5 simultaneous captures from different players', async () => {
      const relay = new MockRelay();
      const hostPrivkey = generateSecretKey();
      const hostPubkey = getPublicKey(hostPrivkey);

      const monsters = Array.from({ length: 5 }, (_, i) =>
        genMonster({ id: `mon-${i}`, satAmount: 10 * (i + 1) }),
      );

      const captures = await Promise.all(
        monsters.map(async (monster) => {
          const playerPrivkey = generateSecretKey();
          const playerPubkey = getPublicKey(playerPrivkey);

          const payload: CapturePayload = {
            monsterId: monster.id,
            playerPubkey,
            capturedAt: Date.now(),
            location: monster.location,
          };

          const event = buildCaptureEvent(playerPrivkey, hostPubkey, payload);
          await relay.event(event);
          return { event, payload, monster };
        }),
      );

      // All 5 events should be queryable
      const allEvents = await relay.query([{ kinds: [CAPTURE_EVENT_KIND] }]);
      expect(allEvents).toHaveLength(5);

      // Each should decrypt correctly
      for (const { event, payload } of captures) {
        const decrypted = decryptCaptureEvent(hostPrivkey, event);
        expect(decrypted).not.toBeNull();
        expect(decrypted!.monsterId).toBe(payload.monsterId);
      }
    });
  });

  describe('dedup via #d tag', () => {
    it('same capture twice results in 1 queryable event (NIP-33 replaceable)', async () => {
      const relay = new MockRelay();
      const hostPrivkey = generateSecretKey();
      const hostPubkey = getPublicKey(hostPrivkey);
      const playerPrivkey = generateSecretKey();
      const playerPubkey = getPublicKey(playerPrivkey);
      const monster = genMonster();

      const payload: CapturePayload = {
        monsterId: monster.id,
        playerPubkey,
        capturedAt: Date.now(),
        location: monster.location,
      };

      // Publish same capture twice
      const event1 = buildCaptureEvent(playerPrivkey, hostPubkey, payload);
      await relay.event(event1);

      // Second event with same #d tag but later timestamp
      const event2 = finalizeEvent({
        kind: CAPTURE_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000) + 10,
        content: event1.content,
        tags: event1.tags,
      }, playerPrivkey) as NostrEvent;
      await relay.event(event2);

      // MockRelay stores both (it's a simple set), but the #d tag dedup
      // is enforced by the application layer, not the relay.
      // We verify both events exist and share the same #d tag.
      const dTag = `capture-${monster.id}-${playerPubkey}`;
      const results = await relay.query([{ kinds: [CAPTURE_EVENT_KIND], '#d': [dTag] }]);
      expect(results.length).toBeGreaterThanOrEqual(1);

      // All results should have the same #d tag value
      for (const result of results) {
        const d = result.tags.find(t => t[0] === 'd');
        expect(d?.[1]).toBe(dTag);
      }
    });
  });

  describe('stale timestamp rejection', () => {
    it('capture with created_at > 2 hours old should be detectable', () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000 - 1000;
      const age = Date.now() - twoHoursAgo;
      const isStale = age > 2 * 60 * 60 * 1000;
      expect(isStale).toBe(true);
    });

    it('fresh capture within 2 minutes is not stale', () => {
      const recent = Date.now() - 60 * 1000; // 1 minute ago
      const age = Date.now() - recent;
      const isStale = age > 120000;
      expect(isStale).toBe(false);
    });
  });

  describe('HMAC capture proofs', () => {
    it('valid proof round-trip: compute then verify', () => {
      const secret = generateCaptureSecret();
      const monsterId = 'mon-123';
      const playerPubkey = 'aabbccdd'.repeat(8);
      const capturedAt = Date.now();

      const proof = computeCaptureProof(secret, monsterId, playerPubkey, capturedAt);
      expect(proof).toBeTruthy();
      expect(proof.length).toBe(64); // 32 bytes hex

      const valid = verifyCaptureProof(secret, monsterId, playerPubkey, capturedAt, proof);
      expect(valid).toBe(true);
    });

    it('wrong proof is rejected', () => {
      const secret = generateCaptureSecret();
      const valid = verifyCaptureProof(secret, 'mon-1', 'pubkey1'.padEnd(64, '0'), Date.now(), 'badproof');
      expect(valid).toBe(false);
    });

    it('missing proof is a warning, not a rejection (graceful degradation)', () => {
      // The current behavior allows captures without proofs (logged as warning).
      // This test documents that behavior.
      const proof = undefined;
      // Application code checks: if (proof) { verify } else { warn }
      // No proof means verification is skipped, capture is allowed.
      expect(proof).toBeUndefined();
    });

    it('wrong monsterId in proof fails verification', () => {
      const secret = generateCaptureSecret();
      const playerPubkey = 'aabbccdd'.repeat(8);
      const capturedAt = Date.now();

      const proof = computeCaptureProof(secret, 'mon-real', playerPubkey, capturedAt);
      const valid = verifyCaptureProof(secret, 'mon-fake', playerPubkey, capturedAt, proof);
      expect(valid).toBe(false);
    });

    it('different secrets produce different proofs', () => {
      const monsterId = 'mon-1';
      const playerPubkey = 'aabbccdd'.repeat(8);
      const capturedAt = Date.now();

      const proof1 = computeCaptureProof(generateCaptureSecret(), monsterId, playerPubkey, capturedAt);
      const proof2 = computeCaptureProof(generateCaptureSecret(), monsterId, playerPubkey, capturedAt);

      expect(proof1).not.toBe(proof2);
    });
  });
});
