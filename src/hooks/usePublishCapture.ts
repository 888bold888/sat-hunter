import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { Monster } from '@/lib/gameTypes';

// NIP-07 window.nostr type declaration
declare global {
  interface Window {
    nostr?: {
      getPublicKey: () => Promise<string>;
      signEvent: (event: object) => Promise<NostrEvent>;
    };
  }
}

const CLAIM_EVENT_KIND = 32960;

interface CaptureEventData {
  huntId: string;
  huntShareCode: string;
  monster: Monster;
  playerPubkey: string;
}

export function usePublishCapture() {
  const { nostr } = useNostr();

  return useMutation({
    mutationFn: async (data: CaptureEventData) => {
      // Check for NIP-07 signer
      if (!window.nostr?.signEvent) {
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

      // Create unsigned event template
      const eventTemplate = {
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
      };

      // Sign event using NIP-07
      const signedEvent = await window.nostr.signEvent(eventTemplate) as NostrEvent;

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
