// @vitest-environment node
// Pure logic + crypto (computeWinnerProof uses @noble/hashes) — node env because
// jsdom's Uint8Array breaks @noble/hashes.
//
// Phase 4 race hardening (tasks/goals/shared-creature-state.md): proves the
// double-payment and winner-inconsistency failure cases the goal calls out.
import { describe, it, expect } from 'vitest';
import {
  createArbiterState,
  arbitrateCapture,
  releaseCaptureClaim,
  PAID_SENTINEL,
} from '@/lib/captureArbiter';
import { computeWinnerProof } from '@/lib/captureBroadcast';

// ---------------------------------------------------------------------------
// Integrated harness: mirrors HostDashboard's decision core WITHOUT React so we
// can process claims synchronously back-to-back (no re-render between), which is
// exactly the batch scenario the ref-based lock must survive. The lock is taken
// synchronously inside arbitrateCapture BEFORE the (here simulated) payment, just
// like the real code takes it before the payPlayer await.
// ---------------------------------------------------------------------------
type PayResult = { success?: boolean; pending?: boolean };

function makeHarness(opts?: { paid?: string[]; rejected?: string[] }) {
  const state = createArbiterState(opts?.paid ?? [], opts?.rejected ?? []);
  // syncedCaptures analog: monsterId -> the winner we would broadcast / pay.
  const winners = new Map<string, string>();
  const payments: { monsterId: string; player: string }[] = [];
  const rejected = new Map<string, string>();

  function claim(
    monsterId: string,
    playerPubkey: string,
    validate: () => string | null = () => null,
    pay: () => PayResult = () => ({ success: true })
  ) {
    const decision = arbitrateCapture(state, { monsterId, playerPubkey }, validate);
    if (decision.action === 'ignore') return decision;
    if (decision.action === 'reject') {
      rejected.set(monsterId, decision.reason);
      return decision;
    }
    // 'pay': record the winner first-write-wins (mirrors setSyncedCaptures).
    if (!winners.has(monsterId)) winners.set(monsterId, playerPubkey);
    const result = pay();
    if (result.success || result.pending) {
      payments.push({ monsterId, player: playerPubkey });
    } else {
      // Failure: release the lock and roll back the winner (mirrors processPayment).
      releaseCaptureClaim(state, monsterId, playerPubkey);
      if (winners.get(monsterId) === playerPubkey) winners.delete(monsterId);
    }
    return decision;
  }

  return { state, winners, payments, rejected, claim };
}

// Assert the broadcast winnerProof for a monster corresponds to the paid player.
function winnerProofMatchesPayment(
  monsterId: string,
  winners: Map<string, string>,
  payments: { monsterId: string; player: string }[]
) {
  const pay = payments.filter(p => p.monsterId === monsterId);
  expect(pay).toHaveLength(1);
  const winner = winners.get(monsterId);
  expect(winner).toBe(pay[0].player);
  expect(computeWinnerProof(monsterId, winner!)).toBe(
    computeWinnerProof(monsterId, pay[0].player)
  );
}

describe('captureArbiter — pure primitives', () => {
  it('first valid claim pays; a second claim for the same monster is ignored', () => {
    const state = createArbiterState([], []);
    expect(arbitrateCapture(state, { monsterId: 'm', playerPubkey: 'A' }, () => null))
      .toEqual({ action: 'pay' });
    expect(arbitrateCapture(state, { monsterId: 'm', playerPubkey: 'B' }, () => null))
      .toEqual({ action: 'ignore' });
    expect(state.locked.get('m')).toBe('A');
  });

  it('an invalid claim rejects, poisons the monster, and does NOT take the lock', () => {
    const state = createArbiterState([], []);
    expect(arbitrateCapture(state, { monsterId: 'm', playerPubkey: 'A' }, () => 'bad distance'))
      .toEqual({ action: 'reject', reason: 'bad distance' });
    expect(state.locked.has('m')).toBe(false); // lock never taken by invalid claim
    expect(state.poisoned.has('m')).toBe(true);
  });

  it('validate is not even run once a monster is locked or poisoned', () => {
    const state = createArbiterState([], []);
    arbitrateCapture(state, { monsterId: 'locked', playerPubkey: 'A' }, () => null);
    let ran = false;
    const spy = () => { ran = true; return null; };
    expect(arbitrateCapture(state, { monsterId: 'locked', playerPubkey: 'B' }, spy).action).toBe('ignore');
    state.poisoned.add('bad');
    expect(arbitrateCapture(state, { monsterId: 'bad', playerPubkey: 'C' }, spy).action).toBe('ignore');
    expect(ran).toBe(false);
  });

  it('seeds locks from persisted paidCaptures (never re-pays after refresh)', () => {
    const state = createArbiterState(['already-paid'], []);
    expect(state.locked.get('already-paid')).toBe(PAID_SENTINEL);
    expect(arbitrateCapture(state, { monsterId: 'already-paid', playerPubkey: 'A' }, () => null).action)
      .toBe('ignore');
  });

  it('seeds poison from persisted rejectedCaptures', () => {
    const state = createArbiterState([], ['bad-monster']);
    expect(arbitrateCapture(state, { monsterId: 'bad-monster', playerPubkey: 'A' }, () => null).action)
      .toBe('ignore');
  });

  it('releaseCaptureClaim only releases the current holder', () => {
    const state = createArbiterState([], []);
    arbitrateCapture(state, { monsterId: 'm', playerPubkey: 'A' }, () => null);
    releaseCaptureClaim(state, 'm', 'B'); // wrong holder — no-op
    expect(state.locked.get('m')).toBe('A');
    releaseCaptureClaim(state, 'm', 'A'); // real holder — releases
    expect(state.locked.has('m')).toBe(false);
  });
});

