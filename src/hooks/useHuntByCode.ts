import { useQuery } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { HuntEvent } from '@/lib/gameTypes';

const HUNT_EVENT_KIND = 32959;
const CLAIM_EVENT_KIND = 32960; // Assuming a custom kind for claim events

export function useHuntByCode(shareCode: string | undefined) {
  const { nostr } = useNostr();
  return useQuery({
    queryKey: ['hunt', shareCode],
    queryFn: async (c) => {
      if (!shareCode) throw new Error('No share code provided');
      const signal = AbortSignal.any([c.signal, AbortSignal.timeout(30000)]); // 30s timeout for slow relays
      
      // Query for hunt event with this share code (d tag), checking both cases
      const events = await nostr.query(
        [
          {
            kinds: [HUNT_EVENT_KIND],
            '#d': [shareCode.toUpperCase(), shareCode.toLowerCase()],
            limit: 5, // Increased limit for reliability
          },
        ],
        { signal }
      );
      if (events.length === 0) {
        throw new Error('Hunt not found');
      }
      const event = events[0]; // Take the first (latest/relevant)

      // Parse content
      const contentData = JSON.parse(event.content);

      // Extract tags
      const getTag = (name: string) => event.tags.find(([n]) => n === name)?.[1];

      // Check if this hunt uses P2P for location data (privacy mode)
      const isP2P = getTag('p2p') === 'required' || contentData.p2pRequired === true;

      // For P2P hunts, location data (geoFence, monsters, satStops) comes via P2P
      // not from the relay. We create placeholder structures that will be filled
      // when the player connects to the host via WebRTC.
      const hunt: HuntEvent = {
        id: event.id,
        name: getTag('title') || 'Unnamed Hunt',
        description: contentData.description || '',
        hostPubkey: event.pubkey,
        totalSats: parseInt(getTag('total_sats') || '0'),
        monsterCount: parseInt(getTag('monster_count') || '0'),
        // For P2P hunts, geoFence/monsters/satStops are empty until P2P transfer
        geoFence: contentData.geoFence || {
          center: { lat: 0, lng: 0 },
          bounds: { north: 0, south: 0, east: 0, west: 0 },
          radiusMeters: contentData.radiusMeters || 500,
        },
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
        spawnMode: (contentData.spawnMode as HuntEvent['spawnMode']) || 'all_at_once',
        maxConcurrentMonsters: contentData.maxConcurrentMonsters,
      };
      
      // Validate payment status before allowing join
      if (hunt.paymentStatus !== 'paid') {
        throw new Error('Hunt payment not confirmed');
      }
      
      // Query for claim events to calculate unclaimed sats (for refund prep)
      const claimEvents = await nostr.query(
        [
          {
            kinds: [CLAIM_EVENT_KIND],
            '#e': [hunt.id], // Reference the hunt event
            limit: hunt.monsters.length,
          },
        ],
        { signal }
      );
      const claimedMonsters = claimEvents.map(ev => {
        try {
          return JSON.parse(ev.content).monsterId;
        } catch {
          return null;
        }
      }).filter(id => id !== null);
      
      const unclaimedSats = hunt.monsters
        .filter(m => !claimedMonsters.includes(m.id))
        .reduce((sum, m) => sum + (m.satAmount || 0), 0);
      
      // Add preview and unclaimed data to returned object
      return {
        ...hunt,
        unclaimedSats,
        claimedMonsters,
        // Flag indicating location data needs to be fetched via P2P
        requiresP2P: isP2P,
        preview: {
          name: hunt.name,
          sats: hunt.totalSats,
          creatures: hunt.monsterCount, // Use tag value, not array length (empty for P2P)
          time: ((hunt.endTime - hunt.startTime) / 1000 / 60).toFixed(0) + ' minutes', // Simple duration
        }
      };
    },
    enabled: !!shareCode && shareCode.length >= 6,
    retry: (failureCount, error) => {
      // Retry "Hunt not found" up to 5 times (for relay propagation delays)
      // Retry other errors up to 2 times
      if (error.message === 'Hunt not found') {
        return failureCount < 5;
      }
      return failureCount < 2;
    },
    retryDelay: (attemptIndex) => Math.min(2000 * 2 ** attemptIndex, 10000), // Exponential backoff: 2s, 4s, 8s, 10s, 10s
    staleTime: 10000, // 10 seconds - shorter to refresh failed queries sooner
    gcTime: 10000, // Clear failed queries after 10 seconds so refetch works properly
  });
}