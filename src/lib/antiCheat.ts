/**
 * Anti-Cheat Module for Sat Hunter
 * Phase 1: Client-side location integrity and trust scoring
 */

import type { GeoLocation } from './gameTypes';
import { calculateDistance } from './gameUtils';
import ngeohash from 'ngeohash';
import { getMotionScore, getMotionStats } from './motionTracking';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// ══════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════

export const ANTI_CHEAT_CONFIG = {
  // Velocity limits
  MAX_VELOCITY_MS: 138.89, // 500 km/h in m/s (allows for fast trains/planes)
  SUSPICIOUS_VELOCITY_MS: 50, // 180 km/h - flags but doesn't reject

  // Trust score thresholds
  MIN_TRUST_SCORE: 70,

  // Geohash precision for privacy (5 chars = ~5km cells)
  GEOHASH_PRECISION: 5,

  // Cooldown settings
  COOLDOWN_DISTANCE_KM: 10, // Trigger cooldown if jump > 10km
  COOLDOWN_MIN_MINUTES: 2,
  COOLDOWN_MAX_MINUTES: 120,

  // Location history
  MAX_LOCATION_HISTORY: 20,

  // Accuracy thresholds
  SUSPICIOUS_PERFECT_ACCURACY: 1, // Meters - sub-1m is spoofing (real GNSS can hit 1-2m)
  POOR_ACCURACY_THRESHOLD: 100, // Meters - very poor GPS
};

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

export interface LocationReading {
  lat: number;
  lng: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

export interface EnvironmentCheck {
  isMockLocationEnabled: boolean;
  isEmulator: boolean;
  hasRequiredSensors: boolean;
  userAgent: string;
}

export interface TrustScoreBreakdown {
  location: number;
  environment: number;
  velocity: number;
  history: number;
  motion: number; // Phase 2C: Accelerometer-based anti-spoofing
}

export interface TrustScoreResult {
  composite: number;
  breakdown: TrustScoreBreakdown;
  flags: string[];
  approved: boolean;
}

export interface CooldownState {
  lastCaptureLocation: GeoLocation | null;
  lastCaptureTimestamp: number | null;
}

export interface CooldownResult {
  allowed: boolean;
  remainingMinutes?: number;
  reason?: string;
}

export interface VelocityCheck {
  valid: boolean;
  velocityMs: number;
  flags: string[];
}

// ══════════════════════════════════════════════════════════════
// LOCATION HISTORY (in-memory for session)
// ══════════════════════════════════════════════════════════════

let locationHistory: LocationReading[] = [];

export function addLocationToHistory(reading: LocationReading): void {
  locationHistory.push(reading);
  if (locationHistory.length > ANTI_CHEAT_CONFIG.MAX_LOCATION_HISTORY) {
    locationHistory.shift();
  }
}

export function getLocationHistory(): LocationReading[] {
  return [...locationHistory];
}

export function clearLocationHistory(): void {
  locationHistory = [];
}

// ══════════════════════════════════════════════════════════════
// ENVIRONMENT DETECTION
// ══════════════════════════════════════════════════════════════

/**
 * Check for mock location and emulator indicators
 * Note: These checks are best-effort on web - native apps can do more
 */
export function checkEnvironment(): EnvironmentCheck {
  const userAgent = navigator.userAgent.toLowerCase();

  // Emulator detection (basic heuristics)
  const emulatorSignatures = [
    'sdk',
    'emulator',
    'simulator',
    'bluestacks',
    'nox',
    'genymotion',
    'android sdk built for x86',
  ];

  const isEmulator = emulatorSignatures.some(sig => userAgent.includes(sig));

  // Check for required sensors (accelerometer, etc.)
  // On web, we can check DeviceMotionEvent support
  const hasRequiredSensors = typeof DeviceMotionEvent !== 'undefined';

  // Mock location detection is limited on web
  // We rely on other signals (accuracy, velocity) to detect spoofing
  const isMockLocationEnabled = false; // Can't directly detect on web

  return {
    isMockLocationEnabled,
    isEmulator,
    hasRequiredSensors,
    userAgent,
  };
}

/**
 * Detect emulator based on various signals
 */
export function detectEmulator(): boolean {
  const ua = navigator.userAgent.toLowerCase();

  // Check user agent
  const uaSignatures = ['sdk', 'emulator', 'simulator', 'bluestacks', 'nox'];
  if (uaSignatures.some(sig => ua.includes(sig))) {
    return true;
  }

  // Check for missing features common in emulators
  // getBattery is not standard - many emulators don't implement Battery API
  // But this is also true for some browsers, so it's just a signal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(navigator as any).getBattery) {
    // Signal but not deterministic
  }

