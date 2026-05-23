/**
 * Motion Tracking Module for Sat Hunter
 * Phase 2C: Accelerometer-based anti-spoofing
 *
 * Tracks device motion to detect location spoofing.
 * If a player's GPS shows movement but no accelerometer activity,
 * it's a strong indicator of GPS spoofing.
 */

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

export interface MotionSample {
  timestamp: number;
  acceleration: {
    x: number | null;
    y: number | null;
    z: number | null;
  };
  rotationRate: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  };
}

export interface MotionStats {
  totalSamples: number;
  activeSamples: number; // Samples with significant motion
  averageAcceleration: number;
  maxAcceleration: number;
  hasSignificantMotion: boolean;
  permissionGranted: boolean;
  sensorAvailable: boolean;
}

// ══════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════

const MOTION_CONFIG = {
  // Minimum acceleration to count as "motion" (m/s²)
  // Normal walking produces ~2-4 m/s², standing still ~0.5-1 m/s² (noise)
  MIN_SIGNIFICANT_ACCELERATION: 1.5,

  // Sample rate (ms between samples we keep)
  SAMPLE_INTERVAL_MS: 200,

  // How many samples to keep (last N seconds at sample rate)
  MAX_SAMPLES: 150, // ~30 seconds of data

  // Minimum percentage of active samples to consider "moving"
  MIN_ACTIVE_RATIO: 0.15, // 15% of samples should show motion

  // Distance threshold that requires motion verification (meters)
  DISTANCE_REQUIRING_MOTION: 50,
};

// ══════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════

let motionSamples: MotionSample[] = [];
let isTracking = false;
let permissionGranted = false;
const sensorAvailable = typeof DeviceMotionEvent !== 'undefined';
let lastSampleTime = 0;

// ══════════════════════════════════════════════════════════════
// iOS PERMISSION HANDLING
// ══════════════════════════════════════════════════════════════

/**
 * Check if motion permission is required (iOS 13+)
 */
export function isMotionPermissionRequired(): boolean {
  // iOS 13+ requires permission request from user gesture
  return (
    typeof DeviceMotionEvent !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (DeviceMotionEvent as any).requestPermission === 'function'
  );
}

/**
 * Request motion sensor permission (must be called from user gesture on iOS)
 * Returns true if granted, false if denied or unavailable
 */
export async function requestMotionPermission(): Promise<boolean> {
  if (!sensorAvailable) {
    console.log('[Motion] DeviceMotionEvent not available');
    return false;
  }

  // iOS 13+ requires explicit permission
  if (isMotionPermissionRequired()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const permission = await (DeviceMotionEvent as any).requestPermission();
      permissionGranted = permission === 'granted';
      console.log('[Motion] iOS permission:', permission);
      return permissionGranted;
    } catch (error) {
      console.error('[Motion] Permission request failed:', error);
      return false;
    }
  }

  // Non-iOS or older iOS - permission not required
  permissionGranted = true;
  return true;
}

/**
 * Check if motion permission has been granted
 */
export function hasMotionPermission(): boolean {
  return permissionGranted;
}

/**
 * Check if motion sensors are available on this device
 * Returns true for mobile devices, false for desktop
 */
export function hasMotionSensors(): boolean {
  return sensorAvailable;
}

// ══════════════════════════════════════════════════════════════
// MOTION EVENT HANDLER
// ══════════════════════════════════════════════════════════════

function handleMotionEvent(event: DeviceMotionEvent): void {
  const now = Date.now();

  // Auto-detect permission: if we're receiving events, permission is granted.
  // Fixes GrapheneOS/Vanadium where requestMotionPermission() may never be called
  // but the sensor works fine.
  if (!permissionGranted) {
    permissionGranted = true;
    console.log('[Motion] Auto-detected permission from incoming events');
  }

  // Throttle samples to reduce memory usage
  if (now - lastSampleTime < MOTION_CONFIG.SAMPLE_INTERVAL_MS) {
    return;
  }
  lastSampleTime = now;

  const sample: MotionSample = {
    timestamp: now,
    acceleration: {
      x: event.acceleration?.x ?? null,
      y: event.acceleration?.y ?? null,
      z: event.acceleration?.z ?? null,
    },
    rotationRate: {
      alpha: event.rotationRate?.alpha ?? null,
      beta: event.rotationRate?.beta ?? null,
      gamma: event.rotationRate?.gamma ?? null,
    },
  };

  motionSamples.push(sample);

  // Keep only recent samples
  if (motionSamples.length > MOTION_CONFIG.MAX_SAMPLES) {
    motionSamples.shift();
  }
}

// ══════════════════════════════════════════════════════════════
// TRACKING CONTROL
// ══════════════════════════════════════════════════════════════

/**
 * Start tracking device motion
 */
