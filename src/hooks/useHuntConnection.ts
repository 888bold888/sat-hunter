/**
 * Unified Hunt Connection Hook
 *
 * Attempts P2P connection first, falls back to zero-trust relay if P2P fails.
 * Provides a single interface for connecting to hunts regardless of method.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import { generateSecretKey } from 'nostr-tools';
import {
  P2P_ANSWER_KIND,
  createHostConnection,
  applyAnswer,
  buildOfferEvent,
  type HuntLocationData,
} from '@/lib/p2pSignaling';
import { signWithSessionKey } from '@/lib/sessionKeys';
import {
  createSessionFromPSK,
  setTheirThrowaway,
  buildZeroTrustMessage,
  decryptZeroTrustMessage,
  destroySession,
  getThrowawayPubkey,
  ZERO_TRUST_OUTER_KIND,
  ZERO_TRUST_HANDSHAKE_KIND,
  type ZeroTrustSession,
  type SessionHandshake,
} from '@/lib/zeroTrustRelay';

type ConnectionMethod = 'p2p' | 'relay' | null;
type ConnectionState =
  | 'idle'
  | 'p2p-connecting'
  | 'p2p-waiting'
  | 'relay-fallback'
  | 'relay-connecting'
  | 'complete'
  | 'error';

interface UseHuntConnectionResult {
  state: ConnectionState;
  method: ConnectionMethod;
  error: string | null;
  huntData: HuntLocationData | null;
  connect: (huntId: string, shareCode: string, hostPubkey: string, hostThrowaway?: string) => Promise<HuntLocationData | null>;
  reset: () => void;
}

// Timeouts
const P2P_TIMEOUT_MS = 15000; // 15 seconds for P2P before fallback
const RELAY_TIMEOUT_MS = 30000; // 30 seconds for relay

// Default relays for zero-trust messaging (reserved for future multi-relay support)
const _ZERO_TRUST_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

export function useHuntConnection(): UseHuntConnectionResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const [state, setState] = useState<ConnectionState>('idle');
  const [method, setMethod] = useState<ConnectionMethod>(null);
  const [error, setError] = useState<string | null>(null);
  const [huntData, setHuntData] = useState<HuntLocationData | null>(null);

  // P2P refs
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // Zero-trust refs
  const sessionRef = useRef<ZeroTrustSession | null>(null);
  const sessionPrivkeyRef = useRef<Uint8Array | null>(null);

  // Cleanup P2P resources
  const cleanupP2P = useCallback(() => {
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch {
        // Ignore
      }
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {
        // Ignore
      }
      peerConnectionRef.current = null;
    }
  }, []);

  // Cleanup zero-trust resources
  const cleanupZeroTrust = useCallback(() => {
    if (sessionRef.current) {
      destroySession(sessionRef.current);
      sessionRef.current = null;
    }
    if (sessionPrivkeyRef.current) {
      sessionPrivkeyRef.current.fill(0);
      sessionPrivkeyRef.current = null;
    }
  }, []);

  // Full cleanup
  const cleanup = useCallback(() => {
    cleanupP2P();
    cleanupZeroTrust();
  }, [cleanupP2P, cleanupZeroTrust]);

  // Reset state
  const reset = useCallback(() => {
    cleanup();
    setState('idle');
    setMethod(null);
    setError(null);
    setHuntData(null);
  }, [cleanup]);

  // Attempt P2P connection
  const attemptP2P = async (
    huntId: string,
    shareCode: string,
    hostPubkey: string
  ): Promise<HuntLocationData | null> => {
    if (!user || !nostr) return null;

    try {
      // Create offer with data channel
      const { peerConnection, dataChannel, offer } = await createHostConnection();
      peerConnectionRef.current = peerConnection;
      dataChannelRef.current = dataChannel;

      // Publish offer to Nostr
      const offerEvent = buildOfferEvent(
        huntId,
        shareCode,
        offer,
        hostPubkey,
        user.pubkey
      );

      const signedOffer = signWithSessionKey({
        kind: offerEvent.kind,
        created_at: Math.floor(Date.now() / 1000),
        content: offerEvent.content,
        tags: offerEvent.tags,
      });

      await nostr.event(signedOffer);

      // Poll for host's answer with shorter timeout
      const answerSdp = await pollForAnswer(nostr, huntId, user.pubkey, P2P_TIMEOUT_MS);

      if (!answerSdp) {
        return null; // P2P failed, caller will try fallback
      }

      // Apply answer
      await applyAnswer(peerConnection, { type: 'answer', sdp: answerSdp });

      // Wait for data
      const data = await waitForDataOnChannel(dataChannel, 15000);

      return data;
    } catch (err) {
      console.log('[HuntConnection] P2P failed:', err);
      return null;
    }
  };

  // Attempt zero-trust relay fallback
  const attemptZeroTrust = async (
    huntId: string,
    shareCode: string,
    hostThrowaway?: string
  ): Promise<HuntLocationData | null> => {
    if (!nostr) return null;

    try {
      // Query for host's handshake event to get their throwaway pubkey
      let hostThrowawayPubkey = hostThrowaway;

      if (!hostThrowawayPubkey) {
        console.log('[HuntConnection] Querying for host handshake...');
        const handshakeEvents = await nostr.query(
          [
            {
              kinds: [ZERO_TRUST_HANDSHAKE_KIND],
              '#s': [shareCode],
              limit: 1,
            },
          ],
          { signal: AbortSignal.timeout(10000) }
        );

        if (handshakeEvents.length > 0) {
          const handshake = JSON.parse(handshakeEvents[0].content) as SessionHandshake;
          hostThrowawayPubkey = handshake.throwawayPubkey;
          console.log('[HuntConnection] Found host handshake, throwaway:', hostThrowawayPubkey.slice(0, 8) + '...');
        } else {
          console.error('[HuntConnection] No host handshake found');
          return null;
        }
      }

      // Generate session keypair
      const sessionPrivkey = generateSecretKey();
      sessionPrivkeyRef.current = sessionPrivkey;

      // Create session using PSK (share code) — same key the host derived
      // Use shareCode as sessionId to match the host (huntId is unstable)
      const session = createSessionFromPSK(shareCode, sessionPrivkey, shareCode);
      sessionRef.current = session;

      // Set host's throwaway pubkey from handshake
      setTheirThrowaway(session, hostThrowawayPubkey);

      // Get our throwaway for host to respond to
      const ourThrowaway = getThrowawayPubkey(session);

      // Send hello message with our throwaway
      const { event: helloEvent } = buildZeroTrustMessage(session, {
        type: 'player_hello',
        throwaway: ourThrowaway,
        huntId,
      }, true);

      await nostr.event(helloEvent);

      // After buildZeroTrustMessage, our throwaway rotated. The host will encrypt
      // to our next_throwaway (included in the hello's inner tags), so poll with
      // the post-rotation throwaway that matches our current privkey.
      const postRotationThrowaway = getThrowawayPubkey(session);

      // Wait for hunt data
      const data = await waitForZeroTrustData(nostr, session, postRotationThrowaway, RELAY_TIMEOUT_MS);

      return data;
    } catch (err) {
      console.error('[HuntConnection] Zero-trust failed:', err);
      if (err instanceof AggregateError) {
        console.error('[HuntConnection] Relay errors:', err.errors.map((e: Error) => e.message));
      }
      return null;
    }
  };

  // Main connect function
  const connect = useCallback(
    async (
      huntId: string,
      shareCode: string,
      hostPubkey: string,
      hostThrowaway?: string
    ): Promise<HuntLocationData | null> => {
      if (!user) {
        setError('Please log in first');
        setState('error');
        return null;
      }

      reset();
      setError(null);

      // 1. Try P2P first
      setState('p2p-connecting');
      setMethod('p2p');

      console.log('[HuntConnection] Attempting P2P connection...');
      const p2pData = await attemptP2P(huntId, shareCode, hostPubkey);

      if (p2pData) {
        console.log('[HuntConnection] P2P succeeded!');
        setHuntData(p2pData);
        setState('complete');
        return p2pData;
      }

      // 2. P2P failed, clean up and try zero-trust relay
      console.log('[HuntConnection] P2P failed, falling back to zero-trust relay...');
      cleanupP2P();

      setState('relay-fallback');
      await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UI

      setState('relay-connecting');
      setMethod('relay');

      const relayData = await attemptZeroTrust(huntId, shareCode, hostThrowaway);

      if (relayData) {
        console.log('[HuntConnection] Zero-trust relay succeeded!');
        setHuntData(relayData);
        setState('complete');
        return relayData;
      }

      // 3. Both methods failed
      console.error('[HuntConnection] All connection methods failed');
      setError('Could not connect to host. Please ensure they have the hunt open and try again.');
      setState('error');
      cleanup();
      return null;
    },
    // Note: attemptP2P and attemptZeroTrust are defined inside the component and use user/nostr
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, nostr, reset, cleanupP2P, cleanup]
  );

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    state,
    method,
    error,
    huntData,
    connect,
    reset,
  };
}

/**
 * Poll Nostr for the host's P2P answer
 */
