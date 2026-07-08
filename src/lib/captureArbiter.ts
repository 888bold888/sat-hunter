/**
 * captureArbiter — synchronous, first-valid-claim-wins arbitration of monster
 * capture claims on the host (Phase 4, tasks/goals/shared-creature-state.md).
 *
 * Why this exists: the host polls capture events in batches and, before Phase 4,
 * every guard (paidCaptures / payingCaptures / pendingCaptures / rejectedCaptures)
 * was read through a React state closure. State setters queue and DO NOT update
 * the closure within a batch, so two claims for the SAME monster in one poll
 * batch (or arriving before a re-render) could both pass every guard — paying the
 * player twice — and, separately, the last-written syncedCaptures entry (even a
 * rejected one) could become the broadcast winner while a DIFFERENT claim got the
 * payment (goal file items 4 and 6).
 *
 * The fix: hold the in-batch lock in a plain Map/Set that is mutated
 * SYNCHRONOUSLY at the decision point — before any await or setState. Exactly one
 * claim per monster is ever paid, and that same claim is the one recorded as the
 * winner in capture_state. Host processing order is the authority (first VALID
 * claim wins), matching the goal file "Conflict resolution" section.
 *
 * The persisted localStorage records (paidCaptures / rejectedCaptures) remain the
 * durable source of truth across refreshes; this state is ONLY the in-batch
 * synchronous lock and is seeded from those records on mount / hunt change so a
 * host refresh never re-pays and never un-poisons.
 */

export interface CaptureClaim {
  monsterId: string;
  playerPubkey: string;
}

/**
 * - 'pay'    → caller runs payment for this claim's player; the monster is now
 *              locked synchronously so no later claim in the same batch can win it.
 * - 'reject' → a reject-validation (rate limit / distance / trust score) failed;
 *              caller records rejectedCaptures[monsterId] = reason. The monster is
 *              poisoned (see note) — no winner, no payment.
 * - 'ignore' → the monster is already locked (in payment / paid) or already
 *              poisoned; do nothing.
 */
export type CaptureDecision =
  | { action: 'pay' }
  | { action: 'reject'; reason: string }
  | { action: 'ignore' };

export interface ArbiterState {
  // monsterId → winner pubkey. Presence means locked (payment in flight or paid).
  // Seeded from persisted paidCaptures with PAID_SENTINEL (the durable record
  // stores no winner), which is fine because paid monsters are never released.
  locked: Map<string, string>;
  // monsterId set. Presence means poisoned by a failed reject-validation.
  // Pre-existing design (preserved): one bad claim poisons the monster for the
  // rest of the hunt — a monster rejected then validly claimed stays rejected.
  poisoned: Set<string>;
}

// Placeholder winner for monsters loaded from the persisted paidCaptures record,
// which stores monster ids only. Paid monsters are never released, so the exact
// winner value is irrelevant to the lock's job of preventing a re-pay.
export const PAID_SENTINEL = '__paid__';

export function createArbiterState(
  paidMonsterIds: Iterable<string>,
  rejectedMonsterIds: Iterable<string>
): ArbiterState {
  const locked = new Map<string, string>();
  for (const id of paidMonsterIds) locked.set(id, PAID_SENTINEL);
  return { locked, poisoned: new Set(rejectedMonsterIds) };
}

/**
 * Decide the fate of a claim and SYNCHRONOUSLY mutate `state` to reflect it.
 * MUST be called at the decision point BEFORE any await or setState so the lock
 * is visible to the very next claim in the same batch.
 *
 * `validate` runs the reject-validations (rate limit, distance, trust score) and
 * returns a rejection reason, or null if the claim is valid. It runs BEFORE the
 * lock is taken, so an INVALID claim never takes the lock — the lock is never the
 * thing that blocks a later valid claim from another player. (Poisoning still
 * applies separately; see ArbiterState.poisoned.)
 */
export function arbitrateCapture(
  state: ArbiterState,
  claim: CaptureClaim,
  validate: () => string | null
): CaptureDecision {
  const { monsterId, playerPubkey } = claim;

  // Already won / in payment / paid, or poisoned by an earlier bad claim.
  if (state.locked.has(monsterId)) return { action: 'ignore' };
  if (state.poisoned.has(monsterId)) return { action: 'ignore' };

  // Reject-validations run before the lock so an invalid claim never locks the
  // monster; a failure poisons it (pre-existing behavior, now synchronous).
  const reason = validate();
  if (reason) {
    state.poisoned.add(monsterId);
    return { action: 'reject', reason };
  }

  // First valid claim wins. Lock synchronously, before any await / setState.
  state.locked.set(monsterId, playerPubkey);
  return { action: 'pay' };
}

/**
 * Release a claim after a payment FAILURE (result.success false and NOT pending)
 * so a later valid claim can retry — mirrors the existing payingCaptures delete.
 * Payment success and pending both KEEP the lock (permanently locked / in flight).
 * Guarded on the winner so a stale release can't clobber another player's lock.
 */
export function releaseCaptureClaim(
  state: ArbiterState,
  monsterId: string,
  playerPubkey: string
): void {
  if (state.locked.get(monsterId) === playerPubkey) {
    state.locked.delete(monsterId);
  }
}
