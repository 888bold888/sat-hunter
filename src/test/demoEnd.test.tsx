import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { getDemoEndReason, shouldShowDemoEnd, formatSats } from '@/lib/gameUtils';
import type { HuntEvent, Monster } from '@/lib/gameTypes';

// --- Mocks for the component test ---------------------------------------------
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const mockLeaveHunt = vi.fn();
let mockGameState: { activeHunt: HuntEvent | null; playerStats: { currentHuntCaptured: number; currentHuntSatsEarned: number } };
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({ state: mockGameState, leaveHunt: mockLeaveHunt }),
}));

// Imported AFTER the mocks above so it picks up the mocked useGame/useNavigate.
import { DemoEndDialog } from '@/components/game/DemoEndDialog';

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
    id: 'demo-1',
    name: 'Demo Hunt',
    description: 'A demo hunt',
    hostPubkey: '',
    totalSats: 21000,
    monsterCount: 3,
    geoFence: {
      center: { lat: 0, lng: 0 },
      bounds: { north: 0.01, south: -0.01, east: 0.01, west: -0.01 },
      radiusMeters: 300,
      boundaryType: 'circle',
    },
    startTime: Date.now(),
    endTime: Date.now() + 30 * 60 * 1000,
    createdAt: Date.now(),
    monsters: [],
    satStops: [],
    status: 'active',
    paymentStatus: 'paid',
    shareCode: 'DEMO',
    participants: [],
    spawnMode: 'all_at_once',
    isDemo: true,
    ...overrides,
  };
}

describe('getDemoEndReason / shouldShowDemoEnd', () => {
  it('fires when the mythic Pisatchu is captured', () => {
    const hunt = makeHunt({
      monsters: [
        makeMonster({ rarity: 'common', captured: false }),
        makeMonster({ rarity: 'mythic', name: 'Pisatchu', captured: true }),
      ],
    });
    expect(getDemoEndReason(hunt)).toBe('mythic');
    expect(shouldShowDemoEnd(hunt)).toBe(true);
  });

  it('fires when every creature is captured', () => {
    const hunt = makeHunt({
      monsters: [
        makeMonster({ rarity: 'common', captured: true }),
        makeMonster({ rarity: 'rare', captured: true }),
      ],
    });
    expect(getDemoEndReason(hunt)).toBe('all-captured');
    expect(shouldShowDemoEnd(hunt)).toBe(true);
  });

  // Regression: every demo contains exactly one mythic, so a cleared field must
  // report 'all-captured' (a distinct reason), not re-report the already-shown
  // 'mythic' — otherwise the end screen can never reopen after "Keep exploring".
  it('reports all-captured, not mythic, when the field is cleared', () => {
    const midDemo = makeHunt({
      monsters: [
        makeMonster({ rarity: 'mythic', name: 'Pisatchu', captured: true }),
        makeMonster({ rarity: 'common', captured: false }),
      ],
    });
    expect(getDemoEndReason(midDemo)).toBe('mythic');

    const cleared = makeHunt({
      monsters: [
        makeMonster({ rarity: 'mythic', name: 'Pisatchu', captured: true }),
        makeMonster({ rarity: 'common', captured: true }),
      ],
    });
    expect(getDemoEndReason(cleared)).toBe('all-captured');
  });

  it('fires when the demo timer has expired', () => {
    const hunt = makeHunt({
      endTime: Date.now() - 1000,
      monsters: [makeMonster({ captured: false })],
    });
    expect(getDemoEndReason(hunt)).toBe('time-expired');
    expect(shouldShowDemoEnd(hunt)).toBe(true);
  });

  it('does NOT fire while the demo is still in progress', () => {
    const hunt = makeHunt({
      monsters: [
        makeMonster({ rarity: 'common', captured: true }),
        makeMonster({ rarity: 'mythic', captured: false }),
      ],
    });
    expect(getDemoEndReason(hunt)).toBeNull();
    expect(shouldShowDemoEnd(hunt)).toBe(false);
  });

  // Failure case: a real hunt must never trigger the demo conversion screen, even
  // when it is fully captured or expired.
  it('does NOT fire for a non-demo hunt (failure case)', () => {
    const allCaught = makeHunt({
      isDemo: false,
      endTime: Date.now() - 1000,
      monsters: [
        makeMonster({ rarity: 'mythic', captured: true }),
        makeMonster({ rarity: 'common', captured: true }),
      ],
    });
    expect(getDemoEndReason(allCaught)).toBeNull();
    expect(shouldShowDemoEnd(allCaught)).toBe(false);
    expect(getDemoEndReason(null)).toBeNull();
  });
});

describe('DemoEndDialog', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockLeaveHunt.mockClear();
  });

  it('renders the capture count and demo sat total', () => {
    mockGameState = {
      activeHunt: makeHunt({ monsters: [makeMonster({ captured: true })] }),
      playerStats: { currentHuntCaptured: 3, currentHuntSatsEarned: 1500 },
    };

    render(<DemoEndDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(formatSats(1500))).toBeInTheDocument();
    expect(screen.getByText(/Demo Sats/i)).toBeInTheDocument();
  });

  it('calls leaveHunt BEFORE navigating on the Join CTA', () => {
    mockGameState = {
      activeHunt: makeHunt({ monsters: [makeMonster({ captured: false })] }),
      playerStats: { currentHuntCaptured: 2, currentHuntSatsEarned: 800 },
    };

    render(<DemoEndDialog open={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Join a real hunt/i }));

    expect(mockLeaveHunt).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/join');
    // Demo cleanup must happen before we route into the real login/join flow.
    expect(mockLeaveHunt.mock.invocationCallOrder[0]).toBeLessThan(
      mockNavigate.mock.invocationCallOrder[0]
    );
  });
});
