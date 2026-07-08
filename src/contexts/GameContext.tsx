import { createContext, useContext, useReducer, useEffect, ReactNode, useCallback, useRef } from 'react';
import type {
  HuntEvent,
  Monster,
  SatStop,
  PlayerStats,
  GeoLocation,
  CapturedMonster,
  HuntHistoryEntry,
} from '@/lib/gameTypes';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePublishLeave } from '@/hooks/usePublishLeave';
import { useKickSubscription } from '@/hooks/useKickSubscription';
import {
  generateMonsters,
  generateMonstersAsync,
  generateSatStops,
  generateSatStopsAsync,
  createGeoFence,
  createPolygonGeoFence,
  filterVisibleMonsters,
  isInCaptureRange,
  isAtSatStop,
  generateId,
  generateShareCode,
  generateShareUrl,
} from '@/lib/gameUtils';
import type { BoundaryType, SpawnMode } from '@/lib/gameTypes';
import type { SatStopsResult, MonstersResult } from '@/lib/gameUtils';
import type { HuntStatus, HuntParticipant } from '@/lib/gameTypes';
import { isMockLocationEnabled, getMockLocation } from '@/lib/devMode';
import { computeWinnerProof } from '@/lib/captureBroadcast';
import {
  checkLocationIntegrity,
  updateCooldownState,
  clearCooldownState,
  clearLocationHistory,
  type LocationIntegrityResult,
} from '@/lib/antiCheat';

export interface GameState {
  activeHunt: HuntEvent | null;
  playerStats: PlayerStats;
  playerLocation: GeoLocation | null;
  playerPosition: GeolocationPosition | null; // Full position for anti-cheat
  lastIntegrityCheck: LocationIntegrityResult | null; // Anti-cheat result
  locationError: string | null;
  nearbyMonsters: Monster[];
  nearbySatStops: SatStop[];
  isCapturing: boolean;
  watchId: number | null;
  wasKicked: boolean;
  kickReason: string | null;
  manualMovement: boolean; // Couch-mode demo: player moves via tap-to-walk, not GPS
  // Tier 2: monsters the local player optimistically credited but the host's
  // authoritative capture-state attributed to another hunter (loser rollback).
  // Append-only for the active hunt; UI toasts once per monsterId (ref-dedup).
  lostCaptures: LostCapture[];
}

// Minimal, npub-free record for the "too slow" toast (winner privacy: the
// broadcast carries only winnerProof, never the winner's real pubkey).
export interface LostCapture {
  monsterId: string;
  monsterName: string;
  satAmount: number;
}

// A single entry of the host's authoritative captured-state broadcast.
export interface CaptureStateEntry {
  monsterId: string;
  capturedAt: number;
  winnerProof: string;
}

type GameAction =
  | { type: 'SET_ACTIVE_HUNT'; hunt: HuntEvent | null; manualMovement?: boolean }
  | { type: 'UPDATE_HUNT'; hunt: HuntEvent }
  | { type: 'SET_PLAYER_LOCATION'; location: GeoLocation }
  | { type: 'SET_PLAYER_POSITION'; position: GeolocationPosition; integrityCheck: LocationIntegrityResult }
  | { type: 'SET_LOCATION_ERROR'; error: string | null }
  | { type: 'SET_NEARBY_MONSTERS'; monsters: Monster[] }
  | { type: 'SET_NEARBY_STOPS'; stops: SatStop[] }
  | { type: 'CAPTURE_MONSTER'; monster: Monster; huntName: string }
  | { type: 'MARK_MONSTER_CLAIMED'; monsterId: string }
  | { type: 'APPLY_CAPTURE_STATE'; entries: CaptureStateEntry[]; myPubkey: string }
  | { type: 'COLLECT_BALLS'; stopId: string; balls: number }
  | { type: 'USE_BALL' }
  | { type: 'SET_CAPTURING'; capturing: boolean }
  | { type: 'SET_WATCH_ID'; watchId: number | null }
  | { type: 'RESET_PLAYER_STATS' }
  | { type: 'LOAD_PLAYER_STATS'; stats: PlayerStats }
  | { type: 'START_HUNT_SESSION'; huntId: string }
  | { type: 'END_HUNT_SESSION'; huntEntry: HuntHistoryEntry }
  | { type: 'PLAYER_KICKED'; reason: string }
  | { type: 'CLEAR_KICKED' }
  | { type: 'EXIT_DEMO_HUNT' };

export const initialPlayerStats: PlayerStats = {
  pubkey: '',
  // Current hunt stats
  currentHuntId: null,
  currentHuntCaptured: 0,
  currentHuntSatsEarned: 0,
  // Lifetime stats
  lifetimeCaptured: 0,
  lifetimeSatsEarned: 0,
  capturedMonsters: [],
  huntHistory: [],
  balls: 10, // Start with 10 balls
  // Legacy fields
  totalCaptured: 0,
  totalSatsEarned: 0,
};

export const initialState: GameState = {
  activeHunt: null,
  playerStats: initialPlayerStats,
  playerLocation: null,
  playerPosition: null,
  lastIntegrityCheck: null,
  locationError: null,
  nearbyMonsters: [],
  nearbySatStops: [],
  isCapturing: false,
  watchId: null,
  wasKicked: false,
  kickReason: null,
  manualMovement: false,
  lostCaptures: [],
};

