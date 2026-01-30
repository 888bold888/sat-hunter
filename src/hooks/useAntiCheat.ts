/**
 * Anti-Cheat Hook for Sat Hunter
 * Provides anti-cheat functionality to components
 */

import { useCallback, useRef, useEffect } from 'react';
import {
  checkLocationIntegrity,
  checkCooldown,
  updateCooldownState,
  clearCooldownState,
  getLocationHistory,
  clearLocationHistory,
  checkEnvironment,
  encodeCoarseGeohash,
  ANTI_CHEAT_CONFIG,
  type LocationIntegrityResult,
  type CooldownResult,
  type EnvironmentCheck,
} from '@/lib/antiCheat';
import {
  requestMotionPermission,
  startMotionTracking,
  stopMotionTracking,
  clearMotionHistory,
  getMotionStats,
  isMotionPermissionRequired,
  hasMotionPermission,
  type MotionStats,
} from '@/lib/motionTracking';
import type { GeoLocation } from '@/lib/gameTypes';

export interface AntiCheatState {
  lastIntegrityCheck: LocationIntegrityResult | null;
  environment: EnvironmentCheck;
  motionStats: MotionStats | null;
}

export function useAntiCheat() {
  const lastIntegrityCheckRef = useRef<LocationIntegrityResult | null>(null);
  const environmentRef = useRef<EnvironmentCheck | null>(null);
  const motionTrackingStartedRef = useRef(false);

  /**
   * Check location integrity before a capture attempt
   * Returns null if no GeolocationPosition is available
   */
  const checkBeforeCapture = useCallback((
    position: GeolocationPosition | null
  ): LocationIntegrityResult | null => {
    if (!position) {
      console.warn('[AntiCheat] No position available for integrity check');
      return null;
    }

    const result = checkLocationIntegrity(position);
    lastIntegrityCheckRef.current = result;

    // Log for debugging (remove in production)
    if (result.trustScore.flags.length > 0) {
      console.warn('[AntiCheat] Flags detected:', result.trustScore.flags);
    }

    console.log('[AntiCheat] Trust score:', result.trustScore.composite,
      'Can capture:', result.canCapture,
      'Geohash:', result.geohash);

    return result;
  }, []);

  /**
   * Record a successful capture for cooldown tracking
   */
  const recordCapture = useCallback((location: GeoLocation) => {
    updateCooldownState(location);
    console.log('[AntiCheat] Capture recorded for cooldown at:', location);
  }, []);

  /**
   * Check cooldown status without a GeolocationPosition
   */
  const checkCooldownStatus = useCallback((location: GeoLocation): CooldownResult => {
    return checkCooldown(location);
  }, []);

  /**
   * Clear all anti-cheat state (when leaving a hunt)
   */
  const clearState = useCallback(() => {
    clearCooldownState();
    clearLocationHistory();
    clearMotionHistory();
    stopMotionTracking();
    motionTrackingStartedRef.current = false;
    lastIntegrityCheckRef.current = null;
    console.log('[AntiCheat] State cleared');
  }, []);

  /**
   * Request motion permission and start tracking (Phase 2C)
   * Must be called from a user gesture on iOS
   */
  const initializeMotionTracking = useCallback(async (): Promise<boolean> => {
    if (motionTrackingStartedRef.current) {
      return true;
    }

    // Request permission if needed (iOS 13+)
    if (isMotionPermissionRequired()) {
      const granted = await requestMotionPermission();
      if (!granted) {
        console.log('[AntiCheat] Motion permission denied');
        return false;
      }
    }

    // Start tracking
    const started = startMotionTracking();
    motionTrackingStartedRef.current = started;
    return started;
  }, []);

  /**
   * Get current motion stats
   */
  const getMotionInfo = useCallback((): MotionStats => {
    return getMotionStats();
  }, []);

  /**
   * Check if motion permission is required (iOS 13+)
   */
  const needsMotionPermission = useCallback((): boolean => {
    return isMotionPermissionRequired() && !hasMotionPermission();
  }, []);

  /**
   * Get the environment check result (cached)
   */
  const getEnvironment = useCallback((): EnvironmentCheck => {
    if (!environmentRef.current) {
      environmentRef.current = checkEnvironment();
    }
    return environmentRef.current;
  }, []);

  /**
   * Encode location to coarse geohash for privacy
   */
  const getCoarseGeohash = useCallback((location: GeoLocation): string => {
    return encodeCoarseGeohash(location);
  }, []);

  /**
   * Get location history length (for debugging)
   */
  const getHistoryLength = useCallback((): number => {
    return getLocationHistory().length;
  }, []);

  /**
   * Get the last integrity check result
   */
  const getLastIntegrityCheck = useCallback((): LocationIntegrityResult | null => {
    return lastIntegrityCheckRef.current;
  }, []);

  /**
   * Get the minimum required trust score
   */
  const getMinTrustScore = useCallback((): number => {
    return ANTI_CHEAT_CONFIG.MIN_TRUST_SCORE;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (motionTrackingStartedRef.current) {
        stopMotionTracking();
      }
    };
  }, []);

  return {
    checkBeforeCapture,
    recordCapture,
    checkCooldownStatus,
    clearState,
    getEnvironment,
    getCoarseGeohash,
    getHistoryLength,
    getLastIntegrityCheck,
    getMinTrustScore,
    // Phase 2C: Motion tracking
    initializeMotionTracking,
    getMotionInfo,
    needsMotionPermission,
  };
}
