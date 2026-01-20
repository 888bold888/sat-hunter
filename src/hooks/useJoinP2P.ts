/**
 * Player-side P2P hook for receiving hunt location data
 *
 * The player fetches the host's WebRTC offer from Nostr,
 * creates an answer, publishes it, and waits for the host
 * to send hunt location data directly via P2P.
 */

import { useState, useCallback, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import {
  P2P_OFFER_KIND,
  createPlayerConnection,
  waitForHuntData,
  buildAnswerEvent,
  parseOfferFromEvent,
  type HuntLocationData,
} from '@/lib/p2pSignaling';

type ConnectionState = 'idle' | 'fetching-offer' | 'connecting' | 'waiting-data' | 'complete' | 'error';

interface UseJoinP2PResult {
  state: ConnectionState;
  error: string | null;
  huntData: HuntLocationData | null;
  connect: (huntId: string, shareCode: string) => Promise<HuntLocationData | null>;
  reset: () => void;
}

export function useJoinP2P(): UseJoinP2PResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const [state, setState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [huntData, setHuntData] = useState<HuntLocationData | null>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  // Cleanup
  const cleanup = useCallback(() => {
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
    async (huntId: string, shareCode: string): Promise<HuntLocationData | null> => {
      if (!user?.signer) {
        setError('Please log in first');
        setState('error');
        return null;
      }

      try {
        setError(null);
        setState('fetching-offer');
        console.log('[P2P Player] Fetching offer for hunt', shareCode);

        // Fetch offer from Nostr
        const events = await nostr.query(
          [
            {
              kinds: [P2P_OFFER_KIND],
              '#d': [`p2p-${shareCode}`],
              limit: 1,
            },
          ],
          { signal: AbortSignal.timeout(15000) }
        );

        if (events.length === 0) {
          // No P2P offer found - host might not be online or hunt uses legacy mode
          setError('Host not available for P2P connection. They may need to open the hunt.');
          setState('error');
          return null;
        }

        const offerEvent = events[0];
        const { sdp: offerSdp, hostPubkey } = parseOfferFromEvent(offerEvent);

        console.log('[P2P Player] Got offer from host', hostPubkey.slice(0, 8));
        setState('connecting');

        // Create answer
        const { peerConnection, answer } = await createPlayerConnection({
          type: 'offer',
          sdp: offerSdp,
        });
        peerConnectionRef.current = peerConnection;

        // Publish answer to Nostr
        const answerEvent = buildAnswerEvent(
          huntId,
          shareCode,
          answer,
          hostPubkey,
          user.pubkey
        );

        const signedAnswer = await user.signer.signEvent({
          kind: answerEvent.kind,
          created_at: Math.floor(Date.now() / 1000),
          content: answerEvent.content,
          tags: answerEvent.tags,
        });

        await nostr.event(signedAnswer);
        console.log('[P2P Player] Published answer to Nostr');

        setState('waiting-data');

        // Wait for hunt data from host
        const data = await waitForHuntData(peerConnection, 30000);

        console.log('[P2P Player] Received hunt data:', {
          monsters: data.monsters.length,
          satStops: data.satStops.length,
        });

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
