/**
 * Development Mode Utilities
 * 
 * These utilities help with testing location-based features without GPS.
 * Only available in development environments.
 */

import type { GeoLocation } from './gameTypes';

// Check if we're in development mode
export const isDevelopmentMode = import.meta.env.DEV || window.location.hostname === 'localhost';

// Default test location (San Francisco)
export const DEFAULT_TEST_LOCATION: GeoLocation = {
  lat: 37.7749,
  lng: -122.4194,
};

// Enable/disable mock location from localStorage
const MOCK_LOCATION_KEY = 'sathunter:mock-location-enabled';

export function isMockLocationEnabled(): boolean {
  if (!isDevelopmentMode) return false;
  return localStorage.getItem(MOCK_LOCATION_KEY) === 'true';
}

export function setMockLocationEnabled(enabled: boolean): void {
  if (!isDevelopmentMode) return;
  localStorage.setItem(MOCK_LOCATION_KEY, enabled ? 'true' : 'false');
}

export function getMockLocation(): GeoLocation | null {
  if (!isMockLocationEnabled()) return null;
  
  const stored = localStorage.getItem('sathunter:mock-location');
  if (stored) {
    try {
      return JSON.parse(stored) as GeoLocation;
    } catch {
      return DEFAULT_TEST_LOCATION;
    }
  }
  
  return DEFAULT_TEST_LOCATION;
}

export function setMockLocation(location: GeoLocation): void {
  if (!isDevelopmentMode) return;
  localStorage.setItem('sathunter:mock-location', JSON.stringify(location));
}

// Browser compatibility check
export function checkGeolocationSupport(): {
  supported: boolean;
  secureContext: boolean;
  error?: string;
} {
  const supported = 'geolocation' in navigator;
  const secureContext = window.isSecureContext || window.location.hostname === 'localhost';
  
  let error: string | undefined;
  
  if (!supported) {
    error = 'Geolocation is not supported by your browser';
  } else if (!secureContext) {
    error = 'Geolocation requires HTTPS or localhost';
  }
  
  return { supported, secureContext, error };
}
