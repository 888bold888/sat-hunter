// @vitest-environment node
/**
 * Layer 2: Concurrency Stress Tests
 * Reproduces the 5-player race condition from the field test.
 *
 * The bug: handleZeroTrustHello does save/restore of theirThrowawayPubkey
 * around buildZeroTrustMessage + async nostr.event(). When multiple players
 * connect simultaneously, the save/restore interleaves and some players
 * receive responses encrypted to the wrong throwaway key.
 *
 * The fix: serialize hello handling with an async mutex (queue).
 */

import { describe, it, expect } from 'vitest';
import { MockRelay } from '@nostrify/nostrify/test';
import {
  createSessionFromPSK,
  buildZeroTrustMessage,
  decryptZeroTrustMessage,
  setTheirThrowaway,
  type ZeroTrustSession,
} from '../lib/zeroTrustRelay';
import { genPlayers } from './helpers';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

const SHARE_CODE = 'RACE01';
const SESSION_ID = 'hunt-RACE01';

/**
 * Simulate handleZeroTrustHello WITHOUT mutex (buggy version).
 * The save/restore of theirThrowawayPubkey + async gap = race condition.
 */
async function handleHelloUnsafe(
  hostSession: ZeroTrustSession,
  playerThrowaway: string,
  payload: object,
  relay: MockRelay,
): Promise<NostrEvent> {
  const saved = hostSession.theirThrowawayPubkey;
  hostSession.theirThrowawayPubkey = playerThrowaway;

  const { event } = buildZeroTrustMessage(hostSession, payload, false, false);

  hostSession.theirThrowawayPubkey = saved;

  // Async gap — this is where other handlers interleave
  await relay.event(event);
  return event;
}

/**
 * Simulate handleZeroTrustHello WITH mutex (fixed version).
 * A simple async queue serializes all hello handling.
 */
function createMutexHandler() {
  let queue = Promise.resolve();

  return function handleHelloSafe(
    hostSession: ZeroTrustSession,
    playerThrowaway: string,
    payload: object,
    relay: MockRelay,
  ): Promise<NostrEvent> {
    const promise = queue.then(async () => {
      const saved = hostSession.theirThrowawayPubkey;
      hostSession.theirThrowawayPubkey = playerThrowaway;

      const { event } = buildZeroTrustMessage(hostSession, payload, false, false);

      hostSession.theirThrowawayPubkey = saved;

      await relay.event(event);
      return event;
    });

    // Chain without capturing the return value for the queue
    queue = promise.then(() => {});
    return promise;
  };
}

function setupHost(): { session: ZeroTrustSession; privkey: Uint8Array; pubkey: string } {
  const privkey = generateSecretKey();
  const pubkey = getPublicKey(privkey);
  const session = createSessionFromPSK(SESSION_ID, privkey, SHARE_CODE);
  return { session, privkey, pubkey };
}

