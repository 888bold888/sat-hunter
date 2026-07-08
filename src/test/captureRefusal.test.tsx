// Phase 5 field-glitch regressions (tasks/goals/shared-creature-state.md):
// tapping a monster another hunter already caught must be a clean
// "already captured" refusal — never a fake local success, never a published
// capture event (GameMap gates publishing on captureMonster returning true).
import { describe, it, expect } from 'vitest';
import {
  gameReducer,
  initialState,
  canCaptureMonster,
  getCaptureRefusalReason,
  type GameState,
} from '@/contexts/GameContext';
import { computeWinnerProof } from '@/lib/captureBroadcast';
import type { HuntEvent, Monster } from '@/lib/gameTypes';

const ME = 'my-pubkey';

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

// A player standing on the monster with balls — capturable unless refused.
function readyState(monster: Monster): GameState {
  return {
    ...initialState,
    activeHunt: makeHunt({ monsters: [monster] }),
    nearbyMonsters: [monster],
    playerLocation: monster.location,
    playerStats: { ...initialState.playerStats, balls: 5 },
  };
}

describe('capture refusal (no fake success on a caught creature)', () => {
  it('FIELD REGRESSION: a STALE monster object (selection panel from before the claim) is refused via the live roster', () => {
    const monster = makeMonster();
    const staleCopy = { ...monster }; // UI kept this reference; captured: false
    const before = readyState(monster);
    expect(getCaptureRefusalReason(before, staleCopy)).toBeNull(); // sanity

    // Another player's Tier 1 claim lands — roster flips, stale copy does not.
    const after = gameReducer(before, { type: 'MARK_MONSTER_CLAIMED', monsterId: monster.id });
    expect(staleCopy.captured).toBe(false); // the trap: stale object still looks free

    expect(getCaptureRefusalReason(after, staleCopy)).toBe('already-captured');
    expect(canCaptureMonster(after, staleCopy)).toBe(false);
  });

  it('same refusal after a Tier 2 authoritative capture_state confirms it', () => {
    const monster = makeMonster();
    const staleCopy = { ...monster };
    const before = readyState(monster);

    const after = gameReducer(before, {
      type: 'APPLY_CAPTURE_STATE',
      entries: [{
        monsterId: monster.id,
        capturedAt: Date.now(),
        winnerProof: computeWinnerProof(monster.id, 'someone-else'),
      }],
      myPubkey: ME,
    });

    expect(getCaptureRefusalReason(after, staleCopy)).toBe('already-captured');
    expect(canCaptureMonster(after, staleCopy)).toBe(false);
  });

  it('DEFENSE IN DEPTH: CAPTURE_MONSTER on an already-captured roster monster is a no-op (zero credit)', () => {
    const monster = makeMonster();
    const staleCopy = { ...monster };
    const claimed = gameReducer(readyState(monster), {
      type: 'MARK_MONSTER_CLAIMED',
      monsterId: monster.id,
    });

    // Even if some path dispatched the capture anyway, nothing is credited.
    const after = gameReducer(claimed, {
      type: 'CAPTURE_MONSTER',
      monster: staleCopy,
      huntName: 'Test Hunt',
    });
    expect(after).toBe(claimed); // same reference — untouched
    expect(after.playerStats.capturedMonsters).toHaveLength(0);
    expect(after.playerStats.totalSatsEarned).toBe(0);
  });

  it("'already-captured' outranks every other refusal (the player can't fix it, and it explains the disappearance)", () => {
    const monster = makeMonster({ captured: true });
    const state: GameState = {
      ...initialState,
      activeHunt: makeHunt({ monsters: [monster] }),
      // No balls AND no location — both would refuse on their own.
      playerStats: { ...initialState.playerStats, balls: 0 },
      playerLocation: null,
    };
    expect(getCaptureRefusalReason(state, monster)).toBe('already-captured');
  });

  it('refusal reasons for the fixable cases: no-balls, no-location, out-of-range', () => {
    const monster = makeMonster();
    const ready = readyState(monster);

    expect(getCaptureRefusalReason(
      { ...ready, playerStats: { ...ready.playerStats, balls: 0 } }, monster
    )).toBe('no-balls');
    expect(getCaptureRefusalReason(
      { ...ready, playerLocation: null }, monster
    )).toBe('no-location');
    expect(getCaptureRefusalReason(
      { ...ready, playerLocation: { lat: monster.location.lat + 0.01, lng: monster.location.lng } }, monster
    )).toBe('out-of-range');
    expect(getCaptureRefusalReason(ready, monster)).toBeNull();
  });
});