// scattered_replacement mode: activate the first unspawned monster (shared
// roster order, so every player's device activates the same replacement).
function activateNextUnspawned(monsters: Monster[]): Monster[] {
  const unspawnedIndex = monsters.findIndex(
    m => !m.captured && m.spawnTime === Number.MAX_SAFE_INTEGER
  );
  if (unspawnedIndex === -1) return monsters;
  return monsters.map((m, i) =>
    i === unspawnedIndex
      ? { ...m, spawnTime: Date.now() + Math.random() * 5000 } // Spawn within 5s
      : m
  );
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_ACTIVE_HUNT':
      // manualMovement is a couch-mode demo flag; any hunt change resets it unless
      // explicitly set (only a manual-movement demo start passes it true)
      // Any hunt change clears the previous hunt's loser-rollback toasts.
      return { ...state, activeHunt: action.hunt, manualMovement: action.manualMovement ?? false, lostCaptures: [] };
    case 'UPDATE_HUNT':
      return { ...state, activeHunt: action.hunt };
    case 'SET_PLAYER_LOCATION':
      return { ...state, playerLocation: action.location, locationError: null };
    case 'SET_PLAYER_POSITION':
      return {
        ...state,
        playerLocation: {
          lat: action.position.coords.latitude,
          lng: action.position.coords.longitude,
        },
        playerPosition: action.position,
        lastIntegrityCheck: action.integrityCheck,
        locationError: null,
      };
    case 'SET_LOCATION_ERROR':
      return { ...state, locationError: action.error };
    case 'SET_NEARBY_MONSTERS':
      return { ...state, nearbyMonsters: action.monsters };
    case 'SET_NEARBY_STOPS':
      return { ...state, nearbySatStops: action.stops };
    case 'MARK_MONSTER_CLAIMED': {
      // Tier 1 optimistic claim from another player's capture event tag
      // (tasks/goals/shared-creature-state.md). DISPLAY-ONLY by hard rule: the
      // signal is forgeable, so this may hide a creature but must never touch
      // playerStats, balls, payments, or anti-cheat state.
      if (!state.activeHunt) return state;
      const target = state.activeHunt.monsters.find(m => m.id === action.monsterId);
      if (!target || target.captured) return state;
      let claimedMonsters = state.activeHunt.monsters.map(m =>
        m.id === action.monsterId ? { ...m, captured: true, capturedAt: Date.now() } : m
      );
      // Keep spawn progression identical across players' local worlds: a remote
      // capture activates the next replacement just like a local one. Roster
      // order is shared (host-generated), so everyone activates the same one.
      if (state.activeHunt.spawnMode === 'scattered_replacement') {
        claimedMonsters = activateNextUnspawned(claimedMonsters);
      }
      return {
        ...state,
        activeHunt: { ...state.activeHunt, monsters: claimedMonsters },
        // Remove from the map immediately — a real disappearance is signal, and
        // must not wait for the next location tick or linger via stickiness.
        nearbyMonsters: state.nearbyMonsters.filter(m => m.id !== action.monsterId),
      };
    }
    case 'APPLY_CAPTURE_STATE': {
      // Tier 2: the host's authoritative captured-state broadcast
      // (tasks/goals/shared-creature-state.md). Terminally marks monsters
      // captured and rolls back any credit the local player optimistically took
      // for a monster the host awarded to a different hunter.
      // HARD RULE: this action must NEVER increase any stat or credit anything.
      if (!state.activeHunt) return state;
      const huntId = state.activeHunt.id;
      const entryById = new Map(action.entries.map(e => [e.monsterId, e]));

      // 1. Mark monsters terminally captured. Idempotent: an already-captured
      //    monster keeps its capturedBy/capturedAt; we only fill capturedAt for
      //    newly-captured ones (capturedBy stays unset — the winner's npub is
      //    intentionally not in the broadcast).
      const newlyCapturedIds = new Set<string>();
      const monsters = state.activeHunt.monsters.map(m => {
        const entry = entryById.get(m.id);
        if (!entry || m.captured) return m;
        newlyCapturedIds.add(m.id);
        return { ...m, captured: true, capturedAt: entry.capturedAt };
      });

      // 2. Loser rollback: strip credit for any monster we recorded locally that
      //    the host attributes to someone else. Mirrors exactly what
      //    CAPTURE_MONSTER incremented for a real hunt (demo never reaches here).
      let stats = state.playerStats;
      const alreadyLost = new Set(state.lostCaptures.map(l => l.monsterId));
      const lostAdds: LostCapture[] = [];
      for (const entry of action.entries) {
        const mine = stats.capturedMonsters.find(
          cm => cm.huntId === huntId && cm.monsterId === entry.monsterId
        );
        if (!mine) continue; // never credited locally — nothing to roll back
        // We won the race iff our proof matches the broadcast — then keep credit.
        if (computeWinnerProof(entry.monsterId, action.myPubkey) === entry.winnerProof) continue;
        stats = {
          ...stats,
          capturedMonsters: stats.capturedMonsters.filter(
            cm => !(cm.huntId === huntId && cm.monsterId === entry.monsterId)
          ),
          currentHuntCaptured: stats.currentHuntCaptured - 1,
          currentHuntSatsEarned: stats.currentHuntSatsEarned - mine.satAmount,
          lifetimeCaptured: stats.lifetimeCaptured - 1,
          lifetimeSatsEarned: stats.lifetimeSatsEarned - mine.satAmount,
          totalCaptured: stats.totalCaptured - 1,
          totalSatsEarned: stats.totalSatsEarned - mine.satAmount,
        };
        if (!alreadyLost.has(entry.monsterId)) {
          lostAdds.push({ monsterId: entry.monsterId, monsterName: mine.monsterName, satAmount: mine.satAmount });
          alreadyLost.add(entry.monsterId);
        }
      }

      const monstersChanged = newlyCapturedIds.size > 0;
      const statsChanged = stats !== state.playerStats;
      // Idempotent: a repeated broadcast that changes nothing keeps the same
      // state reference (no re-render, no duplicate toast).
      if (!monstersChanged && !statsChanged) return state;

      return {
        ...state,
        activeHunt: monstersChanged ? { ...state.activeHunt, monsters } : state.activeHunt,
        playerStats: stats,
        // Newly-confirmed captures are signal, not jitter — drop them from the
        // map immediately regardless of distance/stickiness.
        nearbyMonsters: monstersChanged
          ? state.nearbyMonsters.filter(m => !newlyCapturedIds.has(m.id))
          : state.nearbyMonsters,
        lostCaptures: lostAdds.length > 0 ? [...state.lostCaptures, ...lostAdds] : state.lostCaptures,
      };
    }
    case 'CAPTURE_MONSTER': {
      // Demo captures update per-hunt stats and inventory but never lifetime/total stats
      const isDemo = state.activeHunt?.isDemo ?? false;
      const capturedMonster: CapturedMonster = {
        monsterId: action.monster.id,
        monsterName: action.monster.name,
        monsterType: action.monster.type || action.monster.name, // Use type if available, fallback to name
        satAmount: action.monster.satAmount,
        rarity: action.monster.rarity,
        capturedAt: Date.now(),
        huntId: state.activeHunt?.id ?? '',
        huntName: action.huntName,
      };

      // Mark the captured monster
      let updatedMonsters = state.activeHunt?.monsters.map((m) =>
        m.id === action.monster.id
          ? { ...m, captured: true, capturedBy: state.playerStats.pubkey, capturedAt: Date.now() }
          : m
      ) ?? [];

      // For scattered_replacement mode: activate the next unspawned monster
      if (state.activeHunt?.spawnMode === 'scattered_replacement') {
        updatedMonsters = activateNextUnspawned(updatedMonsters);
      }

      return {
        ...state,
        playerStats: {
          ...state.playerStats,
          // Update current hunt stats
          currentHuntCaptured: state.playerStats.currentHuntCaptured + 1,
          currentHuntSatsEarned: state.playerStats.currentHuntSatsEarned + action.monster.satAmount,
          // Update lifetime stats (skipped for demo hunts)
          lifetimeCaptured: isDemo ? state.playerStats.lifetimeCaptured : state.playerStats.lifetimeCaptured + 1,
          lifetimeSatsEarned: isDemo ? state.playerStats.lifetimeSatsEarned : state.playerStats.lifetimeSatsEarned + action.monster.satAmount,
          // Legacy fields (keep in sync, skipped for demo hunts)
          totalCaptured: isDemo ? state.playerStats.totalCaptured : state.playerStats.totalCaptured + 1,
          totalSatsEarned: isDemo ? state.playerStats.totalSatsEarned : state.playerStats.totalSatsEarned + action.monster.satAmount,
          // Add to captured monsters list
          capturedMonsters: [...state.playerStats.capturedMonsters, capturedMonster],
        },
        activeHunt: state.activeHunt
          ? {
              ...state.activeHunt,
              monsters: updatedMonsters,
            }
          : null,
      };
    }
    case 'START_HUNT_SESSION': {
      return {
        ...state,
        playerStats: {
          ...state.playerStats,
          currentHuntId: action.huntId,
          currentHuntCaptured: 0,
          currentHuntSatsEarned: 0,
        },
      };
    }
    case 'END_HUNT_SESSION': {
      // Check if this hunt is already in history
      const existingIndex = state.playerStats.huntHistory.findIndex(
        h => h.huntId === action.huntEntry.huntId
      );
      const updatedHistory = existingIndex >= 0
        ? state.playerStats.huntHistory.map((h, i) =>
            i === existingIndex ? action.huntEntry : h
          )
        : [...state.playerStats.huntHistory, action.huntEntry];

      return {
        ...state,
        playerStats: {
          ...state.playerStats,
          currentHuntId: null,
          currentHuntCaptured: 0,
          currentHuntSatsEarned: 0,
          huntHistory: updatedHistory,
        },
      };
    }
    case 'COLLECT_BALLS':
      return {
        ...state,
        playerStats: {
          ...state.playerStats,
          balls: state.playerStats.balls + action.balls,
        },
        activeHunt: state.activeHunt
          ? {
              ...state.activeHunt,
              satStops: state.activeHunt.satStops.map((s) =>
                s.id === action.stopId ? { ...s, lastCollected: Date.now() } : s
              ),
            }
          : null,
      };
    case 'USE_BALL':
      return {
        ...state,
        playerStats: {
          ...state.playerStats,
          balls: Math.max(0, state.playerStats.balls - 1),
        },
      };
    case 'SET_CAPTURING':
      return { ...state, isCapturing: action.capturing };
    case 'SET_WATCH_ID':
      return { ...state, watchId: action.watchId };
    case 'RESET_PLAYER_STATS':
      return { ...state, playerStats: initialPlayerStats };
    case 'LOAD_PLAYER_STATS':
      return { ...state, playerStats: action.stats };
    case 'PLAYER_KICKED':
      return {
        ...state,
        wasKicked: true,
        kickReason: action.reason,
        activeHunt: null, // Clear the hunt immediately
      };
    case 'CLEAR_KICKED':
      return { ...state, wasKicked: false, kickReason: null };
    case 'EXIT_DEMO_HUNT': {
      // Only acts on demo hunts: strip demo captures and clear per-hunt session + hunt
      if (!state.activeHunt?.isDemo) return state;
      const demoId = state.activeHunt.id;
      return {
        ...state,
        playerStats: {
          ...state.playerStats,
          capturedMonsters: state.playerStats.capturedMonsters.filter(m => m.huntId !== demoId),
          currentHuntId: null,
          currentHuntCaptured: 0,
          currentHuntSatsEarned: 0,
        },
        activeHunt: null,
        manualMovement: false,
      };
    }
    default:
      return state;
  }
}

