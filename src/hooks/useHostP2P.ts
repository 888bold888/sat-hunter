/**
 * Host-side P2P hook for serving hunt location data
 *
 * The host creates a WebRTC offer and publishes it to Nostr.
 * When players respond with answers, the host completes the connection
 * and sends hunt location data directly (P2P, never touches relays).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import type { HuntEvent } from '@/lib/gameTypes';
import {
  P2P_ANSWER_KIND,
  createHostConnection,
  applyAnswer,
  sendHuntData,
  buildOfferEvent,
  parseAnswerFromEvent,
  type HuntLocationData,
} from '@/lib/p2pSignaling';

interface PlayerConnection {
  pubkey: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  state: 'connecting' | 'connected' | 'sent' | 'failed';
}

interface UseHostP2PResult {
  isActive: boolean;
  connectedPlayers: number;
  sentDataTo: number;
  error: string | null;
  startHosting: () => Promise<void>;
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

  // Store offer for reuse
  const offerRef = useRef<RTCSessionDescriptionInit | null>(null);

  // Hunt data to send
  const huntDataRef = useRef<HuntLocationData | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    connectionsRef.current.forEach((conn) => {
      try {
        conn.dataChannel.close();
        conn.peerConnection.close();
      } catch {
        // Ignore cleanup errors
      }
    });
    connectionsRef.current.clear();
    offerRef.current = null;
    setIsActive(false);
    setConnectedPlayers(0);
    setSentDataTo(0);
  }, []);

  // Handle incoming answer from a player
  const handleAnswer = useCallback(
    async (answerSdp: string, playerPubkey: string) => {
      if (!hunt || !offerRef.current) return;

      // Check if we already have a connection for this player
      if (connectionsRef.current.has(playerPubkey)) {
        console.log('[P2P Host] Already have connection for', playerPubkey.slice(0, 8));
        return;
      }

      try {
        console.log('[P2P Host] Processing answer from', playerPubkey.slice(0, 8));

        // Create a new peer connection for this player
        const { peerConnection, dataChannel } = await createHostConnection();

        // Store connection
        const connection: PlayerConnection = {
          pubkey: playerPubkey,
          peerConnection,
          dataChannel,
          state: 'connecting',
        };
        connectionsRef.current.set(playerPubkey, connection);

        // Apply the answer
        await applyAnswer(peerConnection, {
          type: 'answer',
          sdp: answerSdp,
        });

        // Wait for data channel to open, then send hunt data
        dataChannel.onopen = () => {
          console.log('[P2P Host] Data channel open for', playerPubkey.slice(0, 8));
          connection.state = 'connected';
          setConnectedPlayers((prev) => prev + 1);

          if (huntDataRef.current) {
            try {
              sendHuntData(dataChannel, huntDataRef.current);
              connection.state = 'sent';
              setSentDataTo((prev) => prev + 1);
              console.log('[P2P Host] Sent hunt data to', playerPubkey.slice(0, 8));
            } catch (err) {
              console.error('[P2P Host] Failed to send data:', err);
              connection.state = 'failed';
            }
          }
        };

        dataChannel.onerror = (err) => {
          console.error('[P2P Host] Data channel error:', err);
          connection.state = 'failed';
        };

        peerConnection.onconnectionstatechange = () => {
          console.log('[P2P Host] Connection state:', peerConnection.connectionState);
          if (peerConnection.connectionState === 'failed') {
            connection.state = 'failed';
          }
        };
      } catch (err) {
        console.error('[P2P Host] Error handling answer:', err);
      }
    },
    [hunt]
  );

  // Start hosting - create offer and publish to Nostr
  const startHosting = useCallback(async () => {
    if (!hunt || !user?.signer) {
      setError('No hunt or user available');
      return;
    }

    try {
      setError(null);
      console.log('[P2P Host] Starting P2P hosting for hunt', hunt.shareCode);

      // Prepare hunt data to send
      huntDataRef.current = {
        geoFence: hunt.geoFence,
        monsters: hunt.monsters,
        satStops: hunt.satStops,
      };

      // Create initial offer
      const { offer } = await createHostConnection();
      offerRef.current = offer;

      // Build and publish offer event to Nostr
      const offerEvent = buildOfferEvent(
        hunt.id,
        hunt.shareCode,
        offer,
        user.pubkey
      );

      const signedEvent = await user.signer.signEvent({
        kind: offerEvent.kind,
        created_at: Math.floor(Date.now() / 1000),
        content: offerEvent.content,
        tags: offerEvent.tags,
      });

      await nostr.event(signedEvent);
      console.log('[P2P Host] Published offer to Nostr');

      setIsActive(true);
    } catch (err) {
      console.error('[P2P Host] Failed to start hosting:', err);
      setError(err instanceof Error ? err.message : 'Failed to start P2P hosting');
    }
  }, [hunt, user, nostr]);

  // Stop hosting
  const stopHosting = useCallback(() => {
    console.log('[P2P Host] Stopping P2P hosting');
    cleanup();
  }, [cleanup]);

  // Subscribe to answer events from players
  useEffect(() => {
    if (!isActive || !hunt || !user) return;

    console.log('[P2P Host] Subscribing to answer events for hunt', hunt.shareCode);

    const controller = new AbortController();

    const pollForAnswers = async () => {
      try {
        const events = await nostr.query(
          [
            {
              kinds: [P2P_ANSWER_KIND],
              '#h': [hunt.id],
              '#p': [user.pubkey],
              since: Math.floor(Date.now() / 1000) - 300, // Last 5 minutes
            },
          ],
          { signal: controller.signal }
        );

        for (const event of events) {
          const { sdp, playerPubkey } = parseAnswerFromEvent(event);
          if (playerPubkey && sdp) {
            handleAnswer(sdp, playerPubkey);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('[P2P Host] Error polling for answers:', err);
        }
      }
    };

    // Poll every 2 seconds for new answers
    pollForAnswers();
    const interval = setInterval(pollForAnswers, 2000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [isActive, hunt, user, nostr, handleAnswer]);

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
