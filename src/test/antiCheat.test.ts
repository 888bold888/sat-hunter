// @vitest-environment node
/**
 * Layer 4: Anti-Cheat Pure Function Tests
 * HMAC proofs, velocity checks, trust scoring, capture validation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeCaptureProof,
  verifyCaptureProof,
  generateCaptureSecret,
  checkVelocity,
  calculateTrustScore,
  validateCaptureRequest,
  clearLocationHistory,
  encodeCoarseGeohash,
  type LocationReading,
  type EnvironmentCheck,
} from '../lib/antiCheat';

// Clean environment for trust score tests (no mock location, no emulator)
const CLEAN_ENV: EnvironmentCheck = {
  isMockLocationEnabled: false,
  isEmulator: false,
  hasRequiredSensors: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
};

function makeReading(overrides?: Partial<LocationReading>): LocationReading {
  return {
    lat: 37.7749,
    lng: -122.4194,
    accuracy: 10,
    altitude: null,
    speed: null,
    heading: null,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Anti-Cheat', () => {
  beforeEach(() => {
    clearLocationHistory();
  });

  describe('HMAC proofs', () => {
    it('valid proof verifies', () => {
      const secret = generateCaptureSecret();
      const proof = computeCaptureProof(secret, 'mon-1', 'pk1'.padEnd(64, '0'), 1000);
      expect(verifyCaptureProof(secret, 'mon-1', 'pk1'.padEnd(64, '0'), 1000, proof)).toBe(true);
    });

    it('wrong monsterId fails', () => {
      const secret = generateCaptureSecret();
      const proof = computeCaptureProof(secret, 'mon-1', 'pk1'.padEnd(64, '0'), 1000);
      expect(verifyCaptureProof(secret, 'mon-2', 'pk1'.padEnd(64, '0'), 1000, proof)).toBe(false);
    });

    it('wrong pubkey fails', () => {
      const secret = generateCaptureSecret();
      const proof = computeCaptureProof(secret, 'mon-1', 'pk1'.padEnd(64, '0'), 1000);
      expect(verifyCaptureProof(secret, 'mon-1', 'pk2'.padEnd(64, '0'), 1000, proof)).toBe(false);
    });

    it('wrong timestamp fails', () => {
      const secret = generateCaptureSecret();
      const proof = computeCaptureProof(secret, 'mon-1', 'pk1'.padEnd(64, '0'), 1000);
      expect(verifyCaptureProof(secret, 'mon-1', 'pk1'.padEnd(64, '0'), 2000, proof)).toBe(false);
    });

    it('different secrets produce different proofs', () => {
      const secret1 = generateCaptureSecret();
      const secret2 = generateCaptureSecret();
      const proof1 = computeCaptureProof(secret1, 'mon-1', 'pk1'.padEnd(64, '0'), 1000);
      const proof2 = computeCaptureProof(secret2, 'mon-1', 'pk1'.padEnd(64, '0'), 1000);
      expect(proof1).not.toBe(proof2);
    });
  });

  describe('velocity checks', () => {
    it('stationary player passes', () => {
      const history = [makeReading({ timestamp: Date.now() - 5000 })];
      const current = makeReading({ timestamp: Date.now() });

      const result = checkVelocity(current, history);
      expect(result.valid).toBe(true);
      expect(result.velocityMs).toBeLessThan(1);
    });

    it('walking speed (5 km/h) passes', () => {
      const now = Date.now();
      // Walking: ~1.4 m/s, move ~14m in 10 seconds
      const history = [makeReading({
        lat: 37.7749,
        lng: -122.4194,
        timestamp: now - 10000,
      })];
      const current = makeReading({
        lat: 37.77502, // ~13m north
        lng: -122.4194,
        timestamp: now,
      });

      const result = checkVelocity(current, history);
      expect(result.valid).toBe(true);
      expect(result.flags).toHaveLength(0);
    });

    it('teleportation (500+ km/h) flags TELEPORTATION', () => {
      const now = Date.now();
      // Teleportation: jump ~1km in 1 second = 3600 km/h
      const history = [makeReading({
        lat: 37.7749,
        lng: -122.4194,
        timestamp: now - 1000,
      })];
      const current = makeReading({
        lat: 37.784, // ~1km north
        lng: -122.4194,
        timestamp: now,
      });

      const result = checkVelocity(current, history);
      expect(result.valid).toBe(false);
      expect(result.flags.some(f => f.startsWith('TELEPORTATION'))).toBe(true);
    });

    it('empty history returns valid with 0 velocity', () => {
      const result = checkVelocity(makeReading(), []);
      expect(result.valid).toBe(true);
      expect(result.velocityMs).toBe(0);
    });
  });

  describe('trust score', () => {
    it('valid reading with clean environment scores >= 70', () => {
      const reading = makeReading({ accuracy: 10 });
      const result = calculateTrustScore(reading, CLEAN_ENV);
      expect(result.composite).toBeGreaterThanOrEqual(70);
      expect(result.approved).toBe(true);
    });

    it('emulator detected drops environment score', () => {
      const reading = makeReading({ accuracy: 10 });
      const emulatorEnv: EnvironmentCheck = {
        ...CLEAN_ENV,
        isEmulator: true,
      };

      const result = calculateTrustScore(reading, emulatorEnv);
      expect(result.breakdown.environment).toBeLessThanOrEqual(20);
      expect(result.flags).toContain('EMULATOR_DETECTED');
    });

    it('mock location drops environment score to 0', () => {
      const reading = makeReading({ accuracy: 10 });
      const mockEnv: EnvironmentCheck = {
        ...CLEAN_ENV,
        isMockLocationEnabled: true,
      };

      const result = calculateTrustScore(reading, mockEnv);
      expect(result.breakdown.environment).toBe(0);
      expect(result.flags).toContain('MOCK_LOCATION_ENABLED');
    });

    it('suspiciously perfect accuracy is flagged', () => {
      const reading = makeReading({ accuracy: 1 }); // 1m = too perfect
      const result = calculateTrustScore(reading, CLEAN_ENV);
      expect(result.flags.some(f => f.startsWith('PERFECT_ACCURACY'))).toBe(true);
      expect(result.breakdown.location).toBeLessThan(100);
    });
  });

  describe('capture validation', () => {
    it('low trust score fails', () => {
      const location = { lat: 37.7749, lng: -122.4194 };
      const result = validateCaptureRequest({
        playerPubkey: 'test',
        trustScore: 50,
        playerLocation: location,
        monsterLocation: location,
        captureRange: 15,
        timestamp: Date.now(),
        geohash: encodeCoarseGeohash(location),
      });

      expect(result.approved).toBe(false);
      expect(result.checks.find(c => c.name === 'TRUST_SCORE')?.passed).toBe(false);
    });

    it('player too far fails', () => {
      const playerLoc = { lat: 37.7749, lng: -122.4194 };
      const monsterLoc = { lat: 37.776, lng: -122.4194 }; // ~120m away

      const result = validateCaptureRequest({
        playerPubkey: 'test',
        trustScore: 90,
        playerLocation: playerLoc,
        monsterLocation: monsterLoc,
        captureRange: 15,
        timestamp: Date.now(),
        geohash: encodeCoarseGeohash(playerLoc),
      });

      expect(result.approved).toBe(false);
      expect(result.checks.find(c => c.name === 'DISTANCE')?.passed).toBe(false);
    });

    it('stale timestamp fails', () => {
      const location = { lat: 37.7749, lng: -122.4194 };
      const result = validateCaptureRequest({
        playerPubkey: 'test',
        trustScore: 90,
        playerLocation: location,
        monsterLocation: location,
        captureRange: 15,
        timestamp: Date.now() - 3 * 60 * 1000, // 3 minutes old
        geohash: encodeCoarseGeohash(location),
      });

      expect(result.approved).toBe(false);
      expect(result.checks.find(c => c.name === 'TIMESTAMP')?.passed).toBe(false);
    });

    it('geohash mismatch fails', () => {
      const location = { lat: 37.7749, lng: -122.4194 };
      const result = validateCaptureRequest({
        playerPubkey: 'test',
        trustScore: 90,
        playerLocation: location,
        monsterLocation: location,
        captureRange: 15,
        timestamp: Date.now(),
        geohash: 'wrong',
      });

      expect(result.approved).toBe(false);
      expect(result.checks.find(c => c.name === 'GEOHASH')?.passed).toBe(false);
    });

    it('all checks pass for valid capture', () => {
      const location = { lat: 37.7749, lng: -122.4194 };
      const geohash = encodeCoarseGeohash(location);

      const result = validateCaptureRequest({
        playerPubkey: 'test',
        trustScore: 90,
        playerLocation: location,
        monsterLocation: location,
        captureRange: 15,
        timestamp: Date.now(),
        geohash,
      });

      expect(result.approved).toBe(true);
      expect(result.checks.every(c => c.passed)).toBe(true);
    });
  });
});
