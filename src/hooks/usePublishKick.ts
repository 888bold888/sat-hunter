/**
 * Hook to publish a kick event when host removes a player from a hunt
 */

import { useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';

export const PLAYER_KICK_KIND = 32965;

interface KickOptions {
  huntId: string;
  shareCode: string;
  playerPubkey: string;
  reason?: string;
}

export function usePublishKick() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const publishKick = useCallback(async ({
    huntId,
    shareCode,
    playerPubkey,
    reason,
  }: KickOptions): Promise<boolean> => {
    if (!user?.signer) {
      console.warn('[PublishKick] No user/signer available');
      return false;
    }

    try {
      const playerPubkeyShort = playerPubkey.slice(0, 8);

      const signedEvent = await user.signer.signEvent({
        kind: PLAYER_KICK_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({ reason: reason || 'Removed by host' }),
        tags: [
          ['d', `kick-${shareCode}-${playerPubkeyShort}`],
          ['e', huntId],
          ['p', playerPubkey],
          ['hunt_code', shareCode],
        ],
      });

      await nostr.event(signedEvent);
      console.log('[PublishKick] Published kick event for player', playerPubkeyShort, 'from hunt', shareCode);
      return true;
    } catch (err) {
      console.error('[PublishKick] Failed to publish kick event:', err);
      return false;
    }
  }, [nostr, user]);

  return { publishKick };
}
