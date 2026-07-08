// @vitest-environment node
// Pure crypto helpers — node env because jsdom's Uint8Array breaks @noble/hashes.
import { describe, it, expect } from 'vitest';
import { computeCaptureDedupHash, buildCaptureDedupIndex } from '@/lib/captureSync';
import type { Monster } from '@/lib/gameTypes';

function makeMonster(id: string): Monster {
  return {
    id,
    name: 'Ratasat',
    type: 'ratasat',
    description: 'test',
    satAmount: 100,
    rarity: 'common',
    location: { lat: 0, lng: 0 },
    emoji: '🐀',
    spawnTime: Date.now(),
    captured: false,
  };
}

describe('captureSync dedup hashing (Tier 1 claim signal)', () => {
  it('matches the on-the-wire capture event d-tag format: sha256("{shareCode}-{monsterId}") hex', () => {
    // Independently computed with node:crypto — locks the format so the
    // publish side (usePublishCapture) and the matching side can never drift.
    expect(computeCaptureDedupHash('ABC123', 'mon-1')).toBe(
      'f7a96d32082f9451b7edcde9c2c2b1dbec90fe334a2d218c4cd9a951b80439b0'
    );
  });

  it('different monsters and different hunts produce different hashes', () => {
    const a = computeCaptureDedupHash('ABC123', 'mon-1');
    expect(computeCaptureDedupHash('ABC123', 'mon-2')).not.toBe(a);
    expect(computeCaptureDedupHash('XYZ789', 'mon-1')).not.toBe(a);
  });

  it('buildCaptureDedupIndex resolves every roster monster and nothing else', () => {
    const monsters = [makeMonster('mon-1'), makeMonster('mon-2'), makeMonster('mon-3')];
    const index = buildCaptureDedupIndex('ABC123', monsters);

    expect(index.size).toBe(3);
    for (const m of monsters) {
      expect(index.get(computeCaptureDedupHash('ABC123', m.id))).toBe(m.id);
    }
    // A claim tag from a different hunt (or a garbage tag) must not resolve
    expect(index.get(computeCaptureDedupHash('XYZ789', 'mon-1'))).toBeUndefined();
    expect(index.get('not-a-real-hash')).toBeUndefined();
  });
});