  // Check screen dimensions (emulators often have unusual sizes)
  const { width, height } = screen;
  if (width === 0 || height === 0) {
    return true;
  }

  return false;
}

// ══════════════════════════════════════════════════════════════
// VELOCITY ANALYSIS
// ══════════════════════════════════════════════════════════════

/**
 * Check velocity between current location and recent history
 */
export function checkVelocity(
  currentLocation: LocationReading,
  history: LocationReading[]
): VelocityCheck {
  const flags: string[] = [];
  let maxVelocity = 0;

  if (history.length === 0) {
    return { valid: true, velocityMs: 0, flags: [] };
  }

  // Check velocity against each recent location
  for (const prevLocation of history) {
    const rawDistance = calculateDistance(
      { lat: prevLocation.lat, lng: prevLocation.lng },
      { lat: currentLocation.lat, lng: currentLocation.lng }
    );

    const timeDeltaSeconds = (currentLocation.timestamp - prevLocation.timestamp) / 1000;

    if (timeDeltaSeconds <= 0) continue;

    // Subtract combined GPS accuracy — movement within error circles isn't real movement.
    // Raw GNSS (e.g. GrapheneOS) can jump 50-100m between readings when satellite lock shifts.
    const accuracyMargin = (currentLocation.accuracy || 0) + (prevLocation.accuracy || 0);
    const distance = Math.max(0, rawDistance - accuracyMargin);

    const velocity = distance / timeDeltaSeconds;
    maxVelocity = Math.max(maxVelocity, velocity);

    // Check for teleportation (impossible velocity)
    if (velocity > ANTI_CHEAT_CONFIG.MAX_VELOCITY_MS) {
      flags.push(`TELEPORTATION: ${Math.round(velocity)} m/s (${Math.round(velocity * 3.6)} km/h)`);
    } else if (velocity > ANTI_CHEAT_CONFIG.SUSPICIOUS_VELOCITY_MS) {
      flags.push(`HIGH_VELOCITY: ${Math.round(velocity)} m/s (${Math.round(velocity * 3.6)} km/h)`);
    }
  }

  const valid = !flags.some(f => f.startsWith('TELEPORTATION'));

  return { valid, velocityMs: maxVelocity, flags };
}

// ══════════════════════════════════════════════════════════════
// LOCATION ACCURACY ANALYSIS
// ══════════════════════════════════════════════════════════════

/**
 * Analyze location accuracy for anomalies
 */
export function analyzeAccuracy(reading: LocationReading): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 100;

  // Suspiciously perfect accuracy (often indicates spoofing)
  if (reading.accuracy < ANTI_CHEAT_CONFIG.SUSPICIOUS_PERFECT_ACCURACY) {
    flags.push(`PERFECT_ACCURACY: ${reading.accuracy}m`);
    score -= 20;
  }

  // Very poor accuracy
  if (reading.accuracy > ANTI_CHEAT_CONFIG.POOR_ACCURACY_THRESHOLD) {
    flags.push(`POOR_ACCURACY: ${reading.accuracy}m`);
    score -= 15;
  }

  // Check for sudden accuracy improvements in history
  const history = getLocationHistory();
  if (history.length >= 2) {
    const prevReading = history[history.length - 1];

    // Sudden jump from poor to perfect accuracy
    if (prevReading.accuracy > 50 && reading.accuracy < 5) {
      flags.push('ACCURACY_JUMP: Sudden improvement from poor to perfect');
      score -= 25;
    }
  }

  return { score: Math.max(0, score), flags };
}

// ══════════════════════════════════════════════════════════════
// TRUST SCORE CALCULATION
// ══════════════════════════════════════════════════════════════

