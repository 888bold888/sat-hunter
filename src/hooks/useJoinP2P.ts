/**
 * Player-side P2P hook for receiving hunt location data
 *
 * Reversed flow: Player creates offer, host responds with answer.
 * This ensures each player gets their own unique peer connection.
 *
 * The player:
 * 1. Creates a WebRTC offer with a data channel
 * 2. Publishes the offer to Nostr (tagged for the host)
 * 3. Polls for the host's answer
 * 4. Applies the answer to complete the connection
 * 5. Receives hunt location data on the data channel
 */

import { useState, useCallback, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import {
  P2P_ANSWER_KIND,
  createHostConnection,
  applyAnswer,
  buildOfferEvent,
  type HuntLocationData,
} from '@/lib/p2pSignaling';

type ConnectionState = 'idle' | 'creating-offer' | 'waiting-answer' | 'connecting' | 'waiting-data' | 'complete' | 'error';

interface UseJoinP2PResult {
  state: ConnectionState;
  error: string | null;
  huntData: HuntLocationData | null;
  connect: (huntId: string, shareCode: string, hostPubkey: string) => Promise<HuntLocationData | null>;
  reset: () => void;
}

export function useJoinP2P(): UseJoinP2PResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const [state, setState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [huntData, setHuntData] = useState<HuntLocationData | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // Cleanup
  const cleanup = useCallback(() => {
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

  // Reset state
  const reset = useCallback(() => {
    cleanup();
    setState('idle');
    setError(null);
    setHuntData(null);
  }, [cleanup]);

  // Connect to host and receive hunt data
  const connect = useCallback(
    async (huntId: string, shareCode: string, hostPubkey: string): Promise<HuntLocationData | null> => {
      if (!user?.signer) {
        setError('Please log in first');
        setState('error');
        return null;
      }

      try {
        setError(null);
        setState('creating-offer');

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

        const signedOffer = await user.signer.signEvent({
          kind: offerEvent.kind,
          created_at: Math.floor(Date.now() / 1000),
          content: offerEvent.content,
          tags: offerEvent.tags,
        });

        await nostr.event(signedOffer);

        setState('waiting-answer');

        // Poll for host's answer
        const answerSdp = await pollForAnswer(
          nostr,
          huntId,
          user.pubkey,
          30000 // 30 second timeout
        );

        if (!answerSdp) {
          setError('Connection failed: Could not connect to host. Make sure they have the hunt open.');
          setState('error');
          cleanup();
          return null;
        }

        setState('connecting');

        // Apply answer
        await applyAnswer(peerConnection, {
          type: 'answer',
          sdp: answerSdp,
        });

        setState('waiting-data');

        // Wait for hunt data from host on our data channel
        const data = await waitForDataOnChannel(dataChannel, 30000);

        setHuntData(data);
        setState('complete');

        return data;
      } catch (err) {
        console.error('[P2P Player] Connection error:', err);
        setError(err instanceof Error ? err.message : 'Failed to connect to host');
        setState('error');
        cleanup();
        return null;
      }
    },
    [user, nostr, cleanup]
  );

  return {
    state,
    error,
    huntData,
    connect,
    reset,
  };
}

/**
 * Poll Nostr for the host's answer
 */
async function pollForAnswer(
  nostr: ReturnType<typeof useNostr>['nostr'],
  huntId: string,
  playerPubkey: string,
  timeoutMs: number
): Promise<string | null> {
  const startTime = Date.now();
  const pollInterval = 1000; // 1 second

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

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return null;
}

/**
 * Wait for data on the data channel (player side - we created the channel)
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
      reject(new Error('Data channel closed before receiving data'));
    };
  });
}