async function pollForAnswer(
  nostr: ReturnType<typeof useNostr>['nostr'],
  huntId: string,
  playerPubkey: string,
  timeoutMs: number
): Promise<string | null> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const events = await nostr.query(
        [
          {
            kinds: [P2P_ANSWER_KIND],
            '#h': [huntId],
            '#p': [playerPubkey],
            since: Math.floor(startTime / 1000) - 10,
            limit: 1,
          },
        ],
        { signal: AbortSignal.timeout(5000) }
      );

      if (events.length > 0) {
        const parsed = JSON.parse(events[0].content);
        return parsed.sdp;
      }
    } catch {
      // Poll error, will retry
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return null;
}

/**
 * Wait for data on P2P data channel
 */
function waitForDataOnChannel(
  dataChannel: RTCDataChannel,
  timeoutMs: number
): Promise<HuntLocationData> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for hunt data'));
    }, timeoutMs);

    dataChannel.onmessage = (event) => {
      clearTimeout(timeout);
      try {
        const data = JSON.parse(event.data) as HuntLocationData;
        resolve(data);
      } catch {
        reject(new Error('Invalid hunt data received'));
      }
    };

    dataChannel.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Data channel error'));
    };

    dataChannel.onclose = () => {
      clearTimeout(timeout);
      reject(new Error('Data channel closed'));
    };
  });
}

