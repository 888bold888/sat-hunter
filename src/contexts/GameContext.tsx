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
  generateMonstersAsync,
  generateSatStopsAsync,
  createGeoFence,
  createPolygonGeoFence,
  calculateDistance,
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
import {
  checkLocationIntegrity,
  updateCooldownState,
  clearCooldownState,
  clearLocationHistory,
  type LocationIntegrityResult,
} from '@/lib/antiCheat';

interface GameState {
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
}

type GameAction =
  | { type: 'SET_ACTIVE_HUNT'; hunt: HuntEvent | null }
  | { type: 'UPDATE_HUNT'; hunt: HuntEvent }
  | { type: 'SET_PLAYER_LOCATION'; location: GeoLocation }
  | { type: 'SET_PLAYER_POSITION'; position: GeolocationPosition; integrityCheck: LocationIntegrityResult }
  | { type: 'SET_LOCATION_ERROR'; error: string | null }
  | { type: 'SET_NEARBY_MONSTERS'; monsters: Monster[] }
  | { type: 'SET_NEARBY_STOPS'; stops: SatStop[] }
  | { type: 'CAPTURE_MONSTER'; monster: Monster; huntName: string }
  | { type: 'COLLECT_BALLS'; stopId: string; balls: number }
  | { type: 'USE_BALL' }
  | { type: 'SET_CAPTURING'; capturing: boolean }
  | { type: 'SET_WATCH_ID'; watchId: number | null }
  | { type: 'RESET_PLAYER_STATS' }
  | { type: 'LOAD_PLAYER_STATS'; stats: PlayerStats }
  | { type: 'START_HUNT_SESSION'; huntId: string }
  | { type: 'END_HUNT_SESSION'; huntEntry: HuntHistoryEntry }
  | { type: 'PLAYER_KICKED'; reason: string }
  | { type: 'CLEAR_KICKED' };

const initialPlayerStats: PlayerStats = {
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

const initialState: GameState = {
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
};

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_ACTIVE_HUNT':
      return { ...state, activeHunt: action.hunt };
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
    case 'CAPTURE_MONSTER': {
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
        const unspawnedIndex = updatedMonsters.findIndex(
          m => !m.captured && m.spawnTime === Number.MAX_SAFE_INTEGER
        );
        if (unspawnedIndex !== -1) {
          updatedMonsters = updatedMonsters.map((m, i) =>
            i === unspawnedIndex
              ? { ...m, spawnTime: Date.now() + Math.random() * 5000 } // Spawn within 5s
              : m
          );
        }
      }

      return {
        ...state,
        playerStats: {
          ...state.playerStats,
          // Update current hunt stats
          currentHuntCaptured: state.playerStats.currentHuntCaptured + 1,
          currentHuntSatsEarned: state.playerStats.currentHuntSatsEarned + action.monster.satAmount,
          // Update lifetime stats
          lifetimeCaptured: state.playerStats.lifetimeCaptured + 1,
          lifetimeSatsEarned: state.playerStats.lifetimeSatsEarned + action.monster.satAmount,
          // Legacy fields (keep in sync)
          totalCaptured: state.playerStats.totalCaptured + 1,
          totalSatsEarned: state.playerStats.totalSatsEarned + action.monster.satAmount,
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
    default:
      return state;
  }
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
  leaveHunt: () => void;
  addParticipant: (pubkey: string) => void;
  updateParticipantLocation: (pubkey: string, location: GeoLocation) => void;
  isHost: () => boolean;
  captureMonster: (monster: Monster) => boolean;
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
  const nearbyMonsterIdsRef = useRef<Set<string>>(new Set()); // Hysteresis for GPS jitter

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

  // Save stats when they change
  useEffect(() => {
    if (state.playerStats.pubkey) {
      setSavedStats(state.playerStats);
    }
  }, [state.playerStats, setSavedStats]);

  // Save hunt when it changes (strip captureSecret — must never be persisted)
  useEffect(() => {
    if (state.activeHunt) {
      const { captureSecret: _, ...huntWithoutSecret } = state.activeHunt;
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

  // Subscribe to kick events (only when player is in a hunt and not the host)
  useKickSubscription({
    hunt: state.activeHunt,
    onKicked: handleKicked,
  });

  // Clear kicked state (called after user acknowledges)
  const clearKicked = useCallback(() => {
    dispatch({ type: 'CLEAR_KICKED' });
  }, []);

  // Update nearby entities when location changes
  useEffect(() => {
    if (!state.playerLocation || !state.activeHunt) return;
    // Hysteresis: appear at 15m, disappear at 25m to prevent GPS jitter flickering
    const APPEAR_RANGE = 15;
    const DISAPPEAR_RANGE = 25;
    const nearbyMonsters = state.activeHunt.monsters.filter((m) => {
      if (m.captured) return false;
      const dist = calculateDistance(state.playerLocation!, m.location);
      const wasNearby = nearbyMonsterIdsRef.current.has(m.id);
      return wasNearby ? dist <= DISAPPEAR_RANGE : dist <= APPEAR_RANGE;
    });
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

  // Leave the current hunt
  const leaveHunt = useCallback(() => {
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
      if (state.playerStats.balls <= 0) return false;
      if (monster.captured) return false;
      if (!state.playerLocation) return false;
      if (!isInCaptureRange(state.playerLocation, monster.location)) return false;

      // Anti-cheat check: verify location integrity
      if (state.lastIntegrityCheck) {
        if (!state.lastIntegrityCheck.canCapture) {
          console.warn('[AntiCheat] Capture blocked:', state.lastIntegrityCheck.reason);
          return false;
        }
        // Record capture for cooldown tracking
        updateCooldownState(state.playerLocation);
      }

      dispatch({ type: 'USE_BALL' });
      dispatch({
        type: 'CAPTURE_MONSTER',
        monster,
        huntName: state.activeHunt?.name ?? 'Unknown Hunt',
      });
      return true;
    },
    [state.playerStats.balls, state.playerLocation, state.activeHunt?.name, state.lastIntegrityCheck]
  );

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
  }, []);

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
        leaveHunt,
        addParticipant,
        updateParticipantLocation,
        isHost,
        captureMonster,
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