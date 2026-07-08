// @vitest-environment node
// Pure crypto (computeWinnerProof via @noble/hashes) — node env because jsdom's
// Uint8Array breaks @noble/hashes.
import { describe, it, expect } from 'vitest';
import { buildHelloPayload, type HuntLocationData } from '@/lib/p2pSignaling';
import { computeWinnerProof, type CaptureStateEntry } from '@/lib/captureBroadcast';
import type { GeoFence, Monster, SatStop } from '@/lib/gameTypes';

const geoFence: GeoFence = {
  center: { lat: 37.7749, lng: -122.4194 },
  bounds: { north: 37.78, south: 37.77, east: -122.41, west: -122.43 },
  radiusMeters: 300,
  boundaryType: 'circle',
};

function makeMonster(id: string): Monster {
  return {
    id,
    name: 'Ratasat',
    type: 'ratasat',
    description: 'A humble creature of the mempool',
    satAmount: 100,
    rarity: 'common',
    location: { lat: 37.7749, lng: -122.4194 },
    emoji: '🐀',
    spawnTime: Date.now(),
    captured: false,
  };
}

const baseHuntData: HuntLocationData = {
  geoFence,
  monsters: [makeMonster('mon-1'), makeMonster('mon-2')],
  satStops: [] as SatStop[],
  captureSecret: 'secret-hmac-key',
  hostBroadcastPubkey: 'host-broadcast-pubkey',
};

describe('hello snapshot capture-state (Phase 3 late-joiner correctness)', () => {
  it('FRESHNESS: a hello built AFTER a capture carries it; one built before does not', () => {
    // The host's authoritative captured list, mutated as captures land. The getter
    // reads it live, so the payload reflects captures up to send time.
    const captured: CaptureStateEntry[] = [];
    const getCaptureState = () => ({ stateVersion: Date.now(), entries: [...captured] });

    // Hello BEFORE any capture: empty snapshot.
    const before = buildHelloPayload(baseHuntData, getCaptureState);
    expect(before.captureState?.entries).toEqual([]);

    // A capture lands on the host.
    captured.push({
      monsterId: 'mon-1',
      capturedAt: 12345,
      winnerProof: computeWinnerProof('mon-1', 'winner-pubkey'),
    });

    // Hello AFTER the capture: snapshot now includes it (getter re-evaluated).
    const after = buildHelloPayload(baseHuntData, getCaptureState);
    expect(after.captureState?.entries.map(e => e.monsterId)).toEqual(['mon-1']);
    // The earlier payload is unaffected (each hello is an independent snapshot).
    expect(before.captureState?.entries).toEqual([]);
  });

  it('no getter → captureState is omitted (undefined), never null', () => {
    const payload = buildHelloPayload(baseHuntData);
    expect(payload.captureState).toBeUndefined();
    // Base fields are preserved verbatim.
    expect(payload.monsters).toBe(baseHuntData.monsters);
    expect(payload.captureSecret).toBe('secret-hmac-key');
  });

  it('PRIVACY: the serialized capture-state carries no winner npub and no lat/lng/geohash', () => {
    const getCaptureState = () => ({
      stateVersion: 42,
      entries: [
        { monsterId: 'mon-1', capturedAt: 1000, winnerProof: computeWinnerProof('mon-1', 'winner-a') },
        { monsterId: 'mon-2', capturedAt: 2000, winnerProof: computeWinnerProof('mon-2', 'winner-b') },
      ] as CaptureStateEntry[],
    });

    const payload = buildHelloPayload(baseHuntData, getCaptureState);
    // Assert on the serialized captureState only (the monsters list legitimately
    // carries locations; the NEW player-readable Tier 2 payload must not).
    const wire = JSON.stringify(payload.captureState);

    for (const banned of ['winnerPubkey', 'winnerNpub', 'npub', 'pubkey', 'lat', 'lng', 'geohash', 'location']) {
      expect(wire.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    // Positive control: winnerProof (a bare sha256 hex, no identity) IS present.
    expect(wire).toContain('winnerProof');
    // Each proof is 64 hex chars and reveals nothing about the winner.
    for (const e of payload.captureState!.entries) {
      expect(e.winnerProof).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
