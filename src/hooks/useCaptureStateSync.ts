/**
 * Player-side Tier 2 capture-state sync (tasks/goals/shared-creature-state.md)
 *
 * Subscribes to the host's authoritative captured-state broadcasts over the
 * ephemeral relay, verifies + decrypts them, and dispatches the result to
 * GameContext (terminal captures + loser rollback). Stateless self-healing: any
 * broadcast fully reconciles a player who slept through earlier ones.
 *
 * Dead in demo mode and for hosts (both pass null). Requires the hunt to carry a
 * hostBroadcastPubkey (learned in the encrypted hello) before doing anything.
 */

import { useEffect, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useCurrentUser } from './useCurrentUser';
import { useGame } from '@/contexts/GameContext';
import type { HuntEvent } from '@/lib/gameTypes';
import { deriveCastKeypair, decryptCaptureStateEvent } from '@/lib/captureBroadcast';
import { ZERO_TRUST_OUTER_KIND } from '@/lib/zeroTrustRelay';

export function useCaptureStateSync(hunt: HuntEvent | null) {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { applyCaptureState } = useGame();

  // Monotonic guard: ignore any broadcast not newer than the last one applied.
  // Full-state is idempotent, so out-of-order replays are harmless regardless.
  const lastStateVersionRef = useRef(0);

  const hostBroadcastPubkey = hunt?.hostBroadcastPubkey;
  const shareCode = hunt?.shareCode;
  const myPubkey = user?.pubkey;

  useEffect(() => {
    // Only non-host, non-demo, active hunts that announced a broadcast pubkey.
    if (!nostr || !hunt || hunt.isDemo || !hostBroadcastPubkey || !shareCode || !myPubkey) return;

    let isSubscribed = true;
    const processed = new Set<string>();
    // The cast channel address is shareCode-derived (every participant computes
    // it); authenticity is enforced separately via decryptCaptureStateEvent.
    const cast = deriveCastKeypair(shareCode);

    const subscription = nostr.req([
      {
        kinds: [ZERO_TRUST_OUTER_KIND],
        '#p': [cast.pubkey],
        since: Math.floor(Date.now() / 1000) - 300,
      },
    ]);

    (async () => {
      try {
        for await (const msg of subscription) {
          if (!isSubscribed) break;
          if (msg[0] !== 'EVENT') continue;

          const event = msg[2];
          if (processed.has(event.id)) continue;
          processed.add(event.id);

          // verifyEvent + host-pubkey match + freshness window all happen inside.
          const payload = decryptCaptureStateEvent(cast.privkey, event, hostBroadcastPubkey);
          if (!payload) continue;
          if (payload.stateVersion <= lastStateVersionRef.current) continue;

          lastStateVersionRef.current = payload.stateVersion;
          applyCaptureState(payload.entries, myPubkey);
        }
      } catch (err) {
        if (isSubscribed) {
          console.error('[CaptureStateSync] Subscription error:', err);
        }
      }
    })();

    return () => {
      isSubscribed = false;
      cast.privkey.fill(0);
    };
  }, [nostr, hunt, hostBroadcastPubkey, shareCode, myPubkey, applyCaptureState]);

  // Reset the version guard when switching hunts.
  useEffect(() => {
    lastStateVersionRef.current = 0;
  }, [hunt?.id]);
}
