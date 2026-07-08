// @vitest-environment node
// Pure crypto — node env because jsdom's Uint8Array breaks @noble/hashes.
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  deriveCastKeypair,
  buildCaptureStateEvent,
  decryptCaptureStateEvent,
  computeWinnerProof,
  CAPTURE_STATE_INNER_KIND,
  type CaptureStateEntry,
} from '@/lib/captureBroadcast';
import { ZERO_TRUST_OUTER_KIND } from '@/lib/zeroTrustRelay';

const SHARE = 'ABC123';
const HUNT_ID = 'hunt-1';

function entries(): CaptureStateEntry[] {
  return [
    { monsterId: 'mon-1', capturedAt: 1000, winnerProof: 'proof-1' },
    { monsterId: 'mon-2', capturedAt: 2000, winnerProof: 'proof-2' },
  ];
}

// Test-only helper mirroring buildCaptureStateEvent's outer-envelope encryption
// so we can inject a pre-tampered inner event.
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
function wrapInnerForCast(inner: NostrEvent, castPubkey: string): NostrEvent {
  const ephemeral = generateSecretKey();
  const compressed = concatBytes(new Uint8Array([0x02]), hexToBytes(castPubkey));
  const shared = sha256(secp256k1.getSharedSecret(ephemeral, compressed).slice(1));
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(shared, nonce).encrypt(new TextEncoder().encode(JSON.stringify(inner)));
  const content = btoa(String.fromCharCode(...concatBytes(nonce, ct)));
  return finalizeEvent({
    kind: ZERO_TRUST_OUTER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content,
    tags: [['p', castPubkey]],
  }, ephemeral) as NostrEvent;
}

