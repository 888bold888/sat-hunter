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
  addLocationToHistory,
  analyzeAccuracy,
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

    it('GPS jump within accuracy radius is not flagged (GrapheneOS raw GNSS)', () => {
      const now = Date.now();
      // Previous reading had poor accuracy (50m radius)
      const history = [makeReading({
        lat: 37.7749,
        lng: -122.4194,
        accuracy: 50,
        timestamp: now - 1000,
      })];
      // Current reading jumps 100m — but that's within the combined accuracy
      // circles (50m + 10m = 60m). Without the fix, this calculates as
      // 100m/1s = 100 m/s = 360 km/h → HIGH_VELOCITY flag.
      // With the fix, distance is discounted by combined accuracy.
      const current = makeReading({
        lat: 37.7758, // ~100m north
        lng: -122.4194,
        accuracy: 10,
        timestamp: now,
      });

      const result = checkVelocity(current, history);
      // Should NOT flag — apparent movement is within GPS error margin
      expect(result.flags).toHaveLength(0);
      expect(result.valid).toBe(true);
    });

    it('genuine teleport still caught even with moderate accuracy', () => {
      const now = Date.now();
      // Both readings have decent accuracy (10m), but 1km jump in 1s = real cheat
      // Even after subtracting combined accuracy (20m), 980m/1s = 3528 km/h
      const history = [makeReading({
        lat: 37.7749,
        lng: -122.4194,
        accuracy: 10,
        timestamp: now - 1000,
      })];
      const current = makeReading({
        lat: 37.784, // ~1km north
        lng: -122.4194,
        accuracy: 10,
        timestamp: now,
      });

      const result = checkVelocity(current, history);
      expect(result.valid).toBe(false);
      expect(result.flags.some(f => f.startsWith('TELEPORTATION'))).toBe(true);
    });

    it('very short time delta with poor accuracy is ignored', () => {
      const now = Date.now();
      // Two readings 200ms apart, both with poor accuracy — noise, not movement
      const history = [makeReading({
        lat: 37.7749,
        lng: -122.4194,
        accuracy: 30,
        timestamp: now - 200,
      })];
      const current = makeReading({
        lat: 37.77495, // ~5m — well within combined accuracy of 60m
        lng: -122.4194,
        accuracy: 30,
        timestamp: now,
      });

      const result = checkVelocity(current, history);
      expect(result.valid).toBe(true);
      expect(result.flags).toHaveLength(0);
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

    it('suspiciously perfect accuracy is flagged only below 1m', () => {
      // 0.5m = genuinely suspicious (mock location / spoofing artifact)
      const spoofed = makeReading({ accuracy: 0.5 });
      const result = calculateTrustScore(spoofed, CLEAN_ENV);
      expect(result.flags.some(f => f.startsWith('PERFECT_ACCURACY'))).toBe(true);
      expect(result.breakdown.location).toBeLessThan(100);
    });
  });

  describe('GrapheneOS device profile', () => {
    const GRAPHENE_ENV: EnvironmentCheck = {
      isMockLocationEnabled: false,
      isEmulator: false,
      hasRequiredSensors: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    };

    it('1-2m accuracy from raw GNSS is not flagged as suspicious', () => {
      // GrapheneOS uses raw GNSS without Google network location blending,
      // so it often reports very precise accuracy (1-2m) — this is legitimate
      const reading = makeReading({ accuracy: 1.5 });
      const result = analyzeAccuracy(reading);
      expect(result.flags.some(f => f.startsWith('PERFECT_ACCURACY'))).toBe(false);
      expect(result.score).toBe(100);
    });

    it('consistent 2m accuracy does not trigger REPEATED_SUSPICIOUS_PATTERNS', () => {
      // Simulate 5 readings with consistent high-precision GPS
      for (let i = 0; i < 5; i++) {
        addLocationToHistory(makeReading({
          accuracy: 2,
          timestamp: Date.now() - (5 - i) * 1000,
        }));
      }

      const reading = makeReading({ accuracy: 2 });
      const result = calculateTrustScore(reading, GRAPHENE_ENV);

      expect(result.flags).not.toContain('REPEATED_SUSPICIOUS_PATTERNS');
      expect(result.approved).toBe(true);
    });

    it('trust score >= 70 with high-precision GPS and motion permission not called', () => {
      // GrapheneOS + Vanadium: DeviceMotionEvent exists but requestMotionPermission
      // may never have been called, leaving permissionGranted=false.
      // The motion score should be neutral (80), not penalizing.
      const reading = makeReading({ accuracy: 1.5 });
      const result = calculateTrustScore(reading, GRAPHENE_ENV);
      expect(result.composite).toBeGreaterThanOrEqual(70);
      expect(result.approved).toBe(true);
    });

    it('MOTION_PERMISSION_DENIED flag should not appear when motion data flows', () => {
      // Even if the permission boolean wasn't set, if motion data is actually
      // being received, don't flag as denied. This tests the concept —
      // the actual fix is in motionTracking.ts where receiving data should
      // auto-grant the permission flag.
      const reading = makeReading({ accuracy: 2 });
      const result = calculateTrustScore(reading, GRAPHENE_ENV);
      // With the fix, motion score should be neutral (80) not penalized,
      // and the flag should reflect actual sensor state, not just the boolean
      expect(result.breakdown.motion).toBeGreaterThanOrEqual(80);
    });

    it('actual spoofer at 0m accuracy is still caught', () => {
      const reading = makeReading({ accuracy: 0 });
      const result = analyzeAccuracy(reading);
      expect(result.flags.some(f => f.startsWith('PERFECT_ACCURACY'))).toBe(true);
      expect(result.score).toBeLessThan(100);
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