/**
 * Calculate composite trust score for a location reading
 */
export function calculateTrustScore(
  reading: LocationReading,
  environment: EnvironmentCheck
): TrustScoreResult {
  const flags: string[] = [];
  const breakdown: TrustScoreBreakdown = {
    location: 100,
    environment: 100,
    velocity: 100,
    history: 100,
    motion: 100, // Phase 2C
  };

  // ──────────────────────────────────────────────────────────────
  // LOCATION SCORE
  // ──────────────────────────────────────────────────────────────

  const accuracyAnalysis = analyzeAccuracy(reading);
  breakdown.location = accuracyAnalysis.score;
  flags.push(...accuracyAnalysis.flags);

  // ──────────────────────────────────────────────────────────────
  // ENVIRONMENT SCORE
  // ──────────────────────────────────────────────────────────────

  if (environment.isMockLocationEnabled) {
    breakdown.environment = 0;
    flags.push('MOCK_LOCATION_ENABLED');
  }

  if (environment.isEmulator) {
    breakdown.environment -= 80;
    flags.push('EMULATOR_DETECTED');
  }

  if (!environment.hasRequiredSensors) {
    breakdown.environment -= 20;
    flags.push('MISSING_SENSORS');
  }

  breakdown.environment = Math.max(0, breakdown.environment);

  // ──────────────────────────────────────────────────────────────
  // VELOCITY SCORE
  // ──────────────────────────────────────────────────────────────

  const history = getLocationHistory();
  const velocityCheck = checkVelocity(reading, history);

  if (!velocityCheck.valid) {
    breakdown.velocity = 0;
  } else if (velocityCheck.velocityMs > ANTI_CHEAT_CONFIG.SUSPICIOUS_VELOCITY_MS) {
    breakdown.velocity = 60;
  }

  flags.push(...velocityCheck.flags);

  // ──────────────────────────────────────────────────────────────
  // HISTORY SCORE (session behavior)
  // ──────────────────────────────────────────────────────────────

  // New sessions start with full history score
  // This could be enhanced with persistent reputation later
  if (history.length < 3) {
    breakdown.history = 90; // Slight penalty for new session
  }

  // Check for consistent suspicious patterns (only hard signals, not accuracy)
  const suspiciousInHistory = flags.filter(f =>
    f.startsWith('TELEPORTATION')
  ).length;

  if (suspiciousInHistory >= 3) {
    breakdown.history -= 30;
    flags.push('REPEATED_SUSPICIOUS_PATTERNS');
  }

  breakdown.history = Math.max(0, breakdown.history);

  // ──────────────────────────────────────────────────────────────
  // MOTION SCORE (Phase 2C: Accelerometer anti-spoofing)
  // ──────────────────────────────────────────────────────────────

  // Calculate distance moved since last reading
  let distanceMoved = 0;
  if (history.length > 0) {
    const lastReading = history[history.length - 1];
    distanceMoved = calculateDistance(
      { lat: lastReading.lat, lng: lastReading.lng },
      { lat: reading.lat, lng: reading.lng }
    );
  }

  breakdown.motion = getMotionScore(distanceMoved);

  // Add motion flags
  const motionStats = getMotionStats();
  if (!motionStats.sensorAvailable) {
    flags.push('NO_MOTION_SENSORS');
  } else if (!motionStats.permissionGranted) {
    flags.push('MOTION_PERMISSION_DENIED');
  } else if (breakdown.motion < 50) {
    flags.push(`NO_MOTION_DETECTED: GPS moved ${Math.round(distanceMoved)}m but no device movement`);
  } else if (breakdown.motion < 80) {
    flags.push(`LOW_MOTION: Limited device movement for ${Math.round(distanceMoved)}m GPS change`);
  }

  // ──────────────────────────────────────────────────────────────
  // COMPOSITE SCORE (weighted average)
  // ──────────────────────────────────────────────────────────────

  const composite = Math.round(
    breakdown.location * 0.25 +
    breakdown.environment * 0.25 +
    breakdown.velocity * 0.20 +
    breakdown.history * 0.10 +
    breakdown.motion * 0.20  // Phase 2C: 20% weight for motion
  );

  return {
    composite,
    breakdown,
    flags,
    approved: composite >= ANTI_CHEAT_CONFIG.MIN_TRUST_SCORE,
  };
}

