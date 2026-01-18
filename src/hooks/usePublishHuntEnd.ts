import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { HuntEvent } from '@/lib/gameTypes';
import { useToast } from '@/hooks/useToast';
import { useCurrentUser } from './useCurrentUser';
import ngeohash from 'ngeohash';

const HUNT_EVENT_KIND = 32959;

/**
 * Hook for host to publish hunt end status to Nostr.
 * This publishes an updated hunt event with status='ended' so players can detect it.
 */
export function usePublishHuntEnd() {
  const { nostr } = useNostr();
  const { toast } = useToast();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (hunt: HuntEvent) => {
      if (!user?.signer) {
        throw new Error('No Nostr signer available');
      }

      // Create geohash for the hunt center
      const geohash = ngeohash.encode(hunt.geoFence.center.lat, hunt.geoFence.center.lng, 5);

      // Prepare content (same as original publish, but with ended status)
      const content = JSON.stringify({
        description: hunt.description,
        geoFence: hunt.geoFence,
        monsters: hunt.monsters.map(m => ({
          id: m.id,
          name: m.name,
          type: m.type,
          description: m.description,
          satAmount: m.satAmount,
          rarity: m.rarity,
          location: m.location,
          emoji: m.emoji,
          spawnTime: m.spawnTime,
          captured: m.captured,
          capturedBy: m.capturedBy,
          capturedAt: m.capturedAt,
        })),
        satStops: hunt.satStops,
        spawnMode: hunt.spawnMode,
        maxConcurrentMonsters: hunt.maxConcurrentMonsters,
      });

      // Sign event with status='ended'
      const signedEvent = await user.signer.signEvent({
        kind: HUNT_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content,
        tags: [
          ['d', hunt.shareCode], // Same d-tag makes this a replacement
          ['title', hunt.name],
          ['total_sats', hunt.totalSats.toString()],
          ['monster_count', hunt.monsterCount.toString()],
          ['start_time', Math.floor(hunt.startTime / 1000).toString()],
          ['end_time', Math.floor(Date.now() / 1000).toString()], // End time is now
          ['status', 'ended'], // Mark as ended
          ['payment_status', hunt.paymentStatus],
          ['g', geohash],
          ['alt', `Sat Hunter: ${hunt.name} - ENDED`],
        ],
      });

      // Publish to relays
      await nostr.event(signedEvent);

      return signedEvent;
    },
    onSuccess: () => {
      toast({
        title: 'Hunt Ended',
        description: 'Players have been notified that the hunt is over',
      });
    },
    onError: (error) => {
      console.error('Failed to publish hunt end:', error);
      // Don't show error toast - hunt still ends locally
    },
  });
}
