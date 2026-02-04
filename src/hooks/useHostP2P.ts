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

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import type { HuntEvent } from '@/lib/gameTypes';
import {
  P2P_OFFER_KIND,
  createPlayerConnection,
  sendHuntData,
  buildAnswerEvent,
  parseOfferFromEvent,
  type HuntLocationData,
} from '@/lib/p2pSignaling';

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

// Helper to get/set processed offers from localStorage
function getProcessedOffers(huntId: string): Set<string> {
  try {
    const stored = localStorage.getItem(`sathunter:p2p-offers:${huntId}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveProcessedOffer(huntId: string, offerId: string): void {
  try {
    const current = getProcessedOffers(huntId);
    current.add(offerId);
    localStorage.setItem(`sathunter:p2p-offers:${huntId}`, JSON.stringify([...current]));
  } catch {
    // Ignore storage errors
  }
}

function getSentDataCount(huntId: string): number {
  try {
    return parseInt(localStorage.getItem(`sathunter:p2p-sent:${huntId}`) || '0', 10);
  } catch {
    return 0;
  }
}

function saveSentDataCount(huntId: string, count: number): void {
  try {
    localStorage.setItem(`sathunter:p2p-sent:${huntId}`, count.toString());
  } catch {
    // Ignore storage errors
  }
}

export function useHostP2P(hunt: HuntEvent | null): UseHostP2PResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track player connections (in-memory only, not persisted)
  const connectionsRef = useRef<Map<string, PlayerConnection>>(new Map());
  const [connectedPlayers, setConnectedPlayers] = useState(0);

  // Initialize sentDataTo from localStorage
  const [sentDataTo, setSentDataTo] = useState(() =>
    hunt?.id ? getSentDataCount(hunt.id) : 0
  );

  // Hunt data to send
  const huntDataRef = useRef<HuntLocationData | null>(null);

  // Track processed offer IDs - initialized from localStorage
  const processedOffersRef = useRef<Set<string>>(
    hunt?.id ? getProcessedOffers(hunt.id) : new Set()
  );

  // Track if we're being cleaned up to avoid state updates after unmount
  const isCleaningUpRef = useRef(false);

  // Update refs when hunt changes
  useEffect(() => {
    if (hunt?.id) {
      processedOffersRef.current = getProcessedOffers(hunt.id);
      setSentDataTo(getSentDataCount(hunt.id));
    }
  }, [hunt?.id]);

  // Cleanup function - closes connections but preserves processed offers in localStorage
  const cleanup = useCallback(() => {
    if (isCleaningUpRef.current) return; // Already cleaning up
    isCleaningUpRef.current = true;

    console.log('[P2P Host] Cleaning up', connectionsRef.current.size, 'connections');
    connectionsRef.current.forEach((conn) => {
      try {
        conn.peerConnection.close();
      } catch {
        // Ignore cleanup errors
      }
    });
    connectionsRef.current.clear();
    // Don't clear processedOffersRef - it's persisted in localStorage
    setIsActive(false);
    setConnectedPlayers(0);
    // Don't reset sentDataTo - it's persisted in localStorage
    isCleaningUpRef.current = false;
  }, []);

  // Handle incoming offer from a player
  const handleOffer = useCallback(
    async (offerSdp: string, playerPubkey: string, eventId: string) => {
      if (!hunt || !user?.signer) return;

      // Check if we already processed this offer (checks localStorage too)
      if (processedOffersRef.current.has(eventId)) {
        console.log('[P2P Host] Skipping already-processed offer', eventId.slice(0, 8));
        return;
      }
      processedOffersRef.current.add(eventId);
      // Persist to localStorage so we don't re-process after navigation/refresh
      if (hunt.id) {
        saveProcessedOffer(hunt.id, eventId);
      }

      // Check if we already have a connection for this player
      if (connectionsRef.current.has(playerPubkey)) {
        console.log('[P2P Host] Already have connection for', playerPubkey.slice(0, 8));
        return;
      }

      try {
        console.log('[P2P Host] Processing offer from', playerPubkey.slice(0, 8));

        // Create answer for this player's offer
        const { peerConnection, answer } = await createPlayerConnection({
          type: 'offer',
          sdp: offerSdp,
        });

        // Store connection
        const connection: PlayerConnection = {
          pubkey: playerPubkey,
          peerConnection,
          state: 'connecting',
        };
        connectionsRef.current.set(playerPubkey, connection);

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
        console.log('[P2P Host] Published answer for', playerPubkey.slice(0, 8));

        // Wait for data channel (player created it in their offer)
        peerConnection.ondatachannel = (event) => {
          const channel = event.channel;
          console.log('[P2P Host] Data channel received from', playerPubkey.slice(0, 8), 'state:', channel.readyState);

          const markConnected = () => {
            // Guard against double-counting
            if (connection.state === 'connecting') {
              connection.state = 'connected';
              setConnectedPlayers((prev) => prev + 1);
            }
          };

          const sendData = () => {
            // Guard against double-sending
            if (connection.state === 'sent') return;
            if (huntDataRef.current && channel.readyState === 'open') {
              try {
                sendHuntData(channel, huntDataRef.current);
                connection.state = 'sent';
                setSentDataTo((prev) => {
                  const newCount = prev + 1;
                  // Persist to localStorage
                  if (hunt.id) {
                    saveSentDataCount(hunt.id, newCount);
                  }
                  return newCount;
                });
                console.log('[P2P Host] Sent hunt data to', playerPubkey.slice(0, 8));
              } catch (err) {
                console.error('[P2P Host] Failed to send data:', err);
                connection.state = 'failed';
              }
            }
          };

          // Channel might already be open
          if (channel.readyState === 'open') {
            console.log('[P2P Host] Data channel already open for', playerPubkey.slice(0, 8));
            markConnected();
            sendData();
          }

          channel.onopen = () => {
            console.log('[P2P Host] Data channel open for', playerPubkey.slice(0, 8));
            markConnected();
            sendData();
          };

          channel.onerror = (err) => {
            // Only log as error if we haven't sent data yet - otherwise it's just cleanup
            if (connection.state !== 'sent') {
              console.error('[P2P Host] Data channel error:', err);
              connection.state = 'failed';
            } else {
              console.log('[P2P Host] Data channel closed after sending data to', playerPubkey.slice(0, 8));
            }
          };

          channel.onclose = () => {
            console.log('[P2P Host] Data channel closed for', playerPubkey.slice(0, 8), 'state was:', connection.state);
          };
        };

        peerConnection.onconnectionstatechange = () => {
          console.log('[P2P Host] Connection state:', peerConnection.connectionState, 'for', playerPubkey.slice(0, 8));
          if (peerConnection.connectionState === 'failed') {
            connection.state = 'failed';
          }
        };

        peerConnection.oniceconnectionstatechange = () => {
          console.log('[P2P Host] ICE state:', peerConnection.iceConnectionState, 'for', playerPubkey.slice(0, 8));
        };

      } catch (err) {
        console.error('[P2P Host] Error handling offer:', err);
      }
    },
    [hunt, user, nostr]
  );

  // Start hosting - prepare hunt data and start listening for offers
  const startHosting = useCallback(() => {
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

      setIsActive(true);
      console.log('[P2P Host] Ready to receive player offers');
    } catch (err) {
      console.error('[P2P Host] Failed to start hosting:', err);
      setError(err instanceof Error ? err.message : 'Failed to start P2P hosting');
    }
  }, [hunt, user]);

  // Stop hosting
  const stopHosting = useCallback(() => {
    console.log('[P2P Host] Stopping P2P hosting');
    cleanup();
  }, [cleanup]);

  // Subscribe to offer events from players
  useEffect(() => {
    if (!isActive || !hunt || !user) return;

    console.log('[P2P Host] Subscribing to offer events for hunt', hunt.shareCode);

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
