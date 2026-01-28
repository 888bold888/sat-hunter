import { useState, useCallback, useEffect, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';

// Nostr event kinds for join request/response
const JOIN_REQUEST_KIND = 32962;
const JOIN_RESPONSE_KIND = 32963;

export type JoinRequestStatus = 'idle' | 'requesting' | 'pending' | 'approved' | 'rejected';

interface JoinRequestResult {
  status: JoinRequestStatus;
  requestId: string | null;
  rejectionReason?: string;
  error: string | null;
  requestJoin: (huntId: string, shareCode: string, hostPubkey: string, message?: string) => Promise<boolean>;
  reset: () => void;
}

export function useJoinRequest(): JoinRequestResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const [status, setStatus] = useState<JoinRequestStatus>('idle');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  // Track subscription for cleanup
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setRequestId(null);
    setRejectionReason(undefined);
    setError(null);
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const requestJoin = useCallback(async (
    huntId: string,
    shareCode: string,
    hostPubkey: string,
    message?: string
  ): Promise<boolean> => {
    if (!user?.signer) {
      setError('You must be logged in to request to join');
      return false;
    }

    setStatus('requesting');
    setError(null);

    try {
      const playerPubkeyShort = user.pubkey.slice(0, 8);

      // Create join request event
      const signedEvent = await user.signer.signEvent({
        kind: JOIN_REQUEST_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({ message: message || '' }),
        tags: [
          ['d', `join-${shareCode}-${playerPubkeyShort}`],
          ['e', huntId],
          ['p', hostPubkey],
          ['hunt_code', shareCode],
          ['status', 'pending'],
        ],
      });

      // Publish to relays
      await nostr.event(signedEvent);

      setRequestId(signedEvent.id);
      setStatus('pending');

      // Start polling for response
      const pollForResponse = async () => {
        try {
          const responses = await nostr.query([
            {
              kinds: [JOIN_RESPONSE_KIND],
              authors: [hostPubkey],
              '#p': [user.pubkey],
              '#e': [huntId],
              limit: 1,
            },
          ], { signal: AbortSignal.timeout(5000) });

          if (responses.length > 0) {
            const response = responses[0];
            const decision = response.tags.find(([t]) => t === 'decision')?.[1];

            if (decision === 'approved') {
              setStatus('approved');
              if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
              }
            } else if (decision === 'rejected') {
              setStatus('rejected');
              try {
                const content = JSON.parse(response.content);
                setRejectionReason(content.reason);
              } catch {
                // No reason provided
              }
              if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
              }
            }
          }
        } catch (err) {
          console.error('Error polling for join response:', err);
        }
      };

      // Poll every 2 seconds
      pollingRef.current = setInterval(pollForResponse, 2000);
      // Also poll immediately
      pollForResponse();

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send join request');
      setStatus('idle');
      return false;
    }
  }, [nostr, user]);

  return {
    status,
    requestId,
    rejectionReason,
    error,
    requestJoin,
    reset,
  };
}