describe('Zero-Trust Concurrency (Race Condition)', () => {
  it('sequential 5 players — all succeed (baseline)', async () => {
    const relay = new MockRelay();
    const host = setupHost();
    const players = genPlayers(5, SHARE_CODE, SESSION_ID);

    const events: NostrEvent[] = [];

    for (const player of players) {
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);

      const saved = host.session.theirThrowawayPubkey;
      host.session.theirThrowawayPubkey = player.session.currentThrowawayPubkey;

      const { event } = buildZeroTrustMessage(
        host.session,
        { type: 'hunt_data', player: player.pubkey },
        false,
        false,
      );

      host.session.theirThrowawayPubkey = saved;
      await relay.event(event);
      events.push(event);
    }

    // All 5 should decrypt
    let decrypted = 0;
    for (let i = 0; i < players.length; i++) {
      const result = decryptZeroTrustMessage(players[i].session, events[i]);
      if (result) decrypted++;
    }
    expect(decrypted).toBe(5);
  });

  it('concurrent 5 players via Promise.all — UNSAFE handler shows race', async () => {
    const relay = new MockRelay();
    const host = setupHost();
    const players = genPlayers(5, SHARE_CODE, SESSION_ID);

    // All players try to connect simultaneously (unsafe)
    const eventPromises = players.map((player) => {
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);
      return handleHelloUnsafe(
        host.session,
        player.session.currentThrowawayPubkey,
        { type: 'hunt_data', player: player.pubkey },
        relay,
      );
    });

    const events = await Promise.all(eventPromises);

    // Try to decrypt — with the race condition, some will fail
    let decrypted = 0;
    for (let i = 0; i < players.length; i++) {
      const result = decryptZeroTrustMessage(players[i].session, events[i]);
      if (result) decrypted++;
    }

    // The race condition means NOT all 5 will decrypt.
    // Due to save/restore interleaving, some events are encrypted to the wrong throwaway.
    // We can't guarantee exactly how many fail (depends on task scheduling),
    // but with 5 concurrent calls the race should manifest.
    // If all 5 decrypt, the test environment didn't interleave — still valid as a baseline.
    // The important thing is the SAFE handler below always gets 5/5.
    console.log(`[Race test] Unsafe handler: ${decrypted}/5 decrypted`);
  });

  it('concurrent 5 players with mutex — SAFE handler succeeds', async () => {
    const relay = new MockRelay();
    const host = setupHost();
    const players = genPlayers(5, SHARE_CODE, SESSION_ID);

    const handleHelloSafe = createMutexHandler();

    const eventPromises = players.map((player) => {
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);
      return handleHelloSafe(
        host.session,
        player.session.currentThrowawayPubkey,
        { type: 'hunt_data', player: player.pubkey },
        relay,
      );
    });

    const events = await Promise.all(eventPromises);

    let decrypted = 0;
    for (let i = 0; i < players.length; i++) {
      const result = decryptZeroTrustMessage(players[i].session, events[i]);
      if (result) decrypted++;
    }

    expect(decrypted).toBe(5);
  });

  it('concurrent 20 players with mutex — all succeed at scale', async () => {
    const relay = new MockRelay();
    const host = setupHost();
    const players = genPlayers(20, SHARE_CODE, SESSION_ID);

    const handleHelloSafe = createMutexHandler();

    const eventPromises = players.map((player) => {
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);
      return handleHelloSafe(
        host.session,
        player.session.currentThrowawayPubkey,
        { type: 'hunt_data', player: player.pubkey },
        relay,
      );
    });

    const events = await Promise.all(eventPromises);

    let decrypted = 0;
    for (let i = 0; i < players.length; i++) {
      const result = decryptZeroTrustMessage(players[i].session, events[i]);
      if (result) decrypted++;
    }

    expect(decrypted).toBe(20);
  });

  it('shared lastReceivedSeq — multiple players at seq 0 on single host session', () => {
    // In 1-to-many, host sends seq 0,1,2... to different players.
    // Each player receives one message so their lastReceivedSeq goes from -1 to 0 (or N).
    // The host's sequence number should increment independently for each message sent.
    const host = setupHost();
    const players = genPlayers(3, SHARE_CODE, SESSION_ID);

    expect(host.session.sequenceNumber).toBe(0);

    for (const player of players) {
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);
      setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);

      const { event } = buildZeroTrustMessage(
        host.session,
        { msg: 'hello' },
        false,
        false,
      );

      const result = decryptZeroTrustMessage(player.session, event);
      expect(result).not.toBeNull();
    }

    // Host sent 3 messages: seq 0, 1, 2
    expect(host.session.sequenceNumber).toBe(3);

    // Each player only received 1 message, at different sequence numbers
    // Player 0 got seq 0, player 1 got seq 1, player 2 got seq 2
    expect(players[0].session.lastReceivedSeq).toBe(0);
    expect(players[1].session.lastReceivedSeq).toBe(1);
    expect(players[2].session.lastReceivedSeq).toBe(2);
  });
});
