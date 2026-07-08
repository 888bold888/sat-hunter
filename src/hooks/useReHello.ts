/**
 * Refresh-recovery re-hello (Phase 3, tasks/goals/shared-creature-state.md)
 *
 * A non-host, non-demo player who refreshes mid-hunt lands on /play with a
 * persisted hunt that lost its in-memory-only secrets: captureSecret and
 * hostBroadcastPubkey are both stripped before persistence (GameContext), so
 * Tier 2 (useCaptureStateSync) is dead until we re-hello the host.
 *
 * On mount, if the active hunt is active, we're a player, and hostBroadcastPubkey
 * is missing, run the hunt connection ONCE (P2P → relay fallback) to re-fetch the
 * hello, then merge captureSecret + hostBroadcastPubkey back into the current hunt
 * and apply any captureState snapshot it carried. Failure is non-fatal — Tier 1
 * still hides ghosts. Guarded by a ref keyed on hunt id so we attempt only once.
 */

import { useEffect, useRef } from 'react';
import { useGame } from '@/contexts/GameContext';
import { useCurrentUser } from './useCurrentUser';
import { useHuntConnection } from './useHuntConnection';

export function useReHello() {
  const { state, isHost, mergeHuntSecrets, applyCaptureState } = useGame();
  const { user } = useCurrentUser();
  const { connect } = useHuntConnection();

  const { activeHunt } = state;
  const userIsHost = isHost();

  // Which hunt id we've already attempted a re-hello for (one attempt per hunt).
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeHunt || activeHunt.isDemo) return;
    if (userIsHost) return;
    if (activeHunt.status !== 'active') return;
    // Already have the broadcast key (fresh join, not a refresh) — nothing to do.
    if (activeHunt.hostBroadcastPubkey) return;
    if (!user?.pubkey) return;
    if (attemptedRef.current === activeHunt.id) return;

    attemptedRef.current = activeHunt.id;

    const huntId = activeHunt.id;
    const shareCode = activeHunt.shareCode;
    const hostPubkey = activeHunt.hostPubkey;
    const myPubkey = user.pubkey;

    (async () => {
      try {
        const data = await connect(huntId, shareCode, hostPubkey);
        if (!data) return; // non-fatal: Tier 1 still covers this player

        // Merge secrets into the CURRENT hunt (reducer reads freshest state).
        mergeHuntSecrets(huntId, {
          captureSecret: data.captureSecret,
          hostBroadcastPubkey: data.hostBroadcastPubkey,
        });

        // Reconcile immediately from the snapshot the hello carried.
        if (data.captureState && data.captureState.entries.length > 0) {
          applyCaptureState(data.captureState.entries, myPubkey);
        }
      } catch {
        // Non-fatal — leave Tier 1 in place; next refresh may re-hello again.
      }
    })();
  }, [activeHunt, userIsHost, user?.pubkey, connect, mergeHuntSecrets, applyCaptureState]);
}