// Pure capture-eligibility check (exported for testing).
// Real hunts enforce the anti-cheat integrity gate; demo hunts bypass it since
// there is no host and no money at stake, so false positives would break the demo.
export function canCaptureMonster(state: GameState, monster: Monster): boolean {
  if (state.playerStats.balls <= 0) return false;
  if (monster.captured) return false;
  if (!state.playerLocation) return false;
  if (!isInCaptureRange(state.playerLocation, monster.location)) return false;
  if (!state.activeHunt?.isDemo && state.lastIntegrityCheck && !state.lastIntegrityCheck.canCapture) {
    return false;
  }
  return true;
}

// Create hunt result type - includes info about monster and SatStop generation
export interface CreateHuntResult {
  hunt: HuntEvent;
  monstersInfo: MonstersResult;
  satStopsInfo: SatStopsResult;
}

interface GameContextType {
  state: GameState;
  createHunt: (config: {
    name: string;
    description: string;
    totalSats: number;
    monsterCount: number;
    durationMinutes: number;
    center: GeoLocation;
    radiusMeters: number;
    boundaryType?: BoundaryType;
    polygon?: GeoLocation[];
    spawnMode?: SpawnMode;
    maxConcurrentMonsters?: number;
    scheduledStartTime?: number; // Optional: schedule hunt to start in the future
    requiresApproval?: boolean; // Optional: require host approval to join
  }) => Promise<CreateHuntResult>;
  confirmPayment: () => void;
  startHunt: () => void;
  joinHunt: (hunt: HuntEvent) => void;
  startDemoHunt: (center: GeoLocation, options?: { manualMovement?: boolean }) => HuntEvent;
  setManualLocation: (location: GeoLocation) => void;
  exitDemoHunt: () => void;
  leaveHunt: () => void;
  addParticipant: (pubkey: string) => void;
  updateParticipantLocation: (pubkey: string, location: GeoLocation) => void;
  isHost: () => boolean;
  captureMonster: (monster: Monster) => boolean;
  markMonsterClaimed: (monsterId: string) => void;
  applyCaptureState: (entries: CaptureStateEntry[], myPubkey: string) => void;
  collectBalls: (stop: SatStop) => boolean;
  startLocationTracking: () => void;
  stopLocationTracking: () => void;
  getAvailableMonsters: () => Monster[];
  getAvailableStops: () => SatStop[];
  refundUnclaimed: () => void; // Added for refunds
  updateHuntId: (newId: string, preserveStatus?: { status: HuntEvent['status']; paymentStatus: HuntEvent['paymentStatus'] }) => void; // Update hunt ID after Nostr publish
  clearKicked: () => void; // Clear kicked state after user acknowledges
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { user } = useCurrentUser();
  const { publishLeave } = usePublishLeave();
  const [savedStats, setSavedStats] = useLocalStorage<PlayerStats | null>('sathunter:player-stats', null);
  const [savedHunt, setSavedHunt] = useLocalStorage<HuntEvent | null>('sathunter:active-hunt', null);
  const watchIdRef = useRef<number | null>(null); // Use ref to avoid re-renders when watchId changes
  const nearbyMonsterIdsRef = useRef<Set<string>>(new Set()); // Sticky-visibility hysteresis for GPS jitter
  const visibleHuntIdRef = useRef<string | null>(null); // Which hunt the visibility memory belongs to

