import { useEffect, useCallback, useRef, useMemo } from 'react';
import { useNostr } from '@nostrify/react';
import { verifyEvent } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { NostrSigner } from '@nostrify/nostrify';
import type { HuntEvent } from '@/lib/gameTypes';
import { useCurrentUser } from './useCurrentUser';

const HUNT_EVENT_KIND = 32959;
const CLAIM_EVENT_KIND = 32960;
const JOIN_EVENT_KIND = 32961;
const PLAYER_LEAVE_KIND = 32964;
const MAX_EVENT_AGE_SECONDS = 7200; // Reject events older than 2 hours (covers full hunt duration)

// Anti-cheat data included in capture events
interface CaptureAntiCheatData {
  trustScore?: number;
  trustFlags?: string[];
  geohash?: string;
  captureProof?: string;
}

interface HuntSyncCallbacks {
  onMonsterCaptured: (
    monsterId: string,
    playerPubkey: string,
    satAmount: number,
    capturedAt: number,
    antiCheat?: CaptureAntiCheatData
  ) => void;
  onPlayerJoined: (playerPubkey: string) => void;
  onPlayerLeft?: (playerPubkey: string) => void;
  onHuntEnded?: () => void;
  // Tier 1 optimistic claim signal for players: fired with the public 'd' dedup
  // tag of every signature-verified, timestamp-valid capture event — players
  // can't decrypt the content, but the tag identifies the claimed monster
  // (see src/lib/captureSync.ts). Forgeable by shareCode holders: display-only.
  onCaptureClaimTag?: (dedupHash: string) => void;
}

interface ClaimEventContent {
  playerPubkey?: string;
  monsterId: string;
  monsterName: string;
  satAmount: number;
  rarity: string;
  capturedAt: number;
  // Anti-cheat fields
  trustScore?: number;
  trustFlags?: string[];
  geohash?: string;
  // HMAC capture proof
  captureProof?: string;
}

export function useHuntSync(
  hunt: HuntEvent | null,
  callbacks: HuntSyncCallbacks,
  hostSigner?: NostrSigner
) {
  const { nostr } = useNostr();
  const processedEventsRef = useRef<Set<string>>(new Set());
  const isPollingRef = useRef(false);

  // Blinded hunt reference: SHA256(shareCode) — only host/players can compute
  const huntBlind = useMemo(
    () => hunt ? bytesToHex(sha256(new TextEncoder().encode(hunt.shareCode))) : null,
    [hunt]
  );

  const fetchCaptureEvents = useCallback(async () => {
    if (!hunt || !huntBlind || isPollingRef.current) return;

    isPollingRef.current = true;

    try {
      // Query capture events by blinded hunt tag (no hunt ID exposed)
      // Also query by legacy '#e' tag for backwards compat with unencrypted events
      const events = await nostr.query(
        [
          {
            kinds: [CLAIM_EVENT_KIND],
            '#x': [huntBlind],
            since: Math.floor((hunt.startTime || Date.now() - 3600000) / 1000),
          },
          {
            kinds: [CLAIM_EVENT_KIND],
            '#e': [hunt.id],
            since: Math.floor((hunt.startTime || Date.now() - 3600000) / 1000),
          },
        ],
        { signal: AbortSignal.timeout(10000) }
      );

      // Process new events
      for (const event of events) {
        if (processedEventsRef.current.has(event.id)) continue;
        processedEventsRef.current.add(event.id);

        // Verify cryptographic signature to prevent forged capture events
        if (!verifyEvent(event)) {
          console.warn('Rejecting capture event with invalid signature:', event.id);
          continue;
        }

        // Reject stale or backdated events to prevent replay attacks
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - event.created_at) > MAX_EVENT_AGE_SECONDS) {
          console.warn('Rejecting capture event with stale timestamp:', event.id, event.created_at);
          continue;
        }

        // Tag-based claim signal (players): runs before the decrypt attempt
        // because players can never decrypt host-addressed capture content.
        if (callbacks.onCaptureClaimTag) {
          const dTag = event.tags.find(([t]) => t === 'd')?.[1];
          if (dTag) callbacks.onCaptureClaimTag(dTag);
        }

        try {
          // Try to decrypt content if host signer is available (encrypted capture events)
          let contentStr = event.content;
          let decrypted = false;
          if (hostSigner?.nip44) {
            try {
              contentStr = await hostSigner.nip44.decrypt(event.pubkey, event.content);
              decrypted = true;
            } catch {
              // Fallback: try parsing as plain JSON (backwards compat with unencrypted events)
            }
          }

          // Skip encrypted events we can't decrypt (e.g. player seeing their own capture)
          if (!decrypted && !contentStr.startsWith('{')) {
            continue;
          }

          const content: ClaimEventContent = JSON.parse(contentStr);
          // Use playerPubkey from decrypted content (encrypted events use session keys)
          // Fall back to event.pubkey for backwards compat with unencrypted events
          const playerPubkey = content.playerPubkey || event.pubkey;

          // Extract anti-cheat data from capture event
          const antiCheat: CaptureAntiCheatData | undefined =
            (content.trustScore !== undefined || content.captureProof)
              ? {
                  trustScore: content.trustScore,
                  trustFlags: content.trustFlags,
                  geohash: content.geohash,
                  captureProof: content.captureProof,
                }
              : undefined;

          callbacks.onMonsterCaptured(
            content.monsterId,
            playerPubkey,
            content.satAmount,
            content.capturedAt,
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
        if (!verifyEvent(event)) {
          console.warn('Rejecting join event with invalid signature:', event.id);
          continue;
        }
        callbacks.onPlayerJoined(event.pubkey);
      }

      // Query for leave events
      if (callbacks.onPlayerLeft) {
        const leaveEvents = await nostr.query(
          [
            {
              kinds: [PLAYER_LEAVE_KIND],
              '#e': [hunt.id],
              since: Math.floor((hunt.startTime || Date.now() - 3600000) / 1000),
            },
          ],
          { signal: AbortSignal.timeout(10000) }
        );

        for (const event of leaveEvents) {
          if (processedEventsRef.current.has(event.id)) continue;
          processedEventsRef.current.add(event.id);
          if (!verifyEvent(event)) {
            console.warn('Rejecting leave event with invalid signature:', event.id);
            continue;
          }
          callbacks.onPlayerLeft(event.pubkey);
        }
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
  }, [hunt, huntBlind, nostr, callbacks, hostSigner]);

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