export function startMotionTracking(): boolean {
  if (isTracking) {
    return true;
  }

  if (!sensorAvailable) {
    console.log('[Motion] Sensors not available');
    return false;
  }

  if (!permissionGranted && isMotionPermissionRequired()) {
    console.log('[Motion] Permission not granted');
    return false;
  }

  try {
    window.addEventListener('devicemotion', handleMotionEvent);
    isTracking = true;
    console.log('[Motion] Tracking started');
    return true;
  } catch (error) {
    console.error('[Motion] Failed to start tracking:', error);
    return false;
  }
}

/**
 * Stop tracking device motion
 */
export function stopMotionTracking(): void {
  if (!isTracking) {
    return;
  }

  window.removeEventListener('devicemotion', handleMotionEvent);
  isTracking = false;
  console.log('[Motion] Tracking stopped');
}

/**
 * Clear motion history
 */
export function clearMotionHistory(): void {
  motionSamples = [];
  lastSampleTime = 0;
}

/**
 * Check if motion tracking is active
 */
export function isMotionTrackingActive(): boolean {
  return isTracking;
}

// ══════════════════════════════════════════════════════════════
// MOTION ANALYSIS
// ══════════════════════════════════════════════════════════════

/**
 * Calculate the magnitude of acceleration from x, y, z components
 */
function calculateAccelerationMagnitude(
  x: number | null,
  y: number | null,
  z: number | null
): number {
  const ax = x ?? 0;
  const ay = y ?? 0;
  const az = z ?? 0;
  return Math.sqrt(ax * ax + ay * ay + az * az);
}

/**
 * Get motion statistics for the recent tracking period
 */
export function getMotionStats(): MotionStats {
  if (!sensorAvailable) {
    return {
      totalSamples: 0,
      activeSamples: 0,
      averageAcceleration: 0,
      maxAcceleration: 0,
      hasSignificantMotion: false,
      permissionGranted: false,
      sensorAvailable: false,
    };
  }

  if (motionSamples.length === 0) {
    return {
      totalSamples: 0,
      activeSamples: 0,
      averageAcceleration: 0,
      maxAcceleration: 0,
      hasSignificantMotion: false,
      permissionGranted,
      sensorAvailable: true,
    };
  }

  let totalAcceleration = 0;
  let maxAcceleration = 0;
  let activeSamples = 0;

  for (const sample of motionSamples) {
    const magnitude = calculateAccelerationMagnitude(
      sample.acceleration.x,
      sample.acceleration.y,
      sample.acceleration.z
    );

    totalAcceleration += magnitude;
    maxAcceleration = Math.max(maxAcceleration, magnitude);

    if (magnitude >= MOTION_CONFIG.MIN_SIGNIFICANT_ACCELERATION) {
      activeSamples++;
    }
  }

  const averageAcceleration = totalAcceleration / motionSamples.length;
  const activeRatio = activeSamples / motionSamples.length;
  const hasSignificantMotion = activeRatio >= MOTION_CONFIG.MIN_ACTIVE_RATIO;

  return {
    totalSamples: motionSamples.length,
    activeSamples,
    averageAcceleration,
    maxAcceleration,
    hasSignificantMotion,
    permissionGranted,
    sensorAvailable: true,
  };
}

/**
 * Check if motion data is consistent with claimed movement distance
 * Returns a score from 0-100:
 * - 100: Motion detected, consistent with movement
 * - 80: No sensors / permission denied (not penalized)
 * - 50: Some motion but less than expected
 * - 0: No motion detected but significant GPS movement claimed
 */
export function getMotionScore(distanceMoved: number): number {
  // If sensors aren't available or permission denied, don't penalize
  // Desktop users and users who denied permission shouldn't be blocked
  if (!sensorAvailable || !permissionGranted) {
    return 80; // Neutral score - can't verify but don't block
  }

  const stats = getMotionStats();

  // Not enough samples to judge
  if (stats.totalSamples < 10) {
    return 80; // Neutral - just started tracking
  }

  // Small movements don't require motion verification
  if (distanceMoved < MOTION_CONFIG.DISTANCE_REQUIRING_MOTION) {
    return 100; // No motion check needed for small distances
  }

  // Check if motion matches claimed movement
  if (stats.hasSignificantMotion) {
    return 100; // Motion detected - all good
  }

  // Significant GPS movement but no motion detected
  // This is suspicious - likely GPS spoofing
  const activeRatio = stats.activeSamples / stats.totalSamples;

  if (activeRatio < 0.05) {
    // Less than 5% motion for significant GPS movement = very suspicious
    return 0;
  } else if (activeRatio < MOTION_CONFIG.MIN_ACTIVE_RATIO) {
    // Some motion but not enough
    return 50;
  }

  return 100;
}

// ══════════════════════════════════════════════════════════════
// EXPORTS FOR DEBUGGING
// ══════════════════════════════════════════════════════════════

export function getMotionSampleCount(): number {
  return motionSamples.length;
}

export function getMotionConfig() {
  return { ...MOTION_CONFIG };
}