  // Load saved stats on mount only
  useEffect(() => {
    if (savedStats && user?.pubkey) {
      // Merge with initialPlayerStats to ensure new fields have defaults
      dispatch({
        type: 'LOAD_PLAYER_STATS',
        stats: { ...initialPlayerStats, ...savedStats, pubkey: user.pubkey },
      });
    } else if (user?.pubkey) {
      dispatch({
        type: 'LOAD_PLAYER_STATS',
        stats: { ...initialPlayerStats, pubkey: user.pubkey },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.pubkey]); // Only depend on user, not savedStats to avoid circular updates

  // Load saved hunt on mount only (not when savedHunt changes to avoid circular updates)
  useEffect(() => {
    if (savedHunt && !state.activeHunt) {
      // Check if hunt has ended
      if (savedHunt.endTime <= Date.now()) {
        dispatch({ type: 'SET_ACTIVE_HUNT', hunt: { ...savedHunt, status: 'ended' } });
      } else {
        // Preserve the original status and paymentStatus exactly as saved
        // Don't force any status changes - let the saved state be authoritative
        dispatch({ type: 'SET_ACTIVE_HUNT', hunt: savedHunt });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Save stats when they change (demo stats must never reach localStorage)
  useEffect(() => {
    if (state.playerStats.pubkey) {
      if (state.activeHunt?.isDemo) return;
      setSavedStats(state.playerStats);
    }
  }, [state.playerStats, state.activeHunt?.isDemo, setSavedStats]);

  // Save hunt when it changes (strip captureSecret — must never be persisted).
  // Demo hunts are local-only and never persisted (they don't survive a refresh).
  useEffect(() => {
    if (state.activeHunt && !state.activeHunt.isDemo) {
      // Drop captureSecret (must never persist) and the ephemeral broadcast pubkey
      // (regenerated each host session; a stale one would reject live broadcasts).
      const { captureSecret: _s, hostBroadcastPubkey: _b, ...huntWithoutSecret } = state.activeHunt;
      setSavedHunt(huntWithoutSecret as HuntEvent);
    } else {
      setSavedHunt(null);
    }
  }, [state.activeHunt, setSavedHunt]);

  // Handle being kicked from a hunt
  const handleKicked = useCallback((reason: string) => {
    console.log('[GameContext] Player was kicked:', reason);
    dispatch({ type: 'PLAYER_KICKED', reason });
  }, []);

  // Subscribe to kick events (only when player is in a hunt and not the host).
  // Demo hunts are hostless — no relay subscription.
  useKickSubscription({
    hunt: state.activeHunt?.isDemo ? null : state.activeHunt,
    onKicked: handleKicked,
  });

  // Clear kicked state (called after user acknowledges)
  const clearKicked = useCallback(() => {
    dispatch({ type: 'CLEAR_KICKED' });
  }, []);

  // Update visible/nearby entities when location changes. Visibility hysteresis
  // state lives here (not in map components) so it survives HuntMap remounts —
  // this ref is the ONLY holder of "currently visible" ids; the map renders
  // state.nearbyMonsters verbatim so map and capture UI can never disagree.
  useEffect(() => {
    if (!state.activeHunt) return;
    if (visibleHuntIdRef.current !== state.activeHunt.id) {
      // New hunt: previous hunt's visibility memory must not leak in
      visibleHuntIdRef.current = state.activeHunt.id;
      nearbyMonsterIdsRef.current = new Set();
    }
    if (!state.playerLocation) return;
    const nearbyMonsters = filterVisibleMonsters(
      state.activeHunt.monsters,
      state.playerLocation,
      nearbyMonsterIdsRef.current
    );
    nearbyMonsterIdsRef.current = new Set(nearbyMonsters.map(m => m.id));
    dispatch({ type: 'SET_NEARBY_MONSTERS', monsters: nearbyMonsters });
    const nearbyStops = state.activeHunt.satStops.filter((s) =>
      isAtSatStop(state.playerLocation!, s.location)
    );
    dispatch({ type: 'SET_NEARBY_STOPS', stops: nearbyStops });
  }, [state.playerLocation, state.activeHunt]);

  // Check for hunt end - moved after function definitions to avoid using before declaration

  // Create a new hunt (pending payment)
  const createHunt = useCallback(
    async (config: {
      name: string;
      description: string;
      totalSats: number;
      monsterCount: number;
      durationMinutes: number;
      center: GeoLocation;
      radiusMeters: number;
      boundaryType?: BoundaryType;
      polygon?: GeoLocation[];
      spawnMode?: SpawnMode;
      maxConcurrentMonsters?: number;
      scheduledStartTime?: number;
      requiresApproval?: boolean;
    }): Promise<CreateHuntResult> => {
      // Create geofence based on boundary type
      const geoFence = config.boundaryType === 'polygon' && config.polygon
        ? createPolygonGeoFence(config.polygon)
        : createGeoFence(config.center, config.radiusMeters);

      const huntDurationMs = config.durationMinutes * 60 * 1000;

      // Fetch street locations for monsters and POIs for SatStops in parallel
      const [monstersResult, satStopsResult] = await Promise.all([
        generateMonstersAsync({
          totalSats: config.totalSats,
          monsterCount: config.monsterCount,
          geoFence,
          spawnMode: config.spawnMode,
          huntDurationMs,
          maxConcurrentMonsters: config.maxConcurrentMonsters,
        }),
        generateSatStopsAsync(geoFence),
      ]);

      const now = Date.now();
      // Use scheduled start time if provided, otherwise start immediately
      const startTime = config.scheduledStartTime && config.scheduledStartTime > now
        ? config.scheduledStartTime
        : now;
      const shareCode = generateShareCode();
      const hunt: HuntEvent = {
        id: generateId(),
        name: config.name,
        description: config.description,
        hostPubkey: user?.pubkey ?? '',
        totalSats: config.totalSats,
        monsterCount: config.monsterCount,
        geoFence,
        startTime,
        endTime: startTime + huntDurationMs,
        createdAt: now,
        monsters: monstersResult.monsters,
        satStops: satStopsResult.stops,
        status: 'pending_payment', // Requires payment before activation
        paymentStatus: 'pending',
        shareCode,
        shareUrl: generateShareUrl(shareCode),
        participants: [],
        spawnMode: config.spawnMode || 'all_at_once',
        maxConcurrentMonsters: config.maxConcurrentMonsters,
        requiresApproval: config.requiresApproval,
      };
      dispatch({ type: 'SET_ACTIVE_HUNT', hunt });
      return { hunt, monstersInfo: monstersResult, satStopsInfo: satStopsResult };
    },
    [user?.pubkey]
  );

  // Confirm payment and set to ready (no auto-active)
  const confirmPayment = useCallback(() => {
    if (!state.activeHunt || state.activeHunt.paymentStatus !== 'pending') return;
    const now = Date.now();
    const huntDuration = state.activeHunt.endTime - state.activeHunt.startTime;
    // Preserve scheduled start time if it's in the future, otherwise start now
    const isScheduled = state.activeHunt.startTime > now;
    const startTime = isScheduled ? state.activeHunt.startTime : now;
    const readyHunt: HuntEvent = {
      ...state.activeHunt,
      status: 'ready',
      paymentStatus: 'paid',
      startTime,
      endTime: startTime + huntDuration,
    };
    dispatch({ type: 'UPDATE_HUNT', hunt: readyHunt });
  }, [state.activeHunt]);

  // Start the hunt (only if ready/paid)
  // For scheduled hunts: if called before scheduled time, starts early (host override)
  const startHunt = useCallback(() => {
    if (!state.activeHunt || state.activeHunt.status !== 'ready' || state.activeHunt.paymentStatus !== 'paid') return;
    const now = Date.now();
    const huntDuration = state.activeHunt.endTime - state.activeHunt.startTime;
    // Start now (host is manually starting, possibly early)
    const activeHunt: HuntEvent = {
      ...state.activeHunt,
      status: 'active',
      startTime: now,
      endTime: now + huntDuration,
    };
    dispatch({ type: 'UPDATE_HUNT', hunt: activeHunt });
  }, [state.activeHunt]);

  // Update hunt ID after publishing to Nostr (critical for sync)
  // preserveStatus is needed to avoid race condition - state.activeHunt may not have updated yet
  const updateHuntId = useCallback((newId: string, preserveStatus?: { status: HuntEvent['status']; paymentStatus: HuntEvent['paymentStatus'] }) => {
    if (!state.activeHunt) return;
    const updatedHunt: HuntEvent = {
      ...state.activeHunt,
      id: newId,
      // Use preserved status if provided (to avoid race condition with confirmPayment)
      ...(preserveStatus && { status: preserveStatus.status, paymentStatus: preserveStatus.paymentStatus }),
    };
    dispatch({ type: 'UPDATE_HUNT', hunt: updatedHunt });
    console.log('Hunt ID updated to Nostr event ID:', newId, 'status:', updatedHunt.status, 'paymentStatus:', updatedHunt.paymentStatus);
  }, [state.activeHunt]);

  // Join an existing hunt
  const joinHunt = useCallback((hunt: HuntEvent) => {
    dispatch({ type: 'SET_ACTIVE_HUNT', hunt });
    // Start a new hunt session (resets per-hunt stats)
    dispatch({ type: 'START_HUNT_SESSION', huntId: hunt.id });
  }, []);

  // Start a fully local demo hunt (no Nostr, no NWC, no persistence)
  const startDemoHunt = useCallback((center: GeoLocation, options?: { manualMovement?: boolean }): HuntEvent => {
    const geoFence = createGeoFence(center, 300);

    // Sync generators use random points (no Overpass call) — correct for a local demo
    const monsters = generateMonsters({ totalSats: 21000, monsterCount: 8, geoFence });
    const now = Date.now();
    // Sync generator randomizes spawn within 60s; a demo must be instantly playable
    monsters.forEach((m) => { m.spawnTime = now; });

    // Plant a low-value common right next to the player so the very first tap succeeds
    const commons = monsters.filter((m) => m.rarity === 'common');
    const plant = commons.length > 0
      ? commons.reduce((min, m) => (m.satAmount < min.satAmount ? m : min))
      : monsters[0];
    plant.location = { lat: center.lat + 0.0001, lng: center.lng }; // ~11m, inside 15m capture range

    const satStops = generateSatStops(geoFence, 5);

    const hunt: HuntEvent = {
      id: 'demo-' + generateId(),
      name: 'Demo Hunt',
      description: 'A local demo hunt — walk up to a creature and tap to catch it. No login, no wallet, no payouts.',
      hostPubkey: '',
      totalSats: 21000,
      monsterCount: 8,
      geoFence,
      startTime: now,
      endTime: now + 30 * 60 * 1000,
      createdAt: now,
      monsters,
      satStops,
      status: 'active',
      paymentStatus: 'paid',
      shareCode: 'DEMO',
      participants: [],
      spawnMode: 'all_at_once',
      isDemo: true,
    };

    const manualMovement = options?.manualMovement ?? false;
    dispatch({ type: 'SET_ACTIVE_HUNT', hunt, manualMovement });
    dispatch({ type: 'START_HUNT_SESSION', huntId: hunt.id });
    // Couch mode has no GPS — drop the player at the fence center so the map renders
    if (manualMovement) {
      dispatch({ type: 'SET_PLAYER_LOCATION', location: center });
    }
    return hunt;
  }, []);

  // Inject a player location for couch-mode (tap-to-walk) demos only.
  // Security: a real hunt must NEVER accept an injected location — that would be an
  // anti-cheat bypass. Guard on both isDemo and manualMovement.
  const setManualLocation = useCallback((location: GeoLocation) => {
    if (!state.activeHunt?.isDemo || !state.manualMovement) return;
    dispatch({ type: 'SET_PLAYER_LOCATION', location });
  }, [state.activeHunt?.isDemo, state.manualMovement]);

  // Exit a demo hunt: strip demo captures and clear all demo state (no publish, no history)
  const exitDemoHunt = useCallback(() => {
    if (!state.activeHunt?.isDemo) return;
    clearCooldownState();
    clearLocationHistory();
    dispatch({ type: 'EXIT_DEMO_HUNT' });
  }, [state.activeHunt?.isDemo]);

  // Leave the current hunt
  const leaveHunt = useCallback(() => {
    // Demo hunts never publish or land in history — just clear local demo state
    if (state.activeHunt?.isDemo) {
      clearCooldownState();
      clearLocationHistory();
      dispatch({ type: 'EXIT_DEMO_HUNT' });
      return;
    }
    // Publish leave event to Nostr (only if player, not host)
    if (state.activeHunt && user?.pubkey && state.activeHunt.hostPubkey !== user.pubkey) {
      // Fire and forget - don't block UI
      publishLeave(state.activeHunt.id, state.activeHunt.shareCode, state.activeHunt.hostPubkey);

      // Save hunt to history before leaving
      const huntEntry: HuntHistoryEntry = {
        huntId: state.activeHunt.id,
        huntName: state.activeHunt.name,
        hostPubkey: state.activeHunt.hostPubkey,
        startTime: state.activeHunt.startTime,
        endTime: state.activeHunt.endTime,
        joinedAt: state.playerStats.currentHuntId === state.activeHunt.id
          ? Date.now() - (state.playerStats.currentHuntCaptured > 0 ? 60000 : 0) // Approximate join time
          : Date.now(),
        leftAt: Date.now(),
        monstersCapt: state.playerStats.currentHuntCaptured,
        satsEarned: state.playerStats.currentHuntSatsEarned,
        capturedMonsters: state.playerStats.capturedMonsters.filter(
          m => m.huntId === state.activeHunt?.id
        ),
      };
      dispatch({ type: 'END_HUNT_SESSION', huntEntry });
    }
    // Clear anti-cheat state when leaving hunt
    clearCooldownState();
    clearLocationHistory();
    dispatch({ type: 'SET_ACTIVE_HUNT', hunt: null });
  }, [state.activeHunt, state.playerStats, user?.pubkey, publishLeave]);

  // Add participant to hunt
  const addParticipant = useCallback((pubkey: string) => {
    if (!state.activeHunt) return;
    // Check if already a participant
    if (state.activeHunt.participants.some(p => p.pubkey === pubkey)) return;
    const newParticipant: HuntParticipant = {
      pubkey,
      joinedAt: Date.now(),
      totalCaptured: 0,
      totalSatsEarned: 0,
    };
    const updatedHunt: HuntEvent = {
      ...state.activeHunt,
      participants: [...state.activeHunt.participants, newParticipant],
    };
    dispatch({ type: 'UPDATE_HUNT', hunt: updatedHunt });
  }, [state.activeHunt]);

  // Update participant location (for host dashboard)
  const updateParticipantLocation = useCallback((pubkey: string, location: GeoLocation) => {
    if (!state.activeHunt) return;
    const updatedHunt: HuntEvent = {
      ...state.activeHunt,
      participants: state.activeHunt.participants.map(p =>
        p.pubkey === pubkey
          ? { ...p, lastLocation: location, lastLocationUpdate: Date.now() }
          : p
      ),
    };
    dispatch({ type: 'UPDATE_HUNT', hunt: updatedHunt });
  }, [state.activeHunt]);

  // Check if current user is the host
  const isHost = useCallback((): boolean => {
    if (!state.activeHunt || !user?.pubkey) return false;
    return state.activeHunt.hostPubkey === user.pubkey;
  }, [state.activeHunt, user?.pubkey]);

  // Capture a monster
  const captureMonster = useCallback(
    (monster: Monster): boolean => {
      if (!canCaptureMonster(state, monster)) {
        if (state.lastIntegrityCheck && !state.lastIntegrityCheck.canCapture && !state.activeHunt?.isDemo) {
          console.warn('[AntiCheat] Capture blocked:', state.lastIntegrityCheck.reason);
        }
        return false;
      }

      // Record capture for cooldown tracking (real hunts only — demo has no anti-cheat)
      if (!state.activeHunt?.isDemo && state.lastIntegrityCheck) {
        updateCooldownState(state.playerLocation!);
      }

      dispatch({ type: 'USE_BALL' });
      dispatch({
        type: 'CAPTURE_MONSTER',
        monster,
        huntName: state.activeHunt?.name ?? 'Unknown Hunt',
      });
      return true;
    },
    [state]
  );

  // Tier 1: another player's capture event claimed this monster — hide it.
  // Display-only (see MARK_MONSTER_CLAIMED reducer case).
  const markMonsterClaimed = useCallback((monsterId: string) => {
    dispatch({ type: 'MARK_MONSTER_CLAIMED', monsterId });
  }, []);

  // Tier 2: apply the host's authoritative captured-state broadcast (terminal
  // captures + loser rollback). See APPLY_CAPTURE_STATE reducer case.
  const applyCaptureState = useCallback((entries: CaptureStateEntry[], myPubkey: string) => {
    dispatch({ type: 'APPLY_CAPTURE_STATE', entries, myPubkey });
  }, []);

  // Collect balls from a sat stop
  const collectBalls = useCallback(
    (stop: SatStop): boolean => {
      if (!state.playerLocation) return false;
      if (!isAtSatStop(state.playerLocation, stop.location)) return false;
      // Check cooldown
      if (stop.lastCollected && Date.now() - stop.lastCollected < stop.cooldownMs) {
        return false;
      }
      dispatch({ type: 'COLLECT_BALLS', stopId: stop.id, balls: stop.ballsPerCollection });
      return true;
    },
    [state.playerLocation]
  );

  // Refund unclaimed sats to host (placeholder - requires wallet integration)
  const refundUnclaimed = useCallback(() => {
    if (!state.activeHunt || !isHost() || state.activeHunt.status !== 'ended') return;
    const unclaimedMonsters = state.activeHunt.monsters.filter(m => !m.captured);
    const unclaimedSats = unclaimedMonsters.reduce((sum, m) => sum + m.satAmount, 0);
    if (unclaimedSats <= 0) return;
    // Log for now - actual refund requires wallet integration
    console.log(`Hunt ended. Unclaimed sats: ${unclaimedSats}`);
  }, [state.activeHunt, isHost]);

  // Check for hunt end and trigger refund
  useEffect(() => {
    const interval = setInterval(() => {
      if (state.activeHunt && state.activeHunt.endTime < Date.now() && state.activeHunt.status !== 'ended') {
        const endedHunt = { ...state.activeHunt, status: 'ended' as HuntStatus };
        dispatch({ type: 'UPDATE_HUNT', hunt: endedHunt });
        refundUnclaimed();
      }
    }, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [state.activeHunt, refundUnclaimed]);

  // Start location tracking
  const startLocationTracking = useCallback(async () => {
    // Already tracking
    if (watchIdRef.current !== null) return;

    // Couch-mode demo drives location via tap-to-walk — never start a GPS watch or
    // surface a location error (GamePage calls this unconditionally on mount).
    if (state.activeHunt?.isDemo && state.manualMovement) return;

    // Check for mock location in development mode
    if (isMockLocationEnabled()) {
      const mockLoc = getMockLocation();
      if (mockLoc) {
        dispatch({ type: 'SET_PLAYER_LOCATION', location: mockLoc });
        console.log('[DEV] Using mock location:', mockLoc);
        return;
      }
    }
    if (!navigator.geolocation) {
      dispatch({ type: 'SET_LOCATION_ERROR', error: 'Geolocation is not supported by your browser' });
      return;
    }
    // Check if the page is served over HTTPS or localhost
    const isSecureContext = window.isSecureContext || window.location.hostname === 'localhost';
    if (!isSecureContext) {
      dispatch({
        type: 'SET_LOCATION_ERROR',
        error: 'Geolocation requires HTTPS. Please use a secure connection.'
      });
      return;
    }

    // Check if permission was previously denied (Permissions API).
    // On iOS/Android, once denied, watchPosition silently fails without re-prompting.
    // Detect this and show actionable instructions instead of a useless retry loop.
    if (navigator.permissions) {
      try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        if (status.state === 'denied') {
          dispatch({
            type: 'SET_LOCATION_ERROR',
            error: 'Location permission was denied. Please go to your browser or device Settings → find this site → enable Location, then refresh the page.'
          });
          return;
        }
      } catch {
        // Permissions API not supported for geolocation on this browser — fall through
      }
    }

    // Clear stale error so UI shows "Loading..." during the attempt
    dispatch({ type: 'SET_LOCATION_ERROR', error: null });

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        // Perform anti-cheat integrity check on every location update
        const integrityCheck = checkLocationIntegrity(position);
        dispatch({
          type: 'SET_PLAYER_POSITION',
          position,
          integrityCheck,
        });
      },
      (error) => {
        let errorMessage = 'Location error occurred';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission was denied. Please go to your browser or device Settings → find this site → enable Location, then refresh the page.';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location unavailable. Please check your device settings';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out. Please try again';
            break;
          default:
            errorMessage = error.message;
        }
        dispatch({ type: 'SET_LOCATION_ERROR', error: errorMessage });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );
    watchIdRef.current = watchId;
  }, [state.activeHunt?.isDemo, state.manualMovement]);

  // Stop location tracking
  const stopLocationTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  // Get available (uncaptured) monsters
  const getAvailableMonsters = useCallback((): Monster[] => {
    if (!state.activeHunt) return [];
    const now = Date.now();
    return state.activeHunt.monsters.filter((m) => !m.captured && m.spawnTime <= now);
  }, [state.activeHunt]);

  // Get available sat stops (not on cooldown)
  const getAvailableStops = useCallback((): SatStop[] => {
    if (!state.activeHunt) return [];
    const now = Date.now();
    return state.activeHunt.satStops.filter(
      (s) => !s.lastCollected || now - s.lastCollected >= s.cooldownMs
    );
  }, [state.activeHunt]);

  return (
    <GameContext.Provider
      value={{
        state,
        createHunt,
        confirmPayment,
        startHunt,
        joinHunt,
        startDemoHunt,
        setManualLocation,
        exitDemoHunt,
        leaveHunt,
        addParticipant,
        updateParticipantLocation,
        isHost,
        captureMonster,
        markMonsterClaimed,
        applyCaptureState,
        collectBalls,
        startLocationTracking,
        stopLocationTracking,
        getAvailableMonsters,
        getAvailableStops,
        refundUnclaimed,
        updateHuntId,
        clearKicked,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}