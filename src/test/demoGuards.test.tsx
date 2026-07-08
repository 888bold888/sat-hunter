import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { HuntEvent, Monster, GeoLocation } from '@/lib/gameTypes';
import { DEFAULT_TEST_LOCATION } from '@/lib/devMode';

// --- Shared mocks ---------------------------------------------------------------
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@unhead/react', () => ({ useSeoMeta: () => {} }));
vi.mock('@/components/auth/LoginArea', () => ({ LoginArea: () => null }));
vi.mock('@/components/game/HuntMap', () => ({ HuntMap: () => null }));

const mockPublishMutate = vi.fn();
vi.mock('@/hooks/usePublishCapture', () => ({
  usePublishCapture: () => ({ mutate: mockPublishMutate }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { pubkey: 'player-pubkey' } }),
}));

const mockStartDemoHunt = vi.fn();
const mockCaptureMonster = vi.fn(() => true);
let mockGameValue: Record<string, unknown>;
// Keep the real module (GameMap also imports the pure getCaptureRefusalReason,
// which must run for real so eligible captures reach captureMonster) and mock
// only the hook.
vi.mock('@/contexts/GameContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/GameContext')>();
  return { ...actual, useGame: () => mockGameValue };
});

import { GameMap } from '@/components/game/GameMap';
import Index from '@/pages/Index';

const playerLocation: GeoLocation = { lat: 37.7749, lng: -122.4194 };

function makeMonster(): Monster {
  return {
    id: 'mon-1',
    name: 'Ratasat',
    type: 'ratasat',
    description: 'A humble creature of the mempool',
    satAmount: 100,
    rarity: 'common',
    location: playerLocation, // same point as the player: always in capture range
    emoji: '🐀',
    spawnTime: Date.now() - 1000,
    captured: false,
  };
}

function makeHunt(isDemo: boolean, monsters: Monster[]): HuntEvent {
  return {
    id: isDemo ? 'demo-1' : 'hunt-1',
    name: isDemo ? 'Demo Hunt' : 'Real Hunt',
    description: '',
    hostPubkey: isDemo ? '' : 'host-pubkey',
    totalSats: 21000,
    monsterCount: monsters.length,
    geoFence: {
      center: playerLocation,
      bounds: { north: 37.78, south: 37.77, east: -122.41, west: -122.43 },
      radiusMeters: 300,
      boundaryType: 'circle',
    },
    startTime: Date.now(),
    endTime: Date.now() + 30 * 60 * 1000,
    createdAt: Date.now(),
    monsters,
    satStops: [],
    status: 'active',
    paymentStatus: 'paid',
    shareCode: isDemo ? 'DEMO' : 'ABC123',
    participants: [],
    spawnMode: 'all_at_once',
    isDemo,
  };
}

function gameValueFor(hunt: HuntEvent, monster: Monster) {
  return {
    state: {
      activeHunt: hunt,
      playerLocation,
      locationError: null,
      playerStats: { balls: 10, currentHuntCaptured: 0, currentHuntSatsEarned: 0 },
      lastIntegrityCheck: null,
      manualMovement: false,
    },
    getAvailableMonsters: () => [monster],
    getAvailableStops: () => [],
    captureMonster: mockCaptureMonster,
    collectBalls: vi.fn(),
    startLocationTracking: vi.fn(),
    setManualLocation: vi.fn(),
    startDemoHunt: mockStartDemoHunt,
    isHost: () => false,
  };
}

describe('GameMap capture publish gate', () => {
  beforeEach(() => {
    mockPublishMutate.mockClear();
    mockCaptureMonster.mockClear();
  });

  // Failure case for the hard constraint: a demo capture must publish ZERO Nostr events.
  it('does NOT publish a capture event for a demo hunt', async () => {
    const monster = makeMonster();
    mockGameValue = gameValueFor(makeHunt(true, [monster]), monster);

    render(
      <GameMap
        selectedMonster={monster}
        selectedStop={null}
        onSelectMonster={vi.fn()}
        onSelectStop={vi.fn()}
      />
    );
    // MonsterCard defers onCapture ~500ms for the catch animation
    fireEvent.click(screen.getByRole('button', { name: /Capture!/i }));
    await waitFor(() => expect(mockCaptureMonster).toHaveBeenCalledWith(monster), {
      timeout: 2000,
    });

    expect(mockPublishMutate).not.toHaveBeenCalled();
  });

  it('DOES publish a capture event for a real hunt (control)', async () => {
    const monster = makeMonster();
    mockGameValue = gameValueFor(makeHunt(false, [monster]), monster);

    render(
      <GameMap
        selectedMonster={monster}
        selectedStop={null}
        onSelectMonster={vi.fn()}
        onSelectStop={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Capture!/i }));
    await waitFor(() => expect(mockPublishMutate).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(mockPublishMutate).toHaveBeenCalledWith(
      expect.objectContaining({ huntId: 'hunt-1', playerPubkey: 'player-pubkey' })
    );
  });
});

describe('Try Demo entry never dead-ends', () => {
  const indexGameValue = {
    state: { activeHunt: null },
    isHost: () => false,
    startDemoHunt: mockStartDemoHunt,
  };

  beforeEach(() => {
    mockNavigate.mockClear();
    mockStartDemoHunt.mockClear();
    mockGameValue = indexGameValue;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to a playable couch demo when geolocation is DENIED', async () => {
    vi.stubGlobal('navigator', {
      ...window.navigator,
      geolocation: {
        getCurrentPosition: (
          _success: PositionCallback,
          error: PositionErrorCallback
        ) => error({ code: 1, message: 'denied' } as GeolocationPositionError),
      },
    });

    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /Try Demo/i }));

    await waitFor(() => {
      expect(mockStartDemoHunt).toHaveBeenCalledWith(DEFAULT_TEST_LOCATION, {
        manualMovement: true,
      });
      expect(mockNavigate).toHaveBeenCalledWith('/play');
    });
  });

  it('falls back to a couch demo when geolocation is UNSUPPORTED', async () => {
    const { geolocation: _dropped, ...noGeoNavigator } = window.navigator as Navigator & {
      geolocation?: Geolocation;
    };
    vi.stubGlobal('navigator', noGeoNavigator);

    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /Try Demo/i }));

    await waitFor(() => {
      expect(mockStartDemoHunt).toHaveBeenCalledWith(DEFAULT_TEST_LOCATION, {
        manualMovement: true,
      });
      expect(mockNavigate).toHaveBeenCalledWith('/play');
    });
  });

  it('starts a GPS demo at the user coords when geolocation succeeds (control)', async () => {
    vi.stubGlobal('navigator', {
      ...window.navigator,
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 51.5, longitude: -0.12 },
          } as GeolocationPosition),
      },
    });

    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /Try Demo/i }));

    await waitFor(() => {
      expect(mockStartDemoHunt).toHaveBeenCalledWith({ lat: 51.5, lng: -0.12 });
      expect(mockNavigate).toHaveBeenCalledWith('/play');
    });
  });
});
