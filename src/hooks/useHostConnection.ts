/**
 * Unified Host Connection Hook
 *
 * Handles both P2P and zero-trust relay for sending hunt data to players.
 * Supports both connection methods simultaneously.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import { useLocalStorage } from './useLocalStorage';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { HuntEvent } from '@/lib/gameTypes';
import {
  deriveCastKeypair,
  buildCaptureStateEvent,
  type CaptureStateEntry,
} from '@/lib/captureBroadcast';
import {
  P2P_OFFER_KIND,
  createPlayerConnection,
  sendHuntData,
  buildHelloPayload,
  buildAnswerEvent,
  parseOfferFromEvent,
  type HuntLocationData,
} from '@/lib/p2pSignaling';
import { generateCaptureSecret } from '@/lib/antiCheat';
import { signWithSessionKey } from '@/lib/sessionKeys';
import {
  createSessionFromPSK,
  buildZeroTrustMessage,
  decryptZeroTrustMessage,
  destroySession,
  getThrowawayPubkey,
  ZERO_TRUST_OUTER_KIND,
  ZERO_TRUST_HANDSHAKE_KIND,
  type ZeroTrustSession,
  type SessionHandshake,
} from '@/lib/zeroTrustRelay';

import { setSerializer } from '@/lib/serializers';

interface PlayerConnection {
  pubkey: string;
  method: 'p2p' | 'relay';
  peerConnection?: RTCPeerConnection;
  state: 'connecting' | 'connected' | 'sent' | 'failed';
}

interface UseHostConnectionResult {
  isActive: boolean;
  connectedPlayers: number;
  sentDataTo: number;
  error: string | null;
  zeroTrustHandshake: SessionHandshake | null;
  captureSecret: string | null;
  startHosting: () => void;
  stopHosting: () => void;
  // Tier 2: broadcast the full authoritative captured-state to players over the
  // ephemeral relay (signed under the per-hunt broadcast key). No-op until hosting.
  broadcastCaptureState: (entries: CaptureStateEntry[], stateVersion: number) => Promise<void>;
}

// Default relays for zero-trust messaging
const ZERO_TRUST_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

export function useHostConnection(
  hunt: HuntEvent | null,
  onPlayerJoined?: (pubkey: string) => void,
  onPlayerLeft?: (pubkey: string) => void,
  // Tier 2 late-joiner correctness: return the host's current authoritative
  // captured-state so every hello (P2P + zero-trust) reflects captures up to send
  // time. Held in a ref (updated each render) so the hello handlers stay stable
  // and never capture a stale snapshot.
  getCaptureState?: () => { stateVersion: number; entries: CaptureStateEntry[] } | null
): UseHostConnectionResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  // Keep the latest getter without re-creating the hello handlers.
  const getCaptureStateRef = useRef(getCaptureState);
  getCaptureStateRef.current = getCaptureState;

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zeroTrustHandshake, setZeroTrustHandshake] = useState<SessionHandshake | null>(null);

  // Track player connections
  const connectionsRef = useRef<Map<string, PlayerConnection>>(new Map());
  const [connectedPlayers, setConnectedPlayers] = useState(0);

  // Zero-trust session
  const zeroTrustSessionRef = useRef<ZeroTrustSession | null>(null);
  const zeroTrustPrivkeyRef = useRef<Uint8Array | null>(null);
  const sentEventIdsRef = useRef<Set<string>>(new Set());
  const helloQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Hunt data to send
  const huntDataRef = useRef<HuntLocationData | null>(null);

  // Persist capture secret so it survives page refreshes
  const captureSecretKey = useMemo(
    () => `sathunter:capture-secret:${hunt?.id ?? 'no-hunt'}`,
    [hunt?.id]
  );
  const [persistedCaptureSecret, setPersistedCaptureSecret] = useLocalStorage<string | null>(
    captureSecretKey,
    null
  );
  const captureSecretRef = useRef<string | null>(persistedCaptureSecret);

  // Persist the ephemeral per-hunt broadcast keypair (Tier 2 host authenticity).
  // Store the privkey hex so it survives refresh; NEVER log or print it.
  const broadcastKeyStorageKey = useMemo(
    () => `sathunter:broadcast-key:${hunt?.id ?? 'no-hunt'}`,
    [hunt?.id]
  );
  const [persistedBroadcastKey, setPersistedBroadcastKey] = useLocalStorage<string | null>(
    broadcastKeyStorageKey,
    null
  );
  const broadcastPrivkeyRef = useRef<Uint8Array | null>(null);
  const broadcastPubkeyRef = useRef<string | null>(null);

  // Persist processed offer IDs
  const processedOffersKey = useMemo(
    () => `sathunter:host-processed-offers:${hunt?.id ?? 'no-hunt'}`,
    [hunt?.id]
  );
  const [processedOffers, setProcessedOffers] = useLocalStorage<Set<string>>(
    processedOffersKey,
    new Set(),
    setSerializer
  );

  // Persist sent data count
  const sentDataKey = useMemo(
    () => `sathunter:host-sent-data:${hunt?.id ?? 'no-hunt'}`,
    [hunt?.id]
  );
  const [persistedSentDataTo, setPersistedSentDataTo] = useLocalStorage<number>(
    sentDataKey,
    0
  );

  // Cleanup P2P connections
  const cleanupP2P = useCallback(() => {
    connectionsRef.current.forEach((conn) => {
      if (conn.peerConnection) {
        try {
          conn.peerConnection.close();
        } catch {
          // Ignore
        }
      }
    });
    connectionsRef.current.clear();
  }, []);

  // Cleanup zero-trust session
  const cleanupZeroTrust = useCallback(() => {
    if (zeroTrustSessionRef.current) {
      destroySession(zeroTrustSessionRef.current);
      zeroTrustSessionRef.current = null;
    }
    if (zeroTrustPrivkeyRef.current) {
      zeroTrustPrivkeyRef.current.fill(0);
      zeroTrustPrivkeyRef.current = null;
    }
    if (broadcastPrivkeyRef.current) {
      broadcastPrivkeyRef.current.fill(0);
      broadcastPrivkeyRef.current = null;
    }
    broadcastPubkeyRef.current = null;
    setZeroTrustHandshake(null);
  }, []);

  // Full cleanup
  const cleanup = useCallback(() => {
    cleanupP2P();
    cleanupZeroTrust();
    setIsActive(false);
    setConnectedPlayers(0);
  }, [cleanupP2P, cleanupZeroTrust]);

  // Handle incoming P2P offer
  const handleP2POffer = useCallback(
    async (offerSdp: string, playerPubkey: string, eventId: string) => {
      if (!hunt || !user || !nostr) return;

      if (processedOffers.has(eventId)) return;
      setProcessedOffers(prev => new Set(prev).add(eventId));

      if (connectionsRef.current.has(playerPubkey)) return;

      try {
        const connection: PlayerConnection = {
          pubkey: playerPubkey,
          method: 'p2p',
          peerConnection: undefined,
          state: 'connecting',
        };

        const handleDataChannel = (channel: RTCDataChannel) => {
          channel.onopen = () => {
            connection.state = 'connected';
            setConnectedPlayers((prev) => prev + 1);
            onPlayerJoined?.(playerPubkey);

            if (huntDataRef.current) {
              try {
                // Attach the authoritative captured-state at SEND time so a late
                // joiner's map is correct immediately (winnerProof only, no npubs).
                sendHuntData(
                  channel,
                  buildHelloPayload(huntDataRef.current, getCaptureStateRef.current)
                );
                connection.state = 'sent';
                setPersistedSentDataTo((prev) => prev + 1);
              } catch (err) {
                console.error('[Host P2P] Failed to send data:', err);
                connection.state = 'failed';
              }
            }
          };

          channel.onerror = () => {
            connection.state = 'failed';
          };

          channel.onclose = () => {
            onPlayerLeft?.(playerPubkey);
          };
        };

        const { peerConnection, answer } = await createPlayerConnection(
          { type: 'offer', sdp: offerSdp },
          handleDataChannel
        );

        connection.peerConnection = peerConnection;
        connectionsRef.current.set(playerPubkey, connection);

        peerConnection.onconnectionstatechange = () => {
          if (peerConnection.connectionState === 'failed') {
            connection.state = 'failed';
          }
          if (peerConnection.connectionState === 'disconnected' ||
              peerConnection.connectionState === 'closed') {
            onPlayerLeft?.(playerPubkey);
          }
        };

        // Publish answer
        const answerEvent = buildAnswerEvent(
          hunt.id,
          hunt.shareCode,
          answer,
          playerPubkey,
          user.pubkey
        );

        const signedEvent = signWithSessionKey({
          kind: answerEvent.kind,
          created_at: Math.floor(Date.now() / 1000),
          content: answerEvent.content,
          tags: answerEvent.tags,
        });

        await nostr.event(signedEvent);
      } catch (err) {
        console.error('[Host P2P] Error handling offer:', err);
      }
    },
    [hunt, user, nostr, processedOffers, setProcessedOffers, setPersistedSentDataTo, onPlayerJoined, onPlayerLeft]
  );

  // Handle incoming zero-trust hello message
  // playerNextThrowaway is captured BEFORE this async call to avoid race conditions
  const handleZeroTrustHello = useCallback(
    async (playerNextThrowaway: string, huntId: string) => {
      if (!hunt || !nostr || !zeroTrustSessionRef.current) return;
      if (huntId !== hunt.id) return;

      console.log('[Host ZeroTrust] Received hello from player, sending hunt data...');

      try {
        // Temporarily set theirThrowaway to this specific player's key
        // (must be done right before buildZeroTrustMessage since it reads from session)
        const savedTheirThrowaway = zeroTrustSessionRef.current.theirThrowawayPubkey;
        zeroTrustSessionRef.current.theirThrowawayPubkey = playerNextThrowaway;

        // Send hunt data (don't rotate throwaway — host must keep receiving on same key for other players).
        // Attach the authoritative captured-state at SEND time so late joiners are
        // correct from second zero (winnerProof only, never a winner npub).
        const helloPayload = buildHelloPayload(huntDataRef.current!, getCaptureStateRef.current);
        const { event } = buildZeroTrustMessage(
          zeroTrustSessionRef.current,
          helloPayload,
          false, // includeNextThrowaway
          false  // rotateThrowaway — 1-to-many scenario
        );

        // Restore previous throwaway so other concurrent handlers aren't affected
        zeroTrustSessionRef.current.theirThrowawayPubkey = savedTheirThrowaway;

        sentEventIdsRef.current.add(event.id);
        await nostr.event(event);

        setPersistedSentDataTo((prev) => prev + 1);
        setConnectedPlayers((prev) => prev + 1);

        console.log('[Host ZeroTrust] Hunt data sent successfully');
      } catch (err) {
        console.error('[Host ZeroTrust] Failed to send hunt data:', err);
      }
    },
    [hunt, nostr, setPersistedSentDataTo]
  );

  // Initialize zero-trust session
  const initZeroTrust = useCallback(async () => {
    if (!hunt || !user || !nostr) return;

    // Generate session keypair
    const sessionPrivkey = generateSecretKey();
    const sessionPubkey = getPublicKey(sessionPrivkey);
    zeroTrustPrivkeyRef.current = sessionPrivkey;

    // Create session using PSK (share code) so any player with the code derives the same session key
    // Use shareCode as sessionId since hunt.id changes after Nostr publication
    const session = createSessionFromPSK(hunt.shareCode, sessionPrivkey, hunt.shareCode);
    zeroTrustSessionRef.current = session;

    // Create handshake data
    const handshake: SessionHandshake = {
      sessionId: hunt.id,
      sessionPubkey: sessionPubkey,
      throwawayPubkey: getThrowawayPubkey(session),
      relays: ZERO_TRUST_RELAYS,
    };

    setZeroTrustHandshake(handshake);

    // Publish handshake to Nostr so players can discover our throwaway pubkey
    try {
      const handshakeEvent = signWithSessionKey({
        kind: ZERO_TRUST_HANDSHAKE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify(handshake),
        tags: [['h', hunt.id], ['s', hunt.shareCode]],
      });
      await nostr.event(handshakeEvent);
      console.log('[Host ZeroTrust] Published handshake for hunt', hunt.shareCode);
    } catch (err) {
      console.error('[Host ZeroTrust] Failed to publish handshake:', err);
    }
  }, [hunt, user, nostr]);

  // Start hosting
  const startHosting = useCallback(async () => {
    if (!hunt || !user) {
      setError('No hunt or user available');
      return;
    }

    try {
      setError(null);

      // Reuse persisted capture secret or generate a new one
      // (must survive page refreshes so player proofs stay valid)
      if (persistedCaptureSecret) {
        captureSecretRef.current = persistedCaptureSecret;
      } else {
        captureSecretRef.current = generateCaptureSecret();
        setPersistedCaptureSecret(captureSecretRef.current);
      }

      // Reuse or generate the ephemeral per-hunt broadcast keypair. Persisted as
      // privkey hex so a host refresh keeps signing under the same key players
      // already learned; never logged.
      let broadcastPrivkeyHex = persistedBroadcastKey;
      if (!broadcastPrivkeyHex) {
        broadcastPrivkeyHex = bytesToHex(generateSecretKey());
        setPersistedBroadcastKey(broadcastPrivkeyHex);
      }
      broadcastPrivkeyRef.current = hexToBytes(broadcastPrivkeyHex);
      broadcastPubkeyRef.current = getPublicKey(broadcastPrivkeyRef.current);

      // Prepare hunt data (includes captureSecret for player verification and the
      // broadcast pubkey players verify Tier 2 capture-state against)
      huntDataRef.current = {
        geoFence: hunt.geoFence,
        monsters: hunt.monsters,
        satStops: hunt.satStops,
        captureSecret: captureSecretRef.current,
        hostBroadcastPubkey: broadcastPubkeyRef.current,
      };

      // Initialize zero-trust
      await initZeroTrust();

      setIsActive(true);
    } catch (err) {
      console.error('[Host] Failed to start hosting:', err);
      setError(err instanceof Error ? err.message : 'Failed to start hosting');
    }
  }, [hunt, user, initZeroTrust, persistedCaptureSecret, setPersistedCaptureSecret, persistedBroadcastKey, setPersistedBroadcastKey]);

  // Stop hosting
  const stopHosting = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // Tier 2: publish the full authoritative captured-state as an encrypted,
  // host-signed broadcast over the ephemeral relay. One outer event regardless
  // of player count; players subscribe on the shareCode-derived cast pubkey.
  const broadcastCaptureState = useCallback(
    async (entries: CaptureStateEntry[], stateVersion: number) => {
      if (!hunt || !nostr || !broadcastPrivkeyRef.current) return;
      try {
        const cast = deriveCastKeypair(hunt.shareCode);
        const event = buildCaptureStateEvent(
          broadcastPrivkeyRef.current,
          cast.pubkey,
          hunt.id,
          stateVersion,
          entries
        );
        await nostr.event(event);
      } catch (err) {
        console.error('[Host ZeroTrust] Failed to broadcast capture state:', err);
      }
    },
    [hunt, nostr]
  );

  // Poll for P2P offers
  useEffect(() => {
    if (!isActive || !hunt || !user || !nostr) return;

    const controller = new AbortController();

    const pollForOffers = async () => {
      try {
        const events = await nostr.query(
          [
            {
              kinds: [P2P_OFFER_KIND],
              '#h': [hunt.id],
              '#p': [user.pubkey],
              since: Math.floor(Date.now() / 1000) - 300,
            },
          ],
          { signal: controller.signal }
        );

        for (const event of events) {
          const { sdp, playerPubkey } = parseOfferFromEvent(event);
          if (playerPubkey && sdp) {
            handleP2POffer(sdp, playerPubkey, event.id);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('[Host] Error polling for P2P offers:', err);
        }
      }
    };

    pollForOffers();
    const interval = setInterval(pollForOffers, 2000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [isActive, hunt, user, nostr, handleP2POffer]);

  // Subscribe to zero-trust hello messages (streaming, not polling)
  useEffect(() => {
    if (!isActive || !hunt || !nostr || !zeroTrustSessionRef.current || !zeroTrustHandshake) return;

    let isSubscribed = true;
    const processedHellos = new Set<string>();

    const subscription = nostr.req([
      {
        kinds: [ZERO_TRUST_OUTER_KIND],
        '#p': [zeroTrustHandshake.throwawayPubkey],
        since: Math.floor(Date.now() / 1000) - 300,
      },
    ]);

    (async () => {
      try {
        for await (const msg of subscription) {
          if (!isSubscribed) break;
          if (msg[0] !== 'EVENT') continue;

          const event = msg[2];
          if (processedHellos.has(event.id)) continue;
          processedHellos.add(event.id);

          // Skip our own outgoing messages that bounce back from relays
          if (sentEventIdsRef.current.has(event.id)) continue;

          const result = decryptZeroTrustMessage(zeroTrustSessionRef.current!, event);
          if (result?.payload) {
            const payload = result.payload as Record<string, unknown>;
            if (payload.type === 'player_hello' &&
                typeof payload.throwaway === 'string' &&
                typeof payload.huntId === 'string') {
              // Capture the player's next throwaway NOW before another hello overwrites it
              const playerNextThrowaway = result.senderNextThrowaway || (payload.throwaway as string);
              const huntId = payload.huntId as string;
              helloQueueRef.current = helloQueueRef.current.then(() =>
                handleZeroTrustHello(playerNextThrowaway, huntId)
              );
            }
          }
        }
      } catch (err) {
        if (isSubscribed) {
          console.error('[Host] Zero-trust subscription error:', err);
        }
      }
    })();

    return () => {
      isSubscribed = false;
    };
  }, [isActive, hunt, nostr, zeroTrustHandshake, handleZeroTrustHello]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    isActive,
    connectedPlayers,
    sentDataTo: persistedSentDataTo,
    error,
    zeroTrustHandshake,
    captureSecret: captureSecretRef.current,
    startHosting,
    stopHosting,
    broadcastCaptureState,
  };
}
