import { useEffect, useCallback, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import type { HuntEvent } from '@/lib/gameTypes';
import { useCurrentUser } from './useCurrentUser';

const HUNT_EVENT_KIND = 32959;
const CLAIM_EVENT_KIND = 32960;
const JOIN_EVENT_KIND = 32961;

// Anti-cheat data included in capture events
interface CaptureAntiCheatData {
  trustScore?: number;
  trustFlags?: string[];
  geohash?: string;
}

interface HuntSyncCallbacks {
  onMonsterCaptured: (
    monsterId: string,
    playerPubkey: string,
    satAmount: number,
    antiCheat?: CaptureAntiCheatData
  ) => void;
  onPlayerJoined: (playerPubkey: string) => void;
  onHuntEnded?: () => void;
}

interface ClaimEventContent {
  monsterId: string;
  monsterName: string;
  satAmount: number;
  rarity: string;
  capturedAt: number;
  // Anti-cheat fields
  trustScore?: number;
  trustFlags?: string[];
  geohash?: string;
}

export function useHuntSync(
  hunt: HuntEvent | null,
  callbacks: HuntSyncCallbacks
) {
  const { nostr } = useNostr();
  const processedEventsRef = useRef<Set<string>>(new Set());
  const isPollingRef = useRef(false);

  const fetchCaptureEvents = useCallback(async () => {
    if (!hunt || isPollingRef.current) return;

    isPollingRef.current = true;

    try {
      // Query for capture events for this hunt
      const events = await nostr.query(
        [
          {
            kinds: [CLAIM_EVENT_KIND],
            '#e': [hunt.id],
            since: Math.floor((hunt.startTime || Date.now() - 3600000) / 1000), // Since hunt start
          },
        ],
        { signal: AbortSignal.timeout(10000) }
      );

      // Process new events
      for (const event of events) {
        if (processedEventsRef.current.has(event.id)) continue;
        processedEventsRef.current.add(event.id);

        try {
          const content: ClaimEventContent = JSON.parse(event.content);
          const playerPubkey = event.pubkey;

          // Extract anti-cheat data from capture event
          const antiCheat: CaptureAntiCheatData | undefined =
            content.trustScore !== undefined
              ? {
                  trustScore: content.trustScore,
                  trustFlags: content.trustFlags,
                  geohash: content.geohash,
                }
              : undefined;

          callbacks.onMonsterCaptured(
            content.monsterId,
            playerPubkey,
            content.satAmount,
            antiCheat
          );
        } catch (err) {
          console.error('Failed to parse capture event:', err);
        }
      }

      // Also query for join events
      const joinEvents = await nostr.query(
        [
          {
            kinds: [JOIN_EVENT_KIND],
            '#e': [hunt.id],
            since: Math.floor((hunt.startTime || Date.now() - 3600000) / 1000),
          },
        ],
        { signal: AbortSignal.timeout(10000) }
      );

      for (const event of joinEvents) {
        if (processedEventsRef.current.has(event.id)) continue;
        processedEventsRef.current.add(event.id);
        callbacks.onPlayerJoined(event.pubkey);
      }

      // Check for hunt status updates (host may have ended the hunt)
      if (callbacks.onHuntEnded) {
        const huntEvents = await nostr.query(
          [
            {
              kinds: [HUNT_EVENT_KIND],
              '#d': [hunt.shareCode],
              limit: 1,
            },
          ],
          { signal: AbortSignal.timeout(10000) }
        );

        if (huntEvents.length > 0) {
          const latestHuntEvent = huntEvents[0];
          const statusTag = latestHuntEvent.tags.find(([t]) => t === 'status');
          if (statusTag && statusTag[1] === 'ended') {
            callbacks.onHuntEnded();
          }
        }
      }
    } catch (err) {
      console.error('Hunt sync error:', err);
    } finally {
      isPollingRef.current = false;
    }
  }, [hunt, nostr, callbacks]);

  // Poll for updates every 5 seconds
  useEffect(() => {
    if (!hunt) return;

    // Initial fetch
    fetchCaptureEvents();

    // Set up polling interval
    const pollInterval = setInterval(fetchCaptureEvents, 5000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [hunt, fetchCaptureEvents]);

  // Reset processed events when hunt changes
  useEffect(() => {
    if (hunt?.id) {
      processedEventsRef.current = new Set();
    }
  }, [hunt?.id]);

  return {
    refresh: fetchCaptureEvents,
  };
}

// Hook for players to publish join event
export function usePublishJoin() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const publishJoin = useCallback(async (huntId: string, huntShareCode: string) => {
    if (!user?.signer) {
      console.warn('No Nostr signer available for join event');
      return null;
    }

    try {
      const signedEvent = await user.signer.signEvent({
        kind: JOIN_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({ joinedAt: Date.now() }),
        tags: [
          ['e', huntId],
          ['d', `${huntShareCode}-join`],
          ['hunt_code', huntShareCode],
        ],
      });

      await nostr.event(signedEvent);
      console.log('Join event published:', signedEvent.id);
      return signedEvent;
    } catch (err) {
      console.error('Failed to publish join event:', err);
      return null;
    }
  }, [nostr, user]);

  return { publishJoin };
}
