/**
 * Shared test factories for multi-player stress testing
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  createSessionFromPSK,
  type ZeroTrustSession,
} from '../lib/zeroTrustRelay';
import type { HuntEvent, Monster } from '../lib/gameTypes';

export interface TestHost {
  privkey: Uint8Array;
  pubkey: string;
  session: ZeroTrustSession;
}

export interface TestPlayer {
  privkey: Uint8Array;
  pubkey: string;
  session: ZeroTrustSession;
}

/**
 * Create a host with a zero-trust session derived from PSK (share code)
 */
export function genHost(shareCode: string, sessionId?: string): TestHost {
  const privkey = generateSecretKey();
  const pubkey = getPublicKey(privkey);
  const session = createSessionFromPSK(
    sessionId ?? `hunt-${shareCode}`,
    privkey,
    shareCode,
  );
  return { privkey, pubkey, session };
}

/**
 * Create N players, each with their own zero-trust session derived from the same PSK
 */
export function genPlayers(n: number, shareCode: string, sessionId?: string): TestPlayer[] {
  const players: TestPlayer[] = [];
  for (let i = 0; i < n; i++) {
    const privkey = generateSecretKey();
    const pubkey = getPublicKey(privkey);
    const session = createSessionFromPSK(
      sessionId ?? `hunt-${shareCode}`,
      privkey,
      shareCode,
    );
    players.push({ privkey, pubkey, session });
  }
  return players;
}

/**
 * Create a minimal HuntEvent for testing
 */
export function genHunt(overrides?: Partial<HuntEvent>): HuntEvent {
  return {
    id: 'test-hunt-1',
    name: 'Test Hunt',
    description: 'A test hunt',
    hostPubkey: 'deadbeef'.repeat(8),
    totalSats: 1000,
    monsterCount: 10,
    geoFence: {
      center: { lat: 37.7749, lng: -122.4194 },
      bounds: { north: 37.78, south: 37.77, east: -122.41, west: -122.43 },
      radiusMeters: 500,
      boundaryType: 'circle',
    },
    startTime: Date.now(),
    endTime: Date.now() + 3600000,
    createdAt: Date.now(),
    monsters: [],
    satStops: [],
    status: 'active',
    paymentStatus: 'paid',
    shareCode: 'ABC123',
    participants: [],
    spawnMode: 'all_at_once',
    ...overrides,
  };
}

/**
 * Create a minimal Monster for testing
 */
export function genMonster(overrides?: Partial<Monster>): Monster {
  return {
    id: `monster-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Ratasat',
    type: 'ratasat',
    description: 'A humble creature of the mempool',
    satAmount: 10,
    rarity: 'common',
    location: { lat: 37.7749, lng: -122.4194 },
    emoji: '🐀',
    spawnTime: Date.now(),
    captured: false,
    ...overrides,
  };
}
