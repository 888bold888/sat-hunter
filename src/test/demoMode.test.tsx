import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import {
  gameReducer,
  initialState,
  initialPlayerStats,
  canCaptureMonster,
  GameProvider,
  useGame,
  type GameState,
} from '@/contexts/GameContext';
import type { HuntEvent, Monster, CapturedMonster } from '@/lib/gameTypes';
import type { LocationIntegrityResult } from '@/lib/antiCheat';

// A logged-in user so the stats-persistence effect is actually active in the
// integration test (without a pubkey it never writes, making the test vacuous).
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'a'.repeat(64) } }),
}));

function makeMonster(overrides: Partial<Monster> = {}): Monster {
  return {
    id: `mon-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Ratasat',
    type: 'ratasat',
    description: 'A humble creature of the mempool',
    satAmount: 100,
    rarity: 'common',
    location: { lat: 0, lng: 0 },
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
      center: { lat: 0, lng: 0 },
      bounds: { north: 0.01, south: -0.01, east: 0.01, west: -0.01 },
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

function makeCaptured(overrides: Partial<CapturedMonster> = {}): CapturedMonster {
  return {
    monsterId: `mon-${Math.random().toString(36).slice(2, 8)}`,
    monsterName: 'Ratasat',
    monsterType: 'ratasat',
    satAmount: 100,
    rarity: 'common',
    capturedAt: Date.now(),
    huntId: 'hunt-1',
    ...overrides,
  };
}

describe('demo mode', () => {
  describe('CAPTURE_MONSTER reducer', () => {
    it('demo capture updates current-hunt stats but leaves lifetime/total stats untouched', () => {
      const monster = makeMonster({ satAmount: 250 });
      const demoState: GameState = {
        ...initialState,
        activeHunt: makeHunt({ id: 'demo-1', isDemo: true, monsters: [monster] }),
      };

      const after = gameReducer(demoState, { type: 'CAPTURE_MONSTER', monster, huntName: 'Demo Hunt' });

      // Per-hunt + inventory update
      expect(after.playerStats.currentHuntCaptured).toBe(1);
      expect(after.playerStats.currentHuntSatsEarned).toBe(250);
      expect(after.playerStats.capturedMonsters).toHaveLength(1);
      // Failure case guarded against: lifetime pollution
      expect(after.playerStats.lifetimeCaptured).toBe(0);
      expect(after.playerStats.lifetimeSatsEarned).toBe(0);
      expect(after.playerStats.totalCaptured).toBe(0);
      expect(after.playerStats.totalSatsEarned).toBe(0);
    });

    it('real capture DOES update lifetime/total stats (control)', () => {
      const monster = makeMonster({ satAmount: 250 });
      const realState: GameState = {
        ...initialState,
        activeHunt: makeHunt({ id: 'real-1', isDemo: false, monsters: [monster] }),
      };

      const after = gameReducer(realState, { type: 'CAPTURE_MONSTER', monster, huntName: 'Real Hunt' });

      expect(after.playerStats.lifetimeCaptured).toBe(1);
      expect(after.playerStats.lifetimeSatsEarned).toBe(250);
      expect(after.playerStats.totalCaptured).toBe(1);
      expect(after.playerStats.totalSatsEarned).toBe(250);
    });
  });

  describe('anti-cheat gate (canCaptureMonster)', () => {
    const failingCheck = {
      canCapture: false,
      reason: 'spoof detected',
    } as unknown as LocationIntegrityResult;

    const baseState: GameState = {
      ...initialState,
      playerLocation: { lat: 0, lng: 0 },
      playerStats: { ...initialPlayerStats, balls: 5 },
      lastIntegrityCheck: failingCheck,
    };
    const monster = makeMonster({ location: { lat: 0, lng: 0 } });

    it('blocks capture in a REAL hunt when integrity check fails', () => {
      const realState: GameState = { ...baseState, activeHunt: makeHunt({ isDemo: false }) };
      expect(canCaptureMonster(realState, monster)).toBe(false);
    });

    it('allows capture in a DEMO hunt despite the same failing integrity check', () => {
      const demoState: GameState = { ...baseState, activeHunt: makeHunt({ id: 'demo-1', isDemo: true }) };
      expect(canCaptureMonster(demoState, monster)).toBe(true);
    });
  });

  describe('EXIT_DEMO_HUNT reducer', () => {
    it('removes demo captures, keeps non-demo captures, and clears the demo hunt', () => {
      const demoCap = makeCaptured({ huntId: 'demo-1' });
      const realCap = makeCaptured({ huntId: 'real-1' });
      const state: GameState = {
        ...initialState,
        activeHunt: makeHunt({ id: 'demo-1', isDemo: true }),
        playerStats: {
          ...initialPlayerStats,
          capturedMonsters: [demoCap, realCap],
          currentHuntId: 'demo-1',
          currentHuntCaptured: 1,
          currentHuntSatsEarned: 100,
        },
      };

      const after = gameReducer(state, { type: 'EXIT_DEMO_HUNT' });

      expect(after.activeHunt).toBeNull();
      expect(after.playerStats.capturedMonsters).toEqual([realCap]);
      expect(after.playerStats.currentHuntId).toBeNull();
      expect(after.playerStats.currentHuntCaptured).toBe(0);
      expect(after.playerStats.currentHuntSatsEarned).toBe(0);
    });

    it('is a no-op for a non-demo hunt', () => {
      const state: GameState = {
        ...initialState,
        activeHunt: makeHunt({ id: 'real-1', isDemo: false }),
      };
      const after = gameReducer(state, { type: 'EXIT_DEMO_HUNT' });
      expect(after).toBe(state);
    });
  });

  describe('manual movement (couch-mode) — location injection', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TestApp>
        <GameProvider>{children}</GameProvider>
      </TestApp>
    );

    it('sets playerLocation to the center immediately on a manual-movement demo start', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      const center = { lat: 37.7749, lng: -122.4194 };
      act(() => {
        result.current.startDemoHunt(center, { manualMovement: true });
      });

      expect(result.current.state.manualMovement).toBe(true);
      expect(result.current.state.playerLocation).toEqual(center);
    });

    it('setManualLocation updates playerLocation in a manual-movement demo', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.startDemoHunt({ lat: 37.7749, lng: -122.4194 }, { manualMovement: true });
      });

      const walked = { lat: 37.7752, lng: -122.4190 };
      act(() => {
        result.current.setManualLocation(walked);
      });

      expect(result.current.state.playerLocation).toEqual(walked);
    });

    it('setManualLocation is REJECTED when the active hunt is NOT a demo (anti-cheat)', () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      const realHunt = makeHunt({ id: 'real-1', isDemo: false });
      act(() => {
        result.current.joinHunt(realHunt);
      });

      const before = result.current.state.playerLocation;
      act(() => {
        result.current.setManualLocation({ lat: 51.5, lng: -0.12 });
      });

      // A real hunt must never accept an injected location
      expect(result.current.state.playerLocation).toBe(before);
      expect(result.current.state.manualMovement).toBe(false);
    });
  });

  describe('startLocationTracking respects couch mode', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TestApp>
        <GameProvider>{children}</GameProvider>
      </TestApp>
    );

    let watchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      localStorage.clear();
      watchSpy = vi.fn().mockReturnValue(1);
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          watchPosition: watchSpy,
          clearWatch: vi.fn(),
          getCurrentPosition: vi.fn(),
        },
      });
    });

    it('does NOT start a GPS watch during a manual-movement demo', async () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      act(() => {
        result.current.startDemoHunt({ lat: 37.7749, lng: -122.4194 }, { manualMovement: true });
      });

      await act(async () => {
        await result.current.startLocationTracking();
      });

      expect(watchSpy).not.toHaveBeenCalled();
    });

    it('DOES start a GPS watch in a normal (non-couch) state (control)', async () => {
      const { result } = renderHook(() => useGame(), { wrapper });

      await act(async () => {
        await result.current.startLocationTracking();
      });

      expect(watchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('demo hunt never touches localStorage', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('does not persist the demo hunt or demo-session stats', () => {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <TestApp>
          <GameProvider>{children}</GameProvider>
        </TestApp>
      );

      const { result } = renderHook(() => useGame(), { wrapper });

      let hunt!: HuntEvent;
      act(() => {
        hunt = result.current.startDemoHunt({ lat: 40.0, lng: -74.0 });
      });

      // A demo hunt must never land in sathunter:active-hunt
      expect(localStorage.getItem('sathunter:active-hunt')).toBe('null');

      // The demo session id must never leak into persisted stats
      const storedStats = localStorage.getItem('sathunter:player-stats');
      if (storedStats) {
        const parsed = JSON.parse(storedStats);
        expect(parsed.currentHuntId).not.toBe(hunt.id);
      }
    });
  });
});
