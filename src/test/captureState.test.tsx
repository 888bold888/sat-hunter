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

describe('APPLY_CAPTURE_STATE replacement activation (Phase 3 late-joiner)', () => {
  const UNSPAWNED = Number.MAX_SAFE_INTEGER;

  it('LATE JOINER: marks N captured, removes them from the map, and activates N replacements', () => {
    const capA = makeMonster();
    const capB = makeMonster();
    const spare1 = makeMonster({ spawnTime: UNSPAWNED });
    const spare2 = makeMonster({ spawnTime: UNSPAWNED });
    const before: GameState = {
      ...initialState,
      activeHunt: makeHunt({
        spawnMode: 'scattered_replacement',
        monsters: [capA, capB, spare1, spare2],
      }),
      nearbyMonsters: [capA, capB],
      playerStats: { ...initialState.playerStats, pubkey: ME },
    };

    const after = gameReducer(before, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [entry(capA.id, 'someone-a', 111), entry(capB.id, 'someone-b', 222)],
      myPubkey: ME,
    });

    const byId = new Map(after.activeHunt!.monsters.map(m => [m.id, m]));
    // Both listed monsters are terminally captured...
    expect(byId.get(capA.id)!.captured).toBe(true);
    expect(byId.get(capB.id)!.captured).toBe(true);
    // ...and gone from the map immediately.
    expect(after.nearbyMonsters).toEqual([]);
    // Exactly two replacements spawned (one per newly-captured), none left dormant.
    const activated = [spare1, spare2].filter(s => byId.get(s.id)!.spawnTime < UNSPAWNED);
    expect(activated).toHaveLength(2);
    expect(byId.get(spare1.id)!.spawnTime).toBeLessThan(UNSPAWNED);
    expect(byId.get(spare2.id)!.spawnTime).toBeLessThan(UNSPAWNED);
  });

  it('non-replacement mode activates nothing (control)', () => {
    const cap = makeMonster();
    const spare = makeMonster({ spawnTime: UNSPAWNED });
    const before: GameState = {
      ...initialState,
      activeHunt: makeHunt({ spawnMode: 'all_at_once', monsters: [cap, spare] }),
      playerStats: { ...initialState.playerStats, pubkey: ME },
    };

    const after = gameReducer(before, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [entry(cap.id, 'someone', 111)],
      myPubkey: ME,
    });

    expect(after.activeHunt!.monsters.find(m => m.id === spare.id)!.spawnTime).toBe(UNSPAWNED);
  });

  it('NO DOUBLE-ACTIVATION: a Tier-1 claim activates one replacement; a Tier-2 confirm of the SAME monster activates none', () => {
    const target = makeMonster();
    const spare1 = makeMonster({ spawnTime: UNSPAWNED });
    const spare2 = makeMonster({ spawnTime: UNSPAWNED });
    const start: GameState = {
      ...initialState,
      activeHunt: makeHunt({
        spawnMode: 'scattered_replacement',
        monsters: [target, spare1, spare2],
      }),
      playerStats: { ...initialState.playerStats, pubkey: ME },
    };

    // Tier 1: another player's capture-event tag hides `target` and activates one.
    const afterClaim = gameReducer(start, { type: 'MARK_MONSTER_CLAIMED', monsterId: target.id });
    const claimActivated = afterClaim.activeHunt!.monsters.filter(
      m => (m.id === spare1.id || m.id === spare2.id) && m.spawnTime < UNSPAWNED
    );
    expect(claimActivated).toHaveLength(1);

    // Tier 2: the host's authoritative broadcast confirms the SAME monster. It is
    // already captured, so it is not "newly captured" → NO additional activation.
    const afterConfirm = gameReducer(afterClaim, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [entry(target.id, 'someone', 999)],
      myPubkey: ME,
    });
    const confirmActivated = afterConfirm.activeHunt!.monsters.filter(
      m => (m.id === spare1.id || m.id === spare2.id) && m.spawnTime < UNSPAWNED
    );
    // Still exactly one spare activated overall — no double-spend of replacements.
    expect(confirmActivated).toHaveLength(1);
  });
});
