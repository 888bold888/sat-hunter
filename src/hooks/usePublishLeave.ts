/**
 * Hook to publish a leave event when player exits a hunt
 */

import { useCallback } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';

const PLAYER_LEAVE_KIND = 32964;

export function usePublishLeave() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();

  const publishLeave = useCallback(async (
    huntId: string,
    shareCode: string,
    hostPubkey: string
  ): Promise<boolean> => {
    if (!user?.signer) {
      console.warn('[PublishLeave] No user/signer available');
      return false;
    }

    try {
      const playerPubkeyShort = user.pubkey.slice(0, 8);

      const signedEvent = await user.signer.signEvent({
        kind: PLAYER_LEAVE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        content: JSON.stringify({}),
        tags: [
          ['d', `leave-${shareCode}-${playerPubkeyShort}`],
          ['e', huntId],
          ['p', hostPubkey],
          ['hunt_code', shareCode],
        ],
      });

      await nostr.event(signedEvent);
      console.log('[PublishLeave] Published leave event for hunt', shareCode);
      return true;
    } catch (err) {
      console.error('[PublishLeave] Failed to publish leave event:', err);
      return false;
    }
  }, [nostr, user]);

  return { publishLeave };
}

export { PLAYER_LEAVE_KIND };