describe('captureBroadcast (Tier 2 authoritative capture-state)', () => {
  it('round-trip: host builds, player decrypts + verifies with the correct host broadcast pubkey', () => {
    const hostPrivkey = generateSecretKey();
    const hostPubkey = getPublicKey(hostPrivkey);
    const cast = deriveCastKeypair(SHARE);

    const outer = buildCaptureStateEvent(hostPrivkey, cast.pubkey, HUNT_ID, 42, entries());
    expect(outer.kind).toBe(ZERO_TRUST_OUTER_KIND);
    expect(outer.tags).toContainEqual(['p', cast.pubkey]);

    const payload = decryptCaptureStateEvent(cast.privkey, outer, hostPubkey);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe('capture_state');
    expect(payload!.huntId).toBe(HUNT_ID);
    expect(payload!.stateVersion).toBe(42);
    expect(payload!.entries).toEqual(entries());
  });

  it('FORGERY: a broadcast signed by a different (attacker) key is REJECTED even with valid cast encryption', () => {
    const hostPrivkey = generateSecretKey();
    const hostPubkey = getPublicKey(hostPrivkey);
    const attackerPrivkey = generateSecretKey();
    const cast = deriveCastKeypair(SHARE);

    // Attacker knows the shareCode (hunt member) so the cast encryption is valid,
    // but signs the inner event with their own key, not the host's.
    const forged = buildCaptureStateEvent(attackerPrivkey, cast.pubkey, HUNT_ID, 99, entries());

    // Player requires pubkey === expected host broadcast pubkey.
    expect(decryptCaptureStateEvent(cast.privkey, forged, hostPubkey)).toBeNull();
    // Sanity: it WOULD decrypt if the player trusted the attacker's key.
    expect(decryptCaptureStateEvent(cast.privkey, forged, getPublicKey(attackerPrivkey))).not.toBeNull();
  });

  it('tampered inner content (bit-flipped after signing) is rejected by verifyEvent', () => {
    const hostPrivkey = generateSecretKey();
    const hostPubkey = getPublicKey(hostPrivkey);
    const cast = deriveCastKeypair(SHARE);

    // Build a valid inner event, then tamper its content before encrypting so the
    // signature no longer matches.
    const inner = finalizeEvent({
      kind: CAPTURE_STATE_INNER_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: JSON.stringify({ type: 'capture_state', huntId: HUNT_ID, stateVersion: 1, entries: entries() }),
      tags: [],
    }, hostPrivkey);
    const tampered = { ...inner, content: inner.content.replace('mon-1', 'mon-X') } as NostrEvent;

    const outer = wrapInnerForCast(tampered, cast.pubkey);
    expect(decryptCaptureStateEvent(cast.privkey, outer, hostPubkey)).toBeNull();
  });

  it('stale created_at (> freshness window) is rejected', () => {
    const hostPrivkey = generateSecretKey();
    const hostPubkey = getPublicKey(hostPrivkey);
    const cast = deriveCastKeypair(SHARE);

    const outer = buildCaptureStateEvent(hostPrivkey, cast.pubkey, HUNT_ID, 1, entries());
    // Evaluate freshness 10 minutes in the future — outside the 5-min window.
    const future = Math.floor(Date.now() / 1000) + 600;
    expect(decryptCaptureStateEvent(cast.privkey, outer, hostPubkey, { now: future })).toBeNull();
    // Still valid within the window.
    expect(decryptCaptureStateEvent(cast.privkey, outer, hostPubkey)).not.toBeNull();
  });

  it('deriveCastKeypair is deterministic per shareCode and differs across shareCodes', () => {
    expect(deriveCastKeypair(SHARE).pubkey).toBe(deriveCastKeypair(SHARE).pubkey);
    expect(deriveCastKeypair('XYZ789').pubkey).not.toBe(deriveCastKeypair(SHARE).pubkey);
  });

  it('PRIVACY: the serialized capture_state wire payload leaks no location and no winner npub', () => {
    const hostPrivkey = generateSecretKey();
    const hostPubkey = getPublicKey(hostPrivkey);
    const cast = deriveCastKeypair(SHARE);

    // Realistic entries: proofs computed from an actual winner pubkey, exactly
    // as HostDashboard's buildStateEntries does.
    const winnerPubkey = getPublicKey(generateSecretKey());
    const realEntries: CaptureStateEntry[] = [
      { monsterId: 'mon-1', capturedAt: 1000, winnerProof: computeWinnerProof('mon-1', winnerPubkey) },
      { monsterId: 'mon-2', capturedAt: 2000, winnerProof: computeWinnerProof('mon-2', winnerPubkey) },
    ];

    const outer = buildCaptureStateEvent(hostPrivkey, cast.pubkey, HUNT_ID, 7, realEntries);
    const payload = decryptCaptureStateEvent(cast.privkey, outer, hostPubkey)!;
    expect(payload).not.toBeNull();

    // Assert on the SERIALIZED message (hard constraint: not just the types).
    const wire = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ['lat', 'lng', 'longitude', 'geohash', '"location"', 'winnerpubkey', 'npub']) {
      expect(wire).not.toContain(forbidden);
    }
    // The winner's actual pubkey hex must not be recoverable from the payload.
    expect(JSON.stringify(payload)).not.toContain(winnerPubkey);
    // Only the expected keys ride the wire.
    expect(Object.keys(payload).sort()).toEqual(['entries', 'huntId', 'stateVersion', 'type']);
    for (const entry of payload.entries) {
      expect(Object.keys(entry).sort()).toEqual(['capturedAt', 'monsterId', 'winnerProof']);
      expect(entry.winnerProof).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('winnerProof matches for the winner and differs for anyone else', () => {
    const winner = 'winner-pubkey';
    const proof = computeWinnerProof('mon-1', winner);
    expect(computeWinnerProof('mon-1', winner)).toBe(proof);
    expect(computeWinnerProof('mon-1', 'someone-else')).not.toBe(proof);
    expect(computeWinnerProof('mon-2', winner)).not.toBe(proof);
  });
});
