import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { HuntEvent } from '@/lib/gameTypes';

const HUNT_EVENT_KIND = 32959;

export function useHuntByCode(shareCode: string | undefined) {
  const { nostr } = useNostr();

  return useQuery({
    queryKey: ['hunt', shareCode],
    queryFn: async (c) => {
      if (!shareCode) throw new Error('No share code provided');

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(3000)]);
      
      // Query for hunt event with this share code (d tag)
      const events = await nostr.query(
        [
          {
            kinds: [HUNT_EVENT_KIND],
            '#d': [shareCode.toUpperCase()],
            limit: 1,
          },
        ],
        { signal }
      );

      if (events.length === 0) {
        throw new Error('Hunt not found');
      }

      const event = events[0];

      // Parse content
      const contentData = JSON.parse(event.content);

      // Extract tags
      const getTag = (name: string) => event.tags.find(([n]) => n === name)?.[1];

      const hunt: HuntEvent = {
        id: event.id,
        name: getTag('title') || 'Unnamed Hunt',
        description: contentData.description || '',
        hostPubkey: event.pubkey,
        totalSats: parseInt(getTag('total_sats') || '0'),
        monsterCount: parseInt(getTag('monster_count') || '0'),
        geoFence: contentData.geoFence,
        startTime: parseInt(getTag('start_time') || '0') * 1000,
        endTime: parseInt(getTag('end_time') || '0') * 1000,
        createdAt: event.created_at * 1000,
        monsters: contentData.monsters || [],
        satStops: contentData.satStops || [],
        status: getTag('status') as HuntEvent['status'] || 'active',
        paymentStatus: getTag('payment_status') as HuntEvent['paymentStatus'] || 'pending',
        lightningInvoice: getTag('bolt11'),
        paymentHash: getTag('payment_hash'),
        shareCode: getTag('d') || shareCode.toUpperCase(),
        shareUrl: `${window.location.origin}/join/${getTag('d') || shareCode}`,
        participants: [],
      };

      return hunt;
    },
    enabled: !!shareCode && shareCode.length >= 6,
    retry: 2,
    staleTime: 30000, // 30 seconds
  });
}
