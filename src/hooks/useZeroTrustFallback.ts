/**
 * Zero-Trust Relay Fallback Hook
 *
 * Provides encrypted data relay through Nostr when P2P fails.
 * Uses the zero-trust protocol (NIP-XX) where relays learn nothing.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
  createSession,
  setTheirThrowaway,
  buildZeroTrustMessage,
  decryptZeroTrustMessage,
  destroySession,
  getThrowawayPubkey,
  ZERO_TRUST_OUTER_KIND,
  type ZeroTrustSession,
  type SessionHandshake,
} from '@/lib/zeroTrustRelay';
import type { HuntLocationData } from '@/lib/p2pSignaling';

type FallbackState = 'idle' | 'initializing' | 'ready' | 'sending' | 'receiving' | 'complete' | 'error';

interface UseZeroTrustHostResult {
  state: FallbackState;
  error: string | null;
  handshakeData: SessionHandshake | null;
  initSession: (huntId: string) => SessionHandshake;
  sendHuntData: (data: HuntLocationData, playerThrowaway: string) => Promise<boolean>;
  cleanup: () => void;
}

interface UseZeroTrustPlayerResult {
  state: FallbackState;
  error: string | null;
  huntData: HuntLocationData | null;
  connect: (handshake: SessionHandshake) => Promise<HuntLocationData | null>;
  cleanup: () => void;
}

// Default relays for zero-trust messaging
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

/**
 * Host-side hook for zero-trust fallback
 */
