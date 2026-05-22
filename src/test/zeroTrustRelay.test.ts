// @vitest-environment node
/**
 * Layer 1: Zero-Trust Crypto Unit Tests
 * Pure crypto tests — no mocking needed
 */

import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@nostrify/nostrify';
import {
  buildZeroTrustMessage,
  decryptZeroTrustMessage,
  setTheirThrowaway,
  destroySession,
} from '../lib/zeroTrustRelay';
import { genHost, genPlayers } from './helpers';

const SHARE_CODE = 'TEST01';
const SESSION_ID = 'hunt-TEST01';

describe('Zero-Trust Relay Crypto', () => {
  describe('PSK derivation', () => {
    it('two sessions with same PSK derive identical sessionKey', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const [player] = genPlayers(1, SHARE_CODE, SESSION_ID);

      // Both should derive the same session key from the same PSK + sessionId
      expect(host.session.sessionKey).toEqual(player.session.sessionKey);
    });

    it('different PSKs produce different session keys', () => {
      const session1 = genHost('CODE_A', SESSION_ID);
      const session2 = genHost('CODE_B', SESSION_ID);

      expect(session1.session.sessionKey).not.toEqual(session2.session.sessionKey);
    });

    it('different session IDs produce different session keys', () => {
      const session1 = genHost(SHARE_CODE, 'hunt-1');
      const session2 = genHost(SHARE_CODE, 'hunt-2');

      expect(session1.session.sessionKey).not.toEqual(session2.session.sessionKey);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('host encrypts, player decrypts', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const [player] = genPlayers(1, SHARE_CODE, SESSION_ID);

      // Exchange throwaway pubkeys
      setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);

      const payload = { type: 'hunt_data', huntId: 'test-123', monsters: [1, 2, 3] };
      const { event } = buildZeroTrustMessage(host.session, payload);

      const result = decryptZeroTrustMessage(player.session, event);
      expect(result).not.toBeNull();
      expect(result!.payload).toEqual(payload);
    });

    it('player encrypts, host decrypts', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const [player] = genPlayers(1, SHARE_CODE, SESSION_ID);

      setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);

      const payload = { type: 'player_hello', throwaway: 'abc' };
      const { event } = buildZeroTrustMessage(player.session, payload);

      const result = decryptZeroTrustMessage(host.session, event);
      expect(result).not.toBeNull();
      expect(result!.payload).toEqual(payload);
    });
  });

  describe('sequence numbers', () => {
    it('increments after each message', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const [player] = genPlayers(1, SHARE_CODE, SESSION_ID);

      setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);

      // Send 3 messages (don't rotate throwaway so we can keep sending)
      for (let i = 0; i < 3; i++) {
        buildZeroTrustMessage(host.session, { seq: i }, false, false);
      }

      expect(host.session.sequenceNumber).toBe(3);
    });

    it('out-of-order delivery within ±2 window succeeds', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const [player] = genPlayers(1, SHARE_CODE, SESSION_ID);

      setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);

      // Build seq 0, 1, 2 without rotating throwaway
      const events: NostrEvent[] = [];
      for (let i = 0; i < 3; i++) {
        const { event } = buildZeroTrustMessage(host.session, { i }, false, false);
        events.push(event);
      }

      // Deliver seq 2 first (skip 0 and 1)
      // Player expects seq 0, tries 0,1,2,-1 — seq 2 should match
      const result = decryptZeroTrustMessage(player.session, events[2]);
      expect(result).not.toBeNull();
      expect(result!.payload).toEqual({ i: 2 });
    });

    it('large gap fails to decrypt on established session', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const [player] = genPlayers(1, SHARE_CODE, SESSION_ID);

      setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);

      // Deliver first message so session is established (lastReceivedSeq=0)
      const { event: event0 } = buildZeroTrustMessage(host.session, { i: 0 }, false, false);
      const r0 = decryptZeroTrustMessage(player.session, event0);
      expect(r0).not.toBeNull();
      expect(player.session.lastReceivedSeq).toBe(0);

      // Build many more messages (seq 1-9)
      const events: NostrEvent[] = [];
      for (let i = 1; i <= 9; i++) {
        const { event } = buildZeroTrustMessage(host.session, { i }, false, false);
        events.push(event);
      }

      // Try to deliver seq 9 (= index 8). Player expects seq 1, window is [1..6, 0].
      // Seq 9 is outside the window.
      const result = decryptZeroTrustMessage(player.session, events[8]);
      expect(result).toBeNull();
    });
  });

  describe('forward secrecy', () => {
    it('old throwaway cannot decrypt new messages after player rotates', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const [player] = genPlayers(1, SHARE_CODE, SESSION_ID);

      // Save player's initial throwaway privkey
      const oldThrowawayPrivkey = new Uint8Array(player.session.currentThrowawayPrivkey);
      const oldThrowawayPubkey = player.session.currentThrowawayPubkey;

      setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);

      // Round 1: host → player (host rotates throwaway, player learns host's next throwaway)
      const { event: event1 } = buildZeroTrustMessage(host.session, { msg: 1 });
      const result1 = decryptZeroTrustMessage(player.session, event1);
      expect(result1).not.toBeNull();

      // Round 2: player → host (player rotates throwaway, host learns player's next throwaway)
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);
      const { event: event2 } = buildZeroTrustMessage(player.session, { msg: 'ack' });
      const result2 = decryptZeroTrustMessage(host.session, event2);
      expect(result2).not.toBeNull();
      // Host now knows player's NEW throwaway from next_throwaway tag

      // Round 3: host → player (encrypts to player's NEW throwaway)
      const { event: event3 } = buildZeroTrustMessage(host.session, { msg: 2 });

      // Try decrypting with OLD throwaway — should fail (forward secrecy)
      const fakeSession = { ...player.session };
      fakeSession.currentThrowawayPrivkey = oldThrowawayPrivkey;
      fakeSession.currentThrowawayPubkey = oldThrowawayPubkey;
      fakeSession.lastReceivedSeq = -1;

      const resultOld = decryptZeroTrustMessage(fakeSession, event3);
      expect(resultOld).toBeNull();

      // Current throwaway CAN decrypt
      const resultNew = decryptZeroTrustMessage(player.session, event3);
      expect(resultNew).not.toBeNull();
      expect(resultNew!.payload).toEqual({ msg: 2 });
    });
  });

  describe('1-to-many mode', () => {
    it('host sends to 20 players with rotateThrowaway=false, all decrypt', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const players = genPlayers(20, SHARE_CODE, SESSION_ID);

      for (const player of players) {
        // Temporarily point host at this player's throwaway
        setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);
        setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);

        // Build message without rotating host's throwaway
        const { event } = buildZeroTrustMessage(
          host.session,
          { type: 'hunt_data', forPlayer: player.pubkey },
          false, // includeNextThrowaway
          false, // rotateThrowaway
        );

        const result = decryptZeroTrustMessage(player.session, event);
        expect(result).not.toBeNull();
        expect(result!.payload).toEqual({
          type: 'hunt_data',
          forPlayer: player.pubkey,
        });
      }

      // Host throwaway should still be the original (not rotated)
      // All 20 messages used sequence numbers 0-19
      expect(host.session.sequenceNumber).toBe(20);
    });

    it('includeNextThrowaway=false means no next_throwaway tag for receiver', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const [player] = genPlayers(1, SHARE_CODE, SESSION_ID);

      setTheirThrowaway(host.session, player.session.currentThrowawayPubkey);
      setTheirThrowaway(player.session, host.session.currentThrowawayPubkey);

      const { event } = buildZeroTrustMessage(
        host.session,
        { type: 'test' },
        false, // includeNextThrowaway
        false,
      );

      const result = decryptZeroTrustMessage(player.session, event);
      expect(result).not.toBeNull();
      expect(result!.senderNextThrowaway).toBeUndefined();
    });
  });

  describe('session cleanup', () => {
    it('destroySession zeroes key material', () => {
      const host = genHost(SHARE_CODE, SESSION_ID);
      const sessionKeyBefore = new Uint8Array(host.session.sessionKey);
      expect(sessionKeyBefore.some(b => b !== 0)).toBe(true);

      destroySession(host.session);

      expect(host.session.sessionKey.every(b => b === 0)).toBe(true);
      expect(host.session.currentThrowawayPrivkey.every(b => b === 0)).toBe(true);
    });
  });
});