describe('captureArbiter — integrated failure cases (goal file Phase 4)', () => {
  it('two claims for the SAME monster in one batch → exactly ONE payment, winnerProof = paid player', () => {
    const h = makeHarness();
    // Processed synchronously back-to-back, no re-render between.
    h.claim('mon-1', 'ALICE');
    h.claim('mon-1', 'BOB'); // the loser
    expect(h.payments).toHaveLength(1);
    expect(h.payments[0].player).toBe('ALICE');
    winnerProofMatchesPayment('mon-1', h.winners, h.payments);
    // The loser triggered no payment and is not the winner.
    expect(h.payments.some(p => p.player === 'BOB')).toBe(false);
    expect(h.winners.get('mon-1')).not.toBe('BOB');
  });

  it('first-PROCESSED wins regardless of claimed capturedAt values', () => {
    const h = makeHarness();
    // BOB is processed first even though ALICE claims an EARLIER capturedAt.
    // The arbiter never reads capturedAt — host processing order is the authority.
    h.claim('mon-1', 'BOB');   // capturedAt (client-claimed) = 9999, processed first
    h.claim('mon-1', 'ALICE'); // capturedAt (client-claimed) = 1,    processed second
    expect(h.payments).toHaveLength(1);
    expect(h.winners.get('mon-1')).toBe('BOB');
    winnerProofMatchesPayment('mon-1', h.winners, h.payments);
  });

  it('invalid claim then a valid claim from another player: invalid one never pays / wins (monster-poisoning behavior, documented)', () => {
    const h = makeHarness();
    // MALLORY fails a reject-validation (e.g. distance / rate limit / trust).
    h.claim('mon-1', 'MALLORY', () => 'Player location 8000m from monster');
    // ALICE is valid but arrives after — the pre-existing design POISONS the
    // monster on any rejected claim, so ALICE is ignored (goal file Task 1/3:
    // preserve monster-poisoning; assert THAT behavior).
    const aliceDecision = h.claim('mon-1', 'ALICE');
    expect(aliceDecision.action).toBe('ignore');
    expect(h.payments).toHaveLength(0);
    expect(h.winners.has('mon-1')).toBe(false);
    expect(h.rejected.get('mon-1')).toContain('8000m');
  });

  it('payment FAILURE → monster claimable again by a later valid claim; SUCCESS → permanently locked', () => {
    const h = makeHarness();
    // First winner's payment fails → lock released, winner rolled back.
    h.claim('mon-1', 'ALICE', () => null, () => ({ success: false }));
    expect(h.payments).toHaveLength(0);
    expect(h.winners.has('mon-1')).toBe(false);
    // A later valid claim (different player) can now win and be paid cleanly.
    h.claim('mon-1', 'BOB', () => null, () => ({ success: true }));
    expect(h.payments).toEqual([{ monsterId: 'mon-1', player: 'BOB' }]);
    winnerProofMatchesPayment('mon-1', h.winners, h.payments);
    // After success the monster is PERMANENTLY locked — further claims are ignored.
    const late = h.claim('mon-1', 'CAROL', () => null, () => ({ success: true }));
    expect(late.action).toBe('ignore');
    expect(h.payments).toHaveLength(1);
  });

  it('pending payment KEEPS the lock (in-flight, not retriable)', () => {
    const h = makeHarness();
    h.claim('mon-1', 'ALICE', () => null, () => ({ pending: true }));
    const again = h.claim('mon-1', 'BOB', () => null, () => ({ success: true }));
    expect(again.action).toBe('ignore');
    expect(h.payments).toEqual([{ monsterId: 'mon-1', player: 'ALICE' }]);
  });

  it('N distinct monsters in one batch each pay exactly once, no cross-monster interference', () => {
    const h = makeHarness();
    const claims = [
      ['mon-1', 'A'], ['mon-2', 'B'], ['mon-3', 'C'], ['mon-4', 'D'], ['mon-5', 'E'],
      // duplicate second claims for each monster in the same batch — all losers.
      ['mon-1', 'X'], ['mon-2', 'Y'], ['mon-3', 'Z'], ['mon-4', 'P'], ['mon-5', 'Q'],
    ] as const;
    for (const [m, p] of claims) h.claim(m, p);
    expect(h.payments).toHaveLength(5);
    for (const [m, winner] of [['mon-1', 'A'], ['mon-2', 'B'], ['mon-3', 'C'], ['mon-4', 'D'], ['mon-5', 'E']] as const) {
      winnerProofMatchesPayment(m, h.winners, h.payments);
      expect(h.winners.get(m)).toBe(winner);
    }
  });
});