export function useZeroTrustHost(): UseZeroTrustHostResult {
  const { nostr } = useNostr();
  const [state, setState] = useState<FallbackState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [handshakeData, setHandshakeData] = useState<SessionHandshake | null>(null);

  const sessionRef = useRef<ZeroTrustSession | null>(null);
  const sessionPrivkeyRef = useRef<Uint8Array | null>(null);

  // Initialize a session for a hunt
  const initSession = useCallback((huntId: string): SessionHandshake => {
    setState('initializing');
    setError(null);

    // Generate session keypair
    const sessionPrivkey = generateSecretKey();
    const sessionPubkey = getPublicKey(sessionPrivkey);
    sessionPrivkeyRef.current = sessionPrivkey;

    // Create placeholder session (we'll set their pubkey when player connects)
    // For now, use a dummy pubkey that will be replaced
    const session = createSession(huntId, sessionPrivkey, sessionPubkey);
    sessionRef.current = session;

    const handshake: SessionHandshake = {
      sessionId: huntId,
      sessionPubkey: sessionPubkey,
      throwawayPubkey: getThrowawayPubkey(session),
      relays: DEFAULT_RELAYS,
    };

    setHandshakeData(handshake);
    setState('ready');

    return handshake;
  }, []);

  // Send hunt data to a player
  const sendHuntData = useCallback(async (
    data: HuntLocationData,
    playerThrowaway: string
  ): Promise<boolean> => {
    if (!sessionRef.current || !nostr) {
      setError('Session not initialized');
      return false;
    }

    setState('sending');

    try {
      // Set the player's throwaway pubkey
      setTheirThrowaway(sessionRef.current, playerThrowaway);

      // Build encrypted message
      const { event } = buildZeroTrustMessage(sessionRef.current, data, false);

      // Publish to multiple relays
      await nostr.event(event);

      setState('complete');
      return true;
    } catch (err) {
      console.error('[ZeroTrust Host] Send failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to send data');
      setState('error');
      return false;
    }
  }, [nostr]);

  // Cleanup
  const cleanup = useCallback(() => {
    if (sessionRef.current) {
      destroySession(sessionRef.current);
      sessionRef.current = null;
    }
    if (sessionPrivkeyRef.current) {
      sessionPrivkeyRef.current.fill(0);
      sessionPrivkeyRef.current = null;
    }
    setState('idle');
    setError(null);
    setHandshakeData(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    state,
    error,
    handshakeData,
    initSession,
    sendHuntData,
    cleanup,
  };
}

/**
 * Player-side hook for zero-trust fallback
 */
export function useZeroTrustPlayer(): UseZeroTrustPlayerResult {
  const { nostr } = useNostr();
  const [state, setState] = useState<FallbackState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [huntData, setHuntData] = useState<HuntLocationData | null>(null);

  const sessionRef = useRef<ZeroTrustSession | null>(null);
  const sessionPrivkeyRef = useRef<Uint8Array | null>(null);

  // Connect to host and receive hunt data
  const connect = useCallback(async (
    handshake: SessionHandshake
  ): Promise<HuntLocationData | null> => {
    if (!nostr) {
      setError('Nostr not available');
      setState('error');
      return null;
    }

    setState('initializing');
    setError(null);

    try {
      // Generate our session keypair
      const sessionPrivkey = generateSecretKey();
      const _sessionPubkey = getPublicKey(sessionPrivkey); // Used internally by createSession
      sessionPrivkeyRef.current = sessionPrivkey;

      // Create session with host's pubkey
      const session = createSession(
        handshake.sessionId,
        sessionPrivkey,
        handshake.sessionPubkey
      );
      sessionRef.current = session;

      // Set host's throwaway pubkey
      setTheirThrowaway(session, handshake.throwawayPubkey);

      // Send our throwaway pubkey to host (so they can encrypt response to us)
      const ourThrowaway = getThrowawayPubkey(session);

      // Build a "hello" message with our throwaway
      const { event: helloEvent } = buildZeroTrustMessage(session, {
        type: 'player_hello',
        throwaway: ourThrowaway,
      }, true);

      // Publish hello message
      await nostr.event(helloEvent);

      setState('receiving');

      // Subscribe to messages for our throwaway
      const data = await waitForHuntData(nostr, session, ourThrowaway, 30000);

      if (data) {
        setHuntData(data);
        setState('complete');
        return data;
      } else {
        setError('Timeout waiting for hunt data');
        setState('error');
        return null;
      }
    } catch (err) {
      console.error('[ZeroTrust Player] Connect failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setState('error');
      return null;
    }
  }, [nostr]);

  // Cleanup
  const cleanup = useCallback(() => {
    if (sessionRef.current) {
      destroySession(sessionRef.current);
      sessionRef.current = null;
    }
    if (sessionPrivkeyRef.current) {
      sessionPrivkeyRef.current.fill(0);
      sessionPrivkeyRef.current = null;
    }
    setState('idle');
    setError(null);
    setHuntData(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    state,
    error,
    huntData,
    connect,
    cleanup,
  };
}

/**
 * Wait for hunt data from host
 */
async function waitForHuntData(
  nostr: ReturnType<typeof useNostr>['nostr'],
  session: ZeroTrustSession,
  myThrowaway: string,
  timeoutMs: number
): Promise<HuntLocationData | null> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Query for messages to our throwaway
      const events = await nostr.query(
        [
          {
            kinds: [ZERO_TRUST_OUTER_KIND],
            '#p': [myThrowaway],
            since: Math.floor(startTime / 1000) - 60, // Last minute + buffer
            limit: 10,
          },
        ],
        { signal: AbortSignal.timeout(5000) }
      );

      for (const event of events) {
        const result = decryptZeroTrustMessage(session, event);
        if (result?.payload) {
          // Check if this is hunt data (has geoFence, monsters, satStops)
          const payload = result.payload as Record<string, unknown>;
          if (payload.geoFence && payload.monsters && payload.satStops) {
            return payload as unknown as HuntLocationData;
          }
        }
      }
    } catch {
      // Query failed, will retry
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return null;
}

/**
 * Host: Wait for player hello message and get their throwaway
 */
export async function waitForPlayerHello(
  nostr: ReturnType<typeof useNostr>['nostr'],
  session: ZeroTrustSession,
  myThrowaway: string,
  timeoutMs: number
): Promise<string | null> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const events = await nostr.query(
        [
          {
            kinds: [ZERO_TRUST_OUTER_KIND],
            '#p': [myThrowaway],
            since: Math.floor(startTime / 1000) - 60,
            limit: 10,
          },
        ],
        { signal: AbortSignal.timeout(5000) }
      );

      for (const event of events) {
        const result = decryptZeroTrustMessage(session, event);
        if (result?.payload) {
          const payload = result.payload as Record<string, unknown>;
          if (payload.type === 'player_hello' && typeof payload.throwaway === 'string') {
            return payload.throwaway;
          }
        }
      }
    } catch {
      // Query failed, will retry
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return null;
}
