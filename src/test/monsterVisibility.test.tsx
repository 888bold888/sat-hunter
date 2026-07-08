import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { GameProvider, useGame, canCaptureMonster } from '@/contexts/GameContext';
import { filterVisibleMonsters, calculateDistance } from '@/lib/gameUtils';
import {
  MONSTER_APPEAR_RANGE_METERS,
  MONSTER_DISAPPEAR_RANGE_METERS,
  CAPTURE_RANGE_METERS,
} from '@/lib/gameTypes';
import type { Monster, GeoLocation } from '@/lib/gameTypes';

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'a'.repeat(64) } }),
}));

// ~1 degree latitude ≈ 111,320m; offset a point north by a given distance
function metersNorth(from: GeoLocation, meters: number): GeoLocation {
  return { lat: from.lat + meters / 111320, lng: from.lng };
}

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

describe('sticky monster visibility (hysteresis)', () => {
  const origin: GeoLocation = { lat: 37.7749, lng: -122.4194 };

  describe('filterVisibleMonsters (pure helper)', () => {
    it('sanity: thresholds are asymmetric with a wide band (appear ≤ capture range, disappear ≥ 100m)', () => {
      // Guards against someone "simplifying" the two constants back into one.
      expect(MONSTER_APPEAR_RANGE_METERS).toBeLessThanOrEqual(CAPTURE_RANGE_METERS);
      expect(MONSTER_DISAPPEAR_RANGE_METERS).toBeGreaterThanOrEqual(100);
    });

    it('a creature appears when the player is within appear range', () => {
      const monster = makeMonster({ location: metersNorth(origin, 10) });
      const visible = filterVisibleMonsters([monster], origin, new Set());
      expect(visible.map(m => m.id)).toContain(monster.id);
    });

    it('a creature NOT yet visible does not appear at mid distances (40m)', () => {
      const monster = makeMonster({ location: metersNorth(origin, 40) });
      const visible = filterVisibleMonsters([monster], origin, new Set());
      expect(visible).toHaveLength(0);
    });

    it('FIELD REGRESSION: an ~80m GPS spike does not despawn an already-visible creature', () => {
      const monster = makeMonster({ location: origin });
      const spiked = metersNorth(origin, 80);
      // Confirm the test really models an 80m jump
      expect(calculateDistance(origin, spiked)).toBeGreaterThan(70);
      const visible = filterVisibleMonsters([monster], spiked, new Set([monster.id]));
      expect(visible.map(m => m.id)).toContain(monster.id);
    });

    it('a visible creature despawns only past the disappear range', () => {
      const monster = makeMonster({ location: origin });
      const prev = new Set([monster.id]);
      const justInside = filterVisibleMonsters([monster], metersNorth(origin, 95), prev);
      expect(justInside.map(m => m.id)).toContain(monster.id);
      const beyond = filterVisibleMonsters([monster], metersNorth(origin, 150), prev);
      expect(beyond).toHaveLength(0);
    });

    it('captured and not-yet-spawned creatures are never visible, even if previously visible', () => {
      const captured = makeMonster({ location: origin, captured: true });
      const unspawned = makeMonster({ location: origin, spawnTime: Date.now() + 60_000 });
      const prev = new Set([captured.id, unspawned.id]);
      expect(filterVisibleMonsters([captured, unspawned], origin, prev)).toHaveLength(0);
    });

    it('no player location means nothing is visible', () => {
      const monster = makeMonster({ location: origin });
      expect(filterVisibleMonsters([monster], null, new Set([monster.id]))).toHaveLength(0);
    });
  });

  describe('GameContext holds the visibility state (survives map remounts)', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TestApp>
        <GameProvider>{children}</GameProvider>
      </TestApp>
    );

    // Walk to the planted monster (nearest to center in a demo hunt), then step
    // away. No map component is mounted at any point, proving visibility state
    // lives in the context — a HuntMap remount cannot reset it.
    it('a creature stays in nearbyMonsters after walking ~80m away, and only drops past the disappear range', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.startDemoHunt(origin, { manualMovement: true });
      });

      const monsters = result.current.state.activeHunt!.monsters;
      const target = [...monsters].sort(
        (a, b) => calculateDistance(origin, a.location) - calculateDistance(origin, b.location)
      )[0];

      // Stand on the creature: it appears
      act(() => {
        result.current.setManualLocation(target.location);
      });
      expect(result.current.state.nearbyMonsters.map(m => m.id)).toContain(target.id);

      // GPS spike / short walk ~80m: still visible (old 25m logic despawned here)
      act(() => {
        result.current.setManualLocation(metersNorth(target.location, 80));
      });
      expect(result.current.state.nearbyMonsters.map(m => m.id)).toContain(target.id);

      // Visible-but-far creature is NOT capturable — visibility never widens capture
      expect(canCaptureMonster(result.current.state, target)).toBe(false);

      // Genuinely walking away (>100m) despawns it
      act(() => {
        result.current.setManualLocation(metersNorth(target.location, 150));
      });
      expect(result.current.state.nearbyMonsters.map(m => m.id)).not.toContain(target.id);
    });

    it('visibility memory resets when a new hunt starts', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.startDemoHunt(origin, { manualMovement: true });
      });
      const firstHunt = result.current.state.activeHunt!;
      const target = [...firstHunt.monsters].sort(
        (a, b) => calculateDistance(origin, a.location) - calculateDistance(origin, b.location)
      )[0];
      act(() => {
        result.current.setManualLocation(target.location);
      });
      expect(result.current.state.nearbyMonsters.map(m => m.id)).toContain(target.id);

      act(() => {
        result.current.exitDemoHunt();
      });
      act(() => {
        result.current.startDemoHunt(origin, { manualMovement: true });
      });

      // In the new hunt, only creatures within APPEAR range of the center may be
      // visible — nothing inherited from the previous hunt's 100m sticky band.
      const center = result.current.state.playerLocation!;
      for (const m of result.current.state.nearbyMonsters) {
        expect(calculateDistance(center, m.location)).toBeLessThanOrEqual(
          MONSTER_APPEAR_RANGE_METERS
        );
      }
    });
  });
});
