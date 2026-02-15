import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { Monster, GeoLocation } from '@/lib/gameTypes';
import { useCurrentUser } from './useCurrentUser';
import { encodeCoarseGeohash, computeCaptureProof } from '@/lib/antiCheat';

const CLAIM_EVENT_KIND = 32960;

interface CaptureEventData {
  huntId: string;
  huntShareCode: string;
  monster: Monster;
  playerPubkey: string;
  // Anti-cheat data
  playerLocation?: GeoLocation;
  trustScore?: number;
  trustFlags?: string[];
  // Capture proof (HMAC token from hunt secret)
  captureSecret?: string;
}

export function usePublishCapture() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  return useMutation({
    mutationFn: async (data: CaptureEventData) => {
      if (!user?.signer) {
        console.warn('No Nostr signer available for capture event');
        return null;
      }

      // Generate coarse geohash for privacy (5 chars = ~5km cell)
      const geohash = data.playerLocation
        ? encodeCoarseGeohash(data.playerLocation)
        : undefined;

      // Compute capture proof if secret is available
      const capturedAt = Date.now();
      const captureProof = data.captureSecret
        ? computeCaptureProof(data.captureSecret, data.monster.id, data.playerPubkey, capturedAt)
        : undefined;

      // Prepare content with anti-cheat data
      const content = JSON.stringify({
        monsterId: data.monster.id,
        monsterName: data.monster.name,
        satAmount: data.monster.satAmount,
        rarity: data.monster.rarity,
        capturedAt,
        // Anti-cheat fields (coarse location for privacy)
        geohash,
        trustScore: data.trustScore,
        trustFlags: data.trustFlags,
        // HMAC capture proof (proves player received hunt data via authenticated channel)
        captureProof,
      });

      // Build tags
      const tags: string[][] = [
        ['e', data.huntId], // Reference to hunt event
        ['d', `${data.huntShareCode}-${data.monster.id}`], // Unique identifier
        ['p', data.playerPubkey], // Player who captured
        ['monster_id', data.monster.id],
        ['sat_amount', data.monster.satAmount.toString()],
        ['hunt_code', data.huntShareCode],
      ];

      // Add anti-cheat tags
      if (geohash) {
        tags.push(['g', geohash]); // Standard geohash tag
      }
      if (data.trustScore !== undefined) {
        tags.push(['trust_score', data.trustScore.toString()]);
      }

      // Sign event using user's signer (works for all login types)
      const signedEvent = await user.signer.signEvent({
        kind: CLAIM_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content,
        tags,
      });

      // Publish to relays
      await nostr.event(signedEvent);

      console.log('Capture event published:', signedEvent.id);
      return signedEvent;
    },
    onError: (error) => {
      console.error('Failed to publish capture event:', error);
    },
  });
}
