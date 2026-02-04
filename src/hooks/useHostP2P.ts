/**
 * Host-side P2P hook for serving hunt location data
 *
 * Reversed flow: Players create offers, host responds with answers.
 * This ensures each player gets their own unique peer connection.
 *
 * When players respond with offers, the host:
 * 1. Creates an answer for that specific player's peer connection
 * 2. Publishes the answer to Nostr
 * 3. Sends hunt location data when the data channel opens
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import { useLocalStorage } from './useLocalStorage';
import type { HuntEvent } from '@/lib/gameTypes';
import {
  P2P_OFFER_KIND,
  createPlayerConnection,
  sendHuntData,
  buildAnswerEvent,
  parseOfferFromEvent,
  type HuntLocationData,
} from '@/lib/p2pSignaling';

// Serializer for Set in localStorage
const setSerializer = {
  serialize: (value: Set<string>) => JSON.stringify([...value]),
  deserialize: (value: string) => new Set<string>(JSON.parse(value)),
};

interface PlayerConnection {
  pubkey: string;
  peerConnection: RTCPeerConnection;
  state: 'connecting' | 'connected' | 'sent' | 'failed';
}

interface UseHostP2PResult {
  isActive: boolean;
  connectedPlayers: number;
  sentDataTo: number;
  error: string | null;
  startHosting: () => void;
  stopHosting: () => void;
}

export function useHostP2P(hunt: HuntEvent | null): UseHostP2PResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track player connections
  const connectionsRef = useRef<Map<string, PlayerConnection>>(new Map());
  const [connectedPlayers, setConnectedPlayers] = useState(0);
  const [sentDataTo, setSentDataTo] = useState(0);

  // Hunt data to send
  const huntDataRef = useRef<HuntLocationData | null>(null);

  // Persist processed offer IDs to localStorage to survive navigation/refresh
  const processedOffersKey = useMemo(
    () => `sathunter:p2p-processed-offers:${hunt?.id ?? 'no-hunt'}`,
    [hunt?.id]
  );
  const [processedOffers, setProcessedOffers] = useLocalStorage<Set<string>>(
    processedOffersKey,
    new Set(),
    setSerializer
  );

  // Cleanup function (doesn't clear processedOffers - they persist in localStorage)
  const cleanup = useCallback(() => {
    connectionsRef.current.forEach((conn) => {
      try {
        conn.peerConnection.close();
      } catch {
        // Ignore cleanup errors
      }
    });
    connectionsRef.current.clear();
    setIsActive(false);
    setConnectedPlayers(0);
    setSentDataTo(0);
  }, []);

  // Handle incoming offer from a player
  const handleOffer = useCallback(
    async (offerSdp: string, playerPubkey: string, eventId: string) => {
      if (!hunt || !user?.signer) return;

      // Check if we already processed this offer (persisted in localStorage)
      if (processedOffers.has(eventId)) {
        return;
      }

      // Mark as processed immediately to prevent duplicate processing
      setProcessedOffers(prev => new Set(prev).add(eventId));

      // Check if we already have a connection for this player
      if (connectionsRef.current.has(playerPubkey)) {
        return;
      }

      try {
        // Pre-create connection object so it can be referenced in the callback
        const connection: PlayerConnection = {
          pubkey: playerPubkey,
          peerConnection: null as unknown as RTCPeerConnection,
          state: 'connecting',
        };

        // Handler for when data channel is received
        const handleDataChannel = (channel: RTCDataChannel) => {
          channel.onopen = () => {
            connection.state = 'connected';
            setConnectedPlayers((prev) => prev + 1);

            if (huntDataRef.current) {
              try {
                sendHuntData(channel, huntDataRef.current);
                connection.state = 'sent';
                setSentDataTo((prev) => prev + 1);
              } catch (err) {
                console.error('[P2P Host] Failed to send data:', err);
                connection.state = 'failed';
              }
            }
          };

          channel.onerror = () => {
            connection.state = 'failed';
          };
        };

        // Create answer for this player's offer
        const { peerConnection, answer } = await createPlayerConnection(
          { type: 'offer', sdp: offerSdp },
          handleDataChannel
        );

        // Update connection with actual peer connection
        connection.peerConnection = peerConnection;
        connectionsRef.current.set(playerPubkey, connection);

        // Track connection failures
        peerConnection.onconnectionstatechange = () => {
          if (peerConnection.connectionState === 'failed') {
            connection.state = 'failed';
          }
        };

        // Publish answer to Nostr
        const answerEvent = buildAnswerEvent(
          hunt.id,
          hunt.shareCode,
          answer,
          playerPubkey
        );

        const signedEvent = await user.signer.signEvent({
          kind: answerEvent.kind,
          created_at: Math.floor(Date.now() / 1000),
          content: answerEvent.content,
          tags: answerEvent.tags,
        });

        await nostr.event(signedEvent);

      } catch (err) {
        console.error('[P2P Host] Error handling offer:', err);
      }
    },
    [hunt, user, nostr, processedOffers, setProcessedOffers]
  );

  // Start hosting - prepare hunt data and start listening for offers
  const startHosting = useCallback(() => {
    if (!hunt || !user?.signer) {
      setError('No hunt or user available');
      return;
    }

    try {
      setError(null);

      // Prepare hunt data to send
      huntDataRef.current = {
        geoFence: hunt.geoFence,
        monsters: hunt.monsters,
        satStops: hunt.satStops,
      };

      setIsActive(true);
    } catch (err) {
      console.error('[P2P Host] Failed to start hosting:', err);
      setError(err instanceof Error ? err.message : 'Failed to start P2P hosting');
    }
  }, [hunt, user]);

  // Stop hosting
  const stopHosting = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // Subscribe to offer events from players
  useEffect(() => {
    if (!isActive || !hunt || !user) return;

    const controller = new AbortController();

    const pollForOffers = async () => {
      try {
        const events = await nostr.query(
          [
            {
              kinds: [P2P_OFFER_KIND],
              '#h': [hunt.id],
              '#p': [user.pubkey],
              since: Math.floor(Date.now() / 1000) - 300, // Last 5 minutes
            },
          ],
          { signal: controller.signal }
        );

        for (const event of events) {
          const { sdp, playerPubkey } = parseOfferFromEvent(event);
          if (playerPubkey && sdp) {
            handleOffer(sdp, playerPubkey, event.id);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('[P2P Host] Error polling for offers:', err);
        }
      }
    };

    // Poll every 2 seconds for new offers
    pollForOffers();
    const interval = setInterval(pollForOffers, 2000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [isActive, hunt, user, nostr, handleOffer]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    isActive,
    connectedPlayers,
    sentDataTo,
    error,
    startHosting,
    stopHosting,
  };
}
