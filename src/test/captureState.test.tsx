import { describe, it, expect } from 'vitest';
import {
  gameReducer,
  initialState,
  type GameState,
} from '@/contexts/GameContext';
import { computeWinnerProof, type CaptureStateEntry } from '@/lib/captureBroadcast';
import type { CapturedMonster, HuntEvent, Monster } from '@/lib/gameTypes';

const ME = 'my-pubkey';
const HUNT_ID = 'hunt-1';

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
    id: HUNT_ID,
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

function capturedRecord(monster: Monster): CapturedMonster {
  return {
    monsterId: monster.id,
    monsterName: monster.name,
    monsterType: monster.type,
    satAmount: monster.satAmount,
    rarity: monster.rarity,
    capturedAt: Date.now(),
    huntId: HUNT_ID,
  };
}

// A state where the local player has been credited `monster` (mirrors what
// CAPTURE_MONSTER produces for a real hunt) plus some pre-existing lifetime
// history from other hunts, so we can assert exact decrements.
function stateWithLocalCredit(monster: Monster, huntMonsters: Monster[]): GameState {
  return {
    ...initialState,
    activeHunt: makeHunt({ monsters: huntMonsters }),
    playerStats: {
      ...initialState.playerStats,
      pubkey: ME,
      currentHuntId: HUNT_ID,
      currentHuntCaptured: 1,
      currentHuntSatsEarned: monster.satAmount,
      lifetimeCaptured: 5,
      lifetimeSatsEarned: 500 + monster.satAmount,
      totalCaptured: 5,
      totalSatsEarned: 500 + monster.satAmount,
      capturedMonsters: [capturedRecord(monster)],
    },
  };
}

function entry(monsterId: string, winnerPubkey: string, capturedAt = 12345): CaptureStateEntry {
  return { monsterId, capturedAt, winnerProof: computeWinnerProof(monsterId, winnerPubkey) };
}

describe('APPLY_CAPTURE_STATE (Tier 2 authoritative capture-state)', () => {
  it('marks listed monsters captured and removes them from nearbyMonsters', () => {
    const a = makeMonster();
    const b = makeMonster();
    const before: GameState = {
      ...initialState,
      activeHunt: makeHunt({ monsters: [a, b] }),
      nearbyMonsters: [a, b],
      playerStats: { ...initialState.playerStats, pubkey: ME },
    };

    const after = gameReducer(before, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [entry(a.id, 'someone-else', 999)],
      myPubkey: ME,
    });

    const updatedA = after.activeHunt!.monsters.find(m => m.id === a.id)!;
    expect(updatedA.captured).toBe(true);
    expect(updatedA.capturedAt).toBe(999);
    // capturedBy stays unset — the broadcast never carries the winner's npub
    expect(updatedA.capturedBy).toBeUndefined();
    // Gone from the map immediately; the untouched one remains
    expect(after.nearbyMonsters.map(m => m.id)).toEqual([b.id]);
  });

  it('LOSER ROLLBACK: strips credit + decrements every stat by exactly the satAmount and records the loss', () => {
    const monster = makeMonster({ satAmount: 250 });
    const before = stateWithLocalCredit(monster, [monster]);

    const after = gameReducer(before, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [entry(monster.id, 'the-real-winner')], // proof does NOT match ME
      myPubkey: ME,
    });

    // Credit removed from the inventory
    expect(after.playerStats.capturedMonsters).toHaveLength(0);
    // Exact decrement by satAmount, no more no less
    expect(after.playerStats.currentHuntCaptured).toBe(0);
    expect(after.playerStats.currentHuntSatsEarned).toBe(0);
    expect(after.playerStats.lifetimeCaptured).toBe(4);
    expect(after.playerStats.lifetimeSatsEarned).toBe(500);
    expect(after.playerStats.totalCaptured).toBe(4);
    expect(after.playerStats.totalSatsEarned).toBe(500);
    // Loss surfaced for the toast
    expect(after.lostCaptures).toEqual([
      { monsterId: monster.id, monsterName: monster.name, satAmount: 250 },
    ]);
  });

  it('WINNER keeps credit: matching winnerProof rolls back nothing', () => {
    const monster = makeMonster({ satAmount: 250 });
    const before = stateWithLocalCredit(monster, [monster]);

    const after = gameReducer(before, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [entry(monster.id, ME)], // proof matches ME — I won
      myPubkey: ME,
    });

    expect(after.playerStats.capturedMonsters).toHaveLength(1);
    expect(after.playerStats).toEqual(before.playerStats);
    expect(after.lostCaptures).toEqual([]);
  });

  it('idempotency: applying the same losing state twice does not double-decrement or duplicate the loss', () => {
    const monster = makeMonster({ satAmount: 250 });
    const before = stateWithLocalCredit(monster, [monster]);
    const action = {
      type: 'APPLY_CAPTURE_STATE' as const,
      entries: [entry(monster.id, 'the-real-winner')],
      myPubkey: ME,
    };

    const once = gameReducer(before, action);
    const twice = gameReducer(once, action);

    // Second application is a strict no-op (same reference)
    expect(twice).toBe(once);
    expect(twice.playerStats).toEqual(once.playerStats);
    expect(twice.lostCaptures).toHaveLength(1);
  });

  it('HARD RULE: never increases any stat (winner path leaves totals untouched, loser path only decreases)', () => {
    const monster = makeMonster({ satAmount: 250 });
    const before = stateWithLocalCredit(monster, [monster]);

    const winner = gameReducer(before, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [entry(monster.id, ME)],
      myPubkey: ME,
    });
    const loser = gameReducer(before, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [entry(monster.id, 'the-real-winner')],
      myPubkey: ME,
    });

    for (const s of [winner, loser]) {
      expect(s.playerStats.currentHuntCaptured).toBeLessThanOrEqual(before.playerStats.currentHuntCaptured);
      expect(s.playerStats.currentHuntSatsEarned).toBeLessThanOrEqual(before.playerStats.currentHuntSatsEarned);
      expect(s.playerStats.lifetimeCaptured).toBeLessThanOrEqual(before.playerStats.lifetimeCaptured);
      expect(s.playerStats.lifetimeSatsEarned).toBeLessThanOrEqual(before.playerStats.lifetimeSatsEarned);
      expect(s.playerStats.totalCaptured).toBeLessThanOrEqual(before.playerStats.totalCaptured);
      expect(s.playerStats.totalSatsEarned).toBeLessThanOrEqual(before.playerStats.totalSatsEarned);
    }
  });

  it('no active hunt is a no-op', () => {
    expect(
      gameReducer(initialState, { type: 'APPLY_CAPTURE_STATE', entries: [entry('m', ME)], myPubkey: ME })
    ).toBe(initialState);
  });
});
