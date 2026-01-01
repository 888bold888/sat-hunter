import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { Monster } from '@/lib/gameTypes';
import { useCurrentUser } from './useCurrentUser';

const CLAIM_EVENT_KIND = 32960;

interface CaptureEventData {
  huntId: string;
  huntShareCode: string;
  monster: Monster;
  playerPubkey: string;
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

      // Prepare content
      const content = JSON.stringify({
        monsterId: data.monster.id,
        monsterName: data.monster.name,
        satAmount: data.monster.satAmount,
        rarity: data.monster.rarity,
        capturedAt: Date.now(),
      });

      // Sign event using user's signer (works for all login types)
      const signedEvent = await user.signer.signEvent({
        kind: CLAIM_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content,
        tags: [
          ['e', data.huntId], // Reference to hunt event
          ['d', `${data.huntShareCode}-${data.monster.id}`], // Unique identifier
          ['p', data.playerPubkey], // Player who captured
          ['monster_id', data.monster.id],
          ['sat_amount', data.monster.satAmount.toString()],
          ['hunt_code', data.huntShareCode],
        ],
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
