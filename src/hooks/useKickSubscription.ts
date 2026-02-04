/**
 * Hook for players to subscribe to kick events
 * Polls for kick events targeting the current user in the current hunt
 */

import { useEffect, useCallback, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import type { HuntEvent } from '@/lib/gameTypes';
import { PLAYER_KICK_KIND } from './usePublishKick';

interface KickEventContent {
  reason?: string;
}

interface UseKickSubscriptionOptions {
  hunt: HuntEvent | null;
  onKicked: (reason: string) => void;
}

export function useKickSubscription({ hunt, onKicked }: UseKickSubscriptionOptions) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const processedKicksRef = useRef<Set<string>>(new Set());
  const hasBeenKickedRef = useRef(false);

  const checkForKicks = useCallback(async () => {
    if (!hunt || !user?.pubkey || hasBeenKickedRef.current) return;

    // Don't check if we're the host
    if (hunt.hostPubkey === user.pubkey) return;

    try {
      const events = await nostr.query(
        [
          {
            kinds: [PLAYER_KICK_KIND],
            '#e': [hunt.id],
            '#p': [user.pubkey], // Only events targeting this player
            since: Math.floor((hunt.startTime || Date.now() - 3600000) / 1000),
          },
        ],
        { signal: AbortSignal.timeout(10000) }
      );

      for (const event of events) {
        if (processedKicksRef.current.has(event.id)) continue;
        processedKicksRef.current.add(event.id);

        // Verify this kick is from the host
        if (event.pubkey !== hunt.hostPubkey) {
          console.warn('[KickSubscription] Ignoring kick from non-host:', event.pubkey.slice(0, 8));
          continue;
        }

        try {
          const content: KickEventContent = JSON.parse(event.content);
          const reason = content.reason || 'Removed by host';

          console.log('[KickSubscription] Player kicked from hunt:', reason);
          hasBeenKickedRef.current = true;
          onKicked(reason);
          return; // Stop processing after first valid kick
        } catch (err) {
          console.error('[KickSubscription] Failed to parse kick event:', err);
        }
      }
    } catch (err) {
      console.error('[KickSubscription] Error checking for kicks:', err);
    }
  }, [hunt, user, nostr, onKicked]);

  // Poll for kick events every 5 seconds
  useEffect(() => {
    if (!hunt || !user?.pubkey) return;
    if (hunt.hostPubkey === user.pubkey) return; // Host doesn't need kick subscription

    // Initial check
    checkForKicks();

    // Set up polling interval
    const pollInterval = setInterval(checkForKicks, 5000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [hunt, user, checkForKicks]);

  // Reset when hunt changes
  useEffect(() => {
    if (hunt?.id) {
      processedKicksRef.current = new Set();
      hasBeenKickedRef.current = false;
    }
  }, [hunt?.id]);
}
