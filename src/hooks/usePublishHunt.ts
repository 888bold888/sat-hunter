import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { HuntEvent } from '@/lib/gameTypes';
import { useToast } from '@/hooks/useToast';
import { useCurrentUser } from './useCurrentUser';
import ngeohash from 'ngeohash';

const HUNT_EVENT_KIND = 32959;

export function usePublishHunt() {
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (hunt: HuntEvent) => {
      if (!user?.signer) {
        throw new Error('No Nostr signer available. Please log in first.');
      }

      // Create geohash for the hunt center (coarse, ~5km precision for discoverability)
      const geohash = ngeohash.encode(hunt.geoFence.center.lat, hunt.geoFence.center.lng, 5);

      // PRIVACY: Only publish metadata to relay, NO location data
      // Location data (geoFence, monsters, satStops) is transferred via P2P
      // when players join, keeping it completely off Nostr relays
      const content = JSON.stringify({
        description: hunt.description,
        // P2P flag indicates players must connect to host for location data
        p2pRequired: true,
        // Include radius for display purposes (no exact coordinates)
        radiusMeters: hunt.geoFence.radiusMeters,
      });

      // Sign event using user's signer (works for all login types)
      const signedEvent = await user.signer.signEvent({
        kind: HUNT_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content,
        tags: [
          ['d', hunt.shareCode],
          ['title', hunt.name],
          ['total_sats', hunt.totalSats.toString()],
          ['monster_count', hunt.monsterCount.toString()],
          ['start_time', Math.floor(hunt.startTime / 1000).toString()],
          ['end_time', Math.floor(hunt.endTime / 1000).toString()],
          ['status', hunt.status],
          ['payment_status', hunt.paymentStatus],
          ['g', geohash],
          ['p2p', 'required'], // Location data served via P2P, not on relay
          ['alt', `Sat Hunter: ${hunt.name} - ${hunt.monsterCount} creatures, ${hunt.totalSats.toLocaleString()} sats`],
          ...(hunt.lightningInvoice ? [['bolt11', hunt.lightningInvoice]] : []),
          ...(hunt.paymentHash ? [['payment_hash', hunt.paymentHash]] : []),
        ],
      });

      // Publish to relays
      await nostr.event(signedEvent);

      return signedEvent;
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
