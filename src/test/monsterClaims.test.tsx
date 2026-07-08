import { describe, it, expect } from 'vitest';
import {
  gameReducer,
  initialState,
  canCaptureMonster,
  type GameState,
} from '@/contexts/GameContext';
import type { HuntEvent, Monster } from '@/lib/gameTypes';

function makeMonster(overrides: Partial<Monster> = {}): Monster {
  return {
    id: `mon-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Ratasat',
    type: 'ratasat',
    description: 'A humble creature of the mempool',
    satAmount: 100,
    rarity: 'common',
    location: { lat: 37.7749, lng: -122.4194 },
    emoji: '🐀',
    spawnTime: Date.now(),
    captured: false,
    ...overrides,
  };
}

function makeHunt(overrides: Partial<HuntEvent> = {}): HuntEvent {
  return {
    id: 'hunt-1',
    name: 'Test Hunt',
    description: 'A test hunt',
    hostPubkey: 'host',
    totalSats: 1000,
    monsterCount: 8,
    geoFence: {
      center: { lat: 37.7749, lng: -122.4194 },
      bounds: { north: 37.78, south: 37.77, east: -122.41, west: -122.43 },
      radiusMeters: 300,
      boundaryType: 'circle',
    },
    startTime: Date.now(),
    endTime: Date.now() + 3600000,
    createdAt: Date.now(),
    monsters: [],
    satStops: [],
    status: 'active',
    paymentStatus: 'paid',
    shareCode: 'ABC123',
    participants: [],
    spawnMode: 'all_at_once',
    ...overrides,
  };
}

describe('MARK_MONSTER_CLAIMED (Tier 1 — another player caught it)', () => {
  it('FAILURE CASE: a claim hides the creature but NEVER credits sats, stats, or inventory (forged-claim safety)', () => {
    const monster = makeMonster();
    const before: GameState = {
      ...initialState,
      activeHunt: makeHunt({ monsters: [monster] }),
      nearbyMonsters: [monster],
      playerStats: { ...initialState.playerStats, balls: 5 },
    };

    const after = gameReducer(before, { type: 'MARK_MONSTER_CLAIMED', monsterId: monster.id });

    // Hidden: flagged captured and instantly gone from the map set
    const updated = after.activeHunt!.monsters.find(m => m.id === monster.id)!;
    expect(updated.captured).toBe(true);
    expect(after.nearbyMonsters.map(m => m.id)).not.toContain(monster.id);
    // Not credited to us: the claim carries no trustworthy winner identity
    expect(updated.capturedBy).toBeUndefined();
    // Zero credit anywhere — the signal is forgeable by any shareCode holder
    expect(after.playerStats).toEqual(before.playerStats);
    expect(after.playerStats.capturedMonsters).toHaveLength(0);
  });

  it('a claimed creature is refused by capture eligibility (no fake success for the slower player)', () => {
    const monster = makeMonster();
    const state: GameState = {
      ...initialState,
      activeHunt: makeHunt({ monsters: [monster] }),
      playerLocation: monster.location, // standing right on it
      playerStats: { ...initialState.playerStats, balls: 5 },
    };
    expect(canCaptureMonster(state, monster)).toBe(true); // sanity: capturable before

    const after = gameReducer(state, { type: 'MARK_MONSTER_CLAIMED', monsterId: monster.id });
    const claimed = after.activeHunt!.monsters.find(m => m.id === monster.id)!;
    expect(canCaptureMonster(after, claimed)).toBe(false);
  });

  it('unknown monster ids and already-captured monsters are no-ops', () => {
    const captured = makeMonster({ captured: true, capturedBy: 'me', capturedAt: 123 });
    const state: GameState = {
      ...initialState,
      activeHunt: makeHunt({ monsters: [captured] }),
    };

    // Unknown id: state returned unchanged (same reference)
    expect(gameReducer(state, { type: 'MARK_MONSTER_CLAIMED', monsterId: 'nope' })).toBe(state);
    // Already captured (e.g. our own capture echoed back): unchanged, does not
    // overwrite capturedBy/capturedAt
    expect(gameReducer(state, { type: 'MARK_MONSTER_CLAIMED', monsterId: captured.id })).toBe(state);
  });

  it('no active hunt is a no-op', () => {
    expect(gameReducer(initialState, { type: 'MARK_MONSTER_CLAIMED', monsterId: 'mon-1' })).toBe(
      initialState
    );
  });

  it('scattered_replacement: a remote claim activates the next unspawned monster, same as a local capture', () => {
    const claimedMonster = makeMonster();
    const unspawned = makeMonster({ spawnTime: Number.MAX_SAFE_INTEGER });
    const state: GameState = {
      ...initialState,
      activeHunt: makeHunt({
        spawnMode: 'scattered_replacement',
        monsters: [claimedMonster, unspawned],
      }),
    };

    const after = gameReducer(state, {
      type: 'MARK_MONSTER_CLAIMED',
      monsterId: claimedMonster.id,
    });

    const activated = after.activeHunt!.monsters.find(m => m.id === unspawned.id)!;
    expect(activated.spawnTime).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(activated.spawnTime).toBeLessThanOrEqual(Date.now() + 5000);
  });
});
