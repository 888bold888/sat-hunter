import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import type { HuntEvent } from '@/lib/gameTypes';

const HUNT_EVENT_KIND = 32959;

interface MyHunt {
  id: string;
  shareCode: string;
  name: string;
  description: string;
  totalSats: number;
  monsterCount: number;
  startTime: number;
  endTime: number;
  status: HuntEvent['status'];
  paymentStatus: HuntEvent['paymentStatus'];
  isActive: boolean;
  // Full hunt data for recovery
  fullHunt: HuntEvent;
}

/**
 * Hook to query Nostr for hunts created by the current user.
 * Allows hosts to find and recover their active hunts.
 */
export function useMyHunts() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useQuery({
    queryKey: ['my-hunts', user?.pubkey],
    queryFn: async (c) => {
      if (!user?.pubkey) return [];

      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(15000)]);

      // Query for hunt events authored by current user
      const events = await nostr.query(
        [
          {
            kinds: [HUNT_EVENT_KIND],
            authors: [user.pubkey],
            limit: 20, // Get recent hunts
          },
        ],
        { signal }
      );

      if (events.length === 0) return [];

      const now = Date.now();
      const hunts: MyHunt[] = [];

      for (const event of events) {
        try {
          const contentData = JSON.parse(event.content);
          const getTag = (name: string) => event.tags.find(([n]) => n === name)?.[1];

          const startTime = parseInt(getTag('start_time') || '0') * 1000;
          const endTime = parseInt(getTag('end_time') || '0') * 1000;
          const status = (getTag('status') as HuntEvent['status']) || 'active';
          const paymentStatus = (getTag('payment_status') as HuntEvent['paymentStatus']) || 'pending';

          // Build the full hunt object for recovery
          const fullHunt: HuntEvent = {
            id: event.id,
            name: getTag('title') || 'Unnamed Hunt',
            description: contentData.description || '',
            hostPubkey: event.pubkey,
            totalSats: parseInt(getTag('total_sats') || '0'),
            monsterCount: parseInt(getTag('monster_count') || '0'),
            geoFence: contentData.geoFence,
            startTime,
            endTime,
            createdAt: event.created_at * 1000,
            monsters: contentData.monsters || [],
            satStops: contentData.satStops || [],
            status,
            paymentStatus,
            lightningInvoice: getTag('bolt11'),
            paymentHash: getTag('payment_hash'),
            shareCode: getTag('d') || '',
            shareUrl: `${window.location.origin}/join/${getTag('d') || ''}`,
            participants: [],
            spawnMode: contentData.spawnMode || 'all_at_once',
            maxConcurrentMonsters: contentData.maxConcurrentMonsters,
          };

          const isActive = status !== 'ended' && endTime > now && paymentStatus === 'paid';

          hunts.push({
            id: event.id,
            shareCode: getTag('d') || '',
            name: getTag('title') || 'Unnamed Hunt',
            description: contentData.description || '',
            totalSats: parseInt(getTag('total_sats') || '0'),
            monsterCount: parseInt(getTag('monster_count') || '0'),
            startTime,
            endTime,
            status,
            paymentStatus,
            isActive,
            fullHunt,
          });
        } catch (err) {
          console.error('Failed to parse hunt event:', err);
        }
      }

      // Sort by most recent first, active hunts at top
      hunts.sort((a, b) => {
        // Active hunts first
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        // Then by start time (most recent first)
        return b.startTime - a.startTime;
      });

      return hunts;
    },
    enabled: !!user?.pubkey,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
}