// ══════════════════════════════════════════════════════════════
// COOLDOWN SYSTEM
// ══════════════════════════════════════════════════════════════

const COOLDOWN_STORAGE_KEY = 'sat-hunter-cooldown';

/**
 * Get current cooldown state from localStorage
 */
export function getCooldownState(): CooldownState {
  try {
    const stored = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return { lastCaptureLocation: null, lastCaptureTimestamp: null };
}

/**
 * Update cooldown state after a capture
 */
export function updateCooldownState(location: GeoLocation): void {
  const state: CooldownState = {
    lastCaptureLocation: location,
    lastCaptureTimestamp: Date.now(),
  };
  localStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Clear cooldown state (e.g., when leaving a hunt)
 */
export function clearCooldownState(): void {
  localStorage.removeItem(COOLDOWN_STORAGE_KEY);
}

/**
 * Check if a capture is allowed based on cooldown
 */
export function checkCooldown(currentLocation: GeoLocation): CooldownResult {
  const state = getCooldownState();

  if (!state.lastCaptureLocation || !state.lastCaptureTimestamp) {
    return { allowed: true };
  }

  const distance = calculateDistance(state.lastCaptureLocation, currentLocation);
  const distanceKm = distance / 1000;

  const timeSinceLastCapture = Date.now() - state.lastCaptureTimestamp;

  // No cooldown for small distances
  if (distanceKm < ANTI_CHEAT_CONFIG.COOLDOWN_DISTANCE_KM) {
    return { allowed: true };
  }

  // Calculate required cooldown based on distance (logarithmic scale)
  // 10km = 2min, 100km = 20min, 1000km = 60min
  const requiredCooldownMinutes = Math.min(
    ANTI_CHEAT_CONFIG.COOLDOWN_MAX_MINUTES,
    ANTI_CHEAT_CONFIG.COOLDOWN_MIN_MINUTES * Math.log10(distanceKm) * 10
  );

  const requiredCooldownMs = requiredCooldownMinutes * 60 * 1000;

  if (timeSinceLastCapture < requiredCooldownMs) {
    const remainingMs = requiredCooldownMs - timeSinceLastCapture;
    return {
      allowed: false,
      remainingMinutes: Math.ceil(remainingMs / 60000),
      reason: `Cooldown active: moved ${Math.round(distanceKm)}km, wait ${Math.ceil(remainingMs / 60000)} more minutes`,
    };
  }

  return { allowed: true };
}

// ══════════════════════════════════════════════════════════════
// GEOHASH UTILITIES (for privacy)
// ══════════════════════════════════════════════════════════════

/**
 * Encode location to coarse geohash for privacy
 */
export function encodeCoarseGeohash(location: GeoLocation): string {
  return ngeohash.encode(location.lat, location.lng, ANTI_CHEAT_CONFIG.GEOHASH_PRECISION);
}

/**
 * Decode geohash to approximate location
 */
export function decodeGeohash(hash: string): GeoLocation {
  const { latitude, longitude } = ngeohash.decode(hash);
  return { lat: latitude, lng: longitude };
}

// ══════════════════════════════════════════════════════════════
// CAPTURE VALIDATION (for host)
// ══════════════════════════════════════════════════════════════

export interface CaptureValidationRequest {
  playerPubkey: string;
  trustScore: number;
  playerLocation: GeoLocation;
  monsterLocation: GeoLocation;
  captureRange: number;
  timestamp: number;
  geohash: string;
}

export interface CaptureValidationResult {
  approved: boolean;
  checks: {
    name: string;
    passed: boolean;
    reason?: string;
  }[];
}

/**
 * Validate a capture request (host-side)
 */
export function validateCaptureRequest(
  request: CaptureValidationRequest,
  minTrustScore: number = ANTI_CHEAT_CONFIG.MIN_TRUST_SCORE
): CaptureValidationResult {
  const checks: CaptureValidationResult['checks'] = [];

  // Check 1: Trust score threshold
  const trustPassed = request.trustScore >= minTrustScore;
  checks.push({
    name: 'TRUST_SCORE',
    passed: trustPassed,
    reason: trustPassed
      ? undefined
      : `Score ${request.trustScore} below threshold ${minTrustScore}`,
  });

  // Check 2: Distance to monster
  const distance = calculateDistance(request.playerLocation, request.monsterLocation);
  const distancePassed = distance <= request.captureRange;
  checks.push({
    name: 'DISTANCE',
    passed: distancePassed,
    reason: distancePassed
      ? undefined
      : `Player ${Math.round(distance)}m from monster (max: ${request.captureRange}m)`,
  });

  // Check 3: Timestamp freshness (not older than 2 minutes)
  const age = Date.now() - request.timestamp;
  const timestampPassed = age <= 120000;
  checks.push({
    name: 'TIMESTAMP',
    passed: timestampPassed,
    reason: timestampPassed
      ? undefined
      : `Request too old: ${Math.round(age / 1000)}s`,
  });

  // Check 4: Geohash matches claimed location
  const expectedGeohash = encodeCoarseGeohash(request.playerLocation);
  const geohashPassed = request.geohash === expectedGeohash;
  checks.push({
    name: 'GEOHASH',
    passed: geohashPassed,
    reason: geohashPassed
      ? undefined
      : 'Geohash mismatch',
  });

  const approved = checks.every(c => c.passed);

  return { approved, checks };
}

// ══════════════════════════════════════════════════════════════
// MAIN INTEGRATION FUNCTION
// ══════════════════════════════════════════════════════════════

export interface LocationIntegrityResult {
  trustScore: TrustScoreResult;
  cooldown: CooldownResult;
  geohash: string;
  reading: LocationReading;
  canCapture: boolean;
  reason?: string;
}

/**
 * Main function to check location integrity before a capture attempt
 */
export function checkLocationIntegrity(
  position: GeolocationPosition
): LocationIntegrityResult {
  // Create reading from position
  const reading: LocationReading = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude,
    speed: position.coords.speed,
    heading: position.coords.heading,
    timestamp: position.timestamp,
  };

  const location: GeoLocation = { lat: reading.lat, lng: reading.lng };

  // Check environment
  const environment = checkEnvironment();

  // Calculate trust score
  const trustScore = calculateTrustScore(reading, environment);

  // Check cooldown
  const cooldown = checkCooldown(location);

  // Generate coarse geohash
  const geohash = encodeCoarseGeohash(location);

  // Add to history for future velocity checks
  addLocationToHistory(reading);

  // Determine if capture is allowed
  let canCapture = true;
  let reason: string | undefined;

  if (!trustScore.approved) {
    canCapture = false;
    reason = `Trust score too low: ${trustScore.composite}/100`;
  } else if (!cooldown.allowed) {
    canCapture = false;
    reason = cooldown.reason;
  }

  return {
    trustScore,
    cooldown,
    geohash,
    reading,
    canCapture,
    reason,
  };
}

// ══════════════════════════════════════════════════════════════
// CAPTURE PROOF (HMAC-based token)
// ══════════════════════════════════════════════════════════════

/**
 * Generate a random capture secret for a hunt session.
 * Host generates this and includes it in encrypted hunt data.
 */
export function generateCaptureSecret(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Compute an HMAC capture proof.
 * Player includes this in capture events to prove they received hunt data
 * through the authenticated channel (P2P or zero-trust relay).
 */
export function computeCaptureProof(
  captureSecret: string,
  monsterId: string,
  playerPubkey: string,
  capturedAt: number
): string {
  const message = `${monsterId}:${playerPubkey}:${capturedAt}`;
  const key = hexToBytes(captureSecret);
  return bytesToHex(hmac(sha256, key, new TextEncoder().encode(message)));
}

/**
 * Verify an HMAC capture proof (host-side).
 * Returns true if the proof is valid — meaning the player had the capture secret.
 */
export function verifyCaptureProof(
  captureSecret: string,
  monsterId: string,
  playerPubkey: string,
  capturedAt: number,
  proof: string
): boolean {
  const expected = computeCaptureProof(captureSecret, monsterId, playerPubkey, capturedAt);
  return expected === proof;
}