/**
 * Wait for hunt data via zero-trust relay (subscription-based for ephemeral events)
 */
async function waitForZeroTrustData(
  nostr: ReturnType<typeof useNostr>['nostr'],
  session: ZeroTrustSession,
  myThrowaway: string,
  timeoutMs: number
): Promise<HuntLocationData | null> {
  return new Promise<HuntLocationData | null>((resolve) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        isActive = false;
        resolve(null);
      }
    }, timeoutMs);

    let isActive = true;

    const subscription = nostr.req([
      {
        kinds: [ZERO_TRUST_OUTER_KIND],
        '#p': [myThrowaway],
        since: Math.floor(Date.now() / 1000) - 60,
      },
    ]);

    (async () => {
      try {
        for await (const msg of subscription) {
          if (!isActive) break;
          if (msg[0] !== 'EVENT') continue;

          const event = msg[2];
          const result = decryptZeroTrustMessage(session, event);
          if (result?.payload) {
            const payload = result.payload as Record<string, unknown>;
            if (payload.geoFence && payload.monsters && payload.satStops) {
              if (!resolved) {
                resolved = true;
                isActive = false;
                clearTimeout(timeout);
                resolve(payload as unknown as HuntLocationData);
              }
              break;
            }
          }
        }
      } catch (err) {
        if (isActive) {
          console.error('[HuntConnection] Subscription error:', err);
        }
      }
    })();
  });
}
