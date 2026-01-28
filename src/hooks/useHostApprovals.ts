import { useState, useCallback, useEffect, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import { useAuthor } from './useAuthor';

// Nostr event kinds for join request/response
const JOIN_REQUEST_KIND = 32962;
const JOIN_RESPONSE_KIND = 32963;

export interface PendingJoinRequest {
  id: string;
  playerPubkey: string;
  requestedAt: number;
  message?: string;
  shareCode: string;
  huntId: string;
}

interface UseHostApprovalsResult {
  pendingRequests: PendingJoinRequest[];
  approvedPlayers: Set<string>;
  isLoading: boolean;
  error: string | null;
  approvePlayer: (request: PendingJoinRequest) => Promise<boolean>;
  rejectPlayer: (request: PendingJoinRequest, reason?: string) => Promise<boolean>;
  startListening: (huntId: string, shareCode: string) => void;
  stopListening: () => void;
}

// Component to fetch player metadata for display
export function usePlayerMetadata(pubkey: string | undefined) {
  const { data } = useAuthor(pubkey);
  return data?.metadata;
}

export function useHostApprovals(): UseHostApprovalsResult {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const [pendingRequests, setPendingRequests] = useState<PendingJoinRequest[]>([]);
  const [approvedPlayers, setApprovedPlayers] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const huntIdRef = useRef<string | null>(null);
  const shareCodeRef = useRef<string | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const fetchRequests = useCallback(async () => {
    if (!user?.pubkey || !huntIdRef.current || !shareCodeRef.current) return;

    try {
      // Fetch join requests for this hunt
      const requests = await nostr.query([
        {
          kinds: [JOIN_REQUEST_KIND],
          '#e': [huntIdRef.current],
          '#p': [user.pubkey],
          limit: 50,
        },
      ], { signal: AbortSignal.timeout(10000) });

      // Fetch our responses to filter out already-handled requests
      const responses = await nostr.query([
        {
          kinds: [JOIN_RESPONSE_KIND],
          authors: [user.pubkey],
          '#e': [huntIdRef.current],
          limit: 100,
        },
      ], { signal: AbortSignal.timeout(10000) });

      // Build set of player pubkeys we've already responded to
      const respondedTo = new Set<string>();
      const approved = new Set<string>();
      for (const response of responses) {
        const playerPubkey = response.tags.find(([t]) => t === 'p')?.[1];
        const decision = response.tags.find(([t]) => t === 'decision')?.[1];
        if (playerPubkey) {
          respondedTo.add(playerPubkey);
          if (decision === 'approved') {
            approved.add(playerPubkey);
          }
        }
      }

      setApprovedPlayers(approved);

      // Filter to only pending requests
      const pending: PendingJoinRequest[] = [];
      for (const request of requests) {
        const playerPubkey = request.pubkey;
        if (respondedTo.has(playerPubkey)) continue;

        let message: string | undefined;
        try {
          const content = JSON.parse(request.content);
          message = content.message;
        } catch {
          // No message
        }

        const shareCode = request.tags.find(([t]) => t === 'hunt_code')?.[1] || '';
        const huntId = request.tags.find(([t]) => t === 'e')?.[1] || '';

        pending.push({
          id: request.id,
          playerPubkey,
          requestedAt: request.created_at * 1000,
          message,
          shareCode,
          huntId,
        });
      }

      // Sort by request time (newest first)
      pending.sort((a, b) => b.requestedAt - a.requestedAt);

      setPendingRequests(pending);
    } catch (err) {
      console.error('Error fetching join requests:', err);
    }
  }, [nostr, user?.pubkey]);

  const startListening = useCallback((huntId: string, shareCode: string) => {
    huntIdRef.current = huntId;
    shareCodeRef.current = shareCode;
    setIsLoading(true);

    // Fetch immediately
    fetchRequests().finally(() => setIsLoading(false));

    // Poll every 3 seconds
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }
    pollingRef.current = setInterval(fetchRequests, 3000);
  }, [fetchRequests]);

  const stopListening = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    huntIdRef.current = null;
    shareCodeRef.current = null;
    setPendingRequests([]);
  }, []);

  const approvePlayer = useCallback(async (request: PendingJoinRequest): Promise<boolean> => {
    if (!user?.signer) {
      setError('You must be logged in to approve players');
      return false;
    }

    try {
      const playerPubkeyShort = request.playerPubkey.slice(0, 8);

      // Create approval response
      const signedEvent = await user.signer.signEvent({
        kind: JOIN_RESPONSE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({}),
        tags: [
          ['d', `response-${request.shareCode}-${playerPubkeyShort}`],
          ['e', request.huntId],
          ['p', request.playerPubkey],
          ['decision', 'approved'],
        ],
      });

      await nostr.event(signedEvent);

      // Update local state
      setPendingRequests(prev => prev.filter(r => r.id !== request.id));
      setApprovedPlayers(prev => new Set(prev).add(request.playerPubkey));

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve player');
      return false;
    }
  }, [nostr, user]);

  const rejectPlayer = useCallback(async (request: PendingJoinRequest, reason?: string): Promise<boolean> => {
    if (!user?.signer) {
      setError('You must be logged in to reject players');
      return false;
    }

    try {
      const playerPubkeyShort = request.playerPubkey.slice(0, 8);

      // Create rejection response
      const signedEvent = await user.signer.signEvent({
        kind: JOIN_RESPONSE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({ reason: reason || '' }),
        tags: [
          ['d', `response-${request.shareCode}-${playerPubkeyShort}`],
          ['e', request.huntId],
          ['p', request.playerPubkey],
          ['decision', 'rejected'],
        ],
      });

      await nostr.event(signedEvent);

      // Update local state
      setPendingRequests(prev => prev.filter(r => r.id !== request.id));

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject player');
      return false;
    }
  }, [nostr, user]);

  return {
    pendingRequests,
    approvedPlayers,
    isLoading,
    error,
    approvePlayer,
    rejectPlayer,
    startListening,
    stopListening,
  };
}
