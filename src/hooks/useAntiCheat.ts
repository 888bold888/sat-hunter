/**
 * Anti-Cheat Hook for Sat Hunter
 * Provides anti-cheat functionality to components
 */

import { useCallback, useRef } from 'react';
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
import type { GeoLocation } from '@/lib/gameTypes';

export interface AntiCheatState {
  lastIntegrityCheck: LocationIntegrityResult | null;
  environment: EnvironmentCheck;
}

export function useAntiCheat() {
  const lastIntegrityCheckRef = useRef<LocationIntegrityResult | null>(null);
  const environmentRef = useRef<EnvironmentCheck | null>(null);

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
    lastIntegrityCheckRef.current = null;
    console.log('[AntiCheat] State cleared');
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
  };
}
