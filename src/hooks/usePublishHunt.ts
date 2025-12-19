import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { HuntEvent } from '@/lib/gameTypes';
import { useToast } from '@/hooks/useToast';
import ngeohash from 'ngeohash';

const HUNT_EVENT_KIND = 32959;

export function usePublishHunt() {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (hunt: HuntEvent) => {
      // Create geohash for the hunt center
      const geohash = ngeohash.encode(hunt.geoFence.center.lat, hunt.geoFence.center.lng, 5);

      // Prepare content (large data that doesn't need to be queried)
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
        })),
        satStops: hunt.satStops,
      });

      // Create event with queryable tags
      const event = await nostr.event({
        kind: HUNT_EVENT_KIND,
        content,
        tags: [
          ['d', hunt.shareCode], // Addressable identifier
          ['title', hunt.name],
          ['total_sats', hunt.totalSats.toString()],
          ['monster_count', hunt.monsterCount.toString()],
          ['start_time', Math.floor(hunt.startTime / 1000).toString()],
          ['end_time', Math.floor(hunt.endTime / 1000).toString()],
          ['status', hunt.status],
          ['payment_status', hunt.paymentStatus],
          ['g', geohash], // Geohash for discovery
          ['alt', `Sat Hunter: ${hunt.name} - ${hunt.monsterCount} creatures, ${hunt.totalSats.toLocaleString()} sats`],
          ...(hunt.lightningInvoice ? [['bolt11', hunt.lightningInvoice]] : []),
          ...(hunt.paymentHash ? [['payment_hash', hunt.paymentHash]] : []),
        ],
      });

      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hunts'] });
      toast({
        title: 'Hunt Published! 🎯',
        description: 'Your hunt is now live on Nostr',
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to publish hunt',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });
}
