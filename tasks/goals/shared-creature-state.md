# Goal: Shared creature state — all players see one world

**Status**: in progress (phases 0–1 done)
**Why**: In a multi-player hunt every player must see the same creatures in the
same places, and when player 1 catches one it must disappear from player 2's map.
The field test showed this is glitchy: caught creatures linger as "ghosts" on other
players' maps, a second player can "catch" an already-caught creature and get a
fake success with no payout, and late joiners see creatures that were caught before
they joined. Separately, creatures flicker in and out for a *single* player from
GPS jitter — once a creature appears it should stay until the player has walked
well away (~100m), so both "creatures disappear wrongly" bugs are fixed here
and players can tell the one legitimate disappearance (someone else caught it)
from noise.

## What the code actually does today (verified 2026-07-08)

Spawn-side is already shared: the host generates all monsters and sends the full
list (geoFence, monsters, satStops, captureSecret) to each player **once** at join
via the zero-trust relay hello (`useHostConnection.ts` ~line 343,
`useHuntConnection.ts` `waitForZeroTrustData`). Capture-side is where it breaks:

1. **Players ignore captures entirely.** `GamePage.tsx:131` passes
   `onMonsterCaptured: () => {}` to `useHuntSync` with the comment "Players don't
   need to handle this". A player's map is never told about anyone else's capture.
2. **Players couldn't decrypt them anyway.** Capture events (kind 32960,
   `usePublishCapture.ts`) are NIP-44 encrypted to the host pubkey and signed with
   ephemeral session keys. `useHuntSync` skips undecryptable events. Only the host
   (with `hostSigner`) learns who caught what.
3. **Late joiners get a stale snapshot.** Other players' captures live in
   HostDashboard component state (`syncedCaptures`), NOT in `hunt.monsters` —
   the hello snapshot sends `hunt.monsters`, so a late joiner receives creatures
   as uncaptured even when the host already paid out for them.
4. **No conflict resolution UX.** If two players capture the same monster inside
   the ~5s poll window, both see local success; the host pays only the first
   (`paidCaptures` dedup). The loser is never told — they think they earned sats
   that never arrive. This exact confusion was reported in the field test.
5. **Proximity flicker isn't fixed (field report #2).** Players saw creatures
   appear then vanish while standing still or after a few steps. Commit 493b163
   added hysteresis (appear ≤15m, disappear >25m) but the band is only 10m —
   real-world GPS jitter under trees/buildings routinely exceeds that, so one bad
   fix past 25m despawns the creature. Compounding it:
   - The hysteresis logic is **duplicated** with separate state: HuntMap.tsx:179
     (`visibleMonsterIdsRef`, drives the map markers) and GameContext.tsx:436
     (`nearbyMonsterIdsRef`, drives nearby/capture UI). They can disagree.
   - HuntMap's `visibleMonsterIdsRef` is a component ref — any HuntMap remount
     resets it, instantly despawning every creature in the 15–25m band.
   - Constants are hardcoded in three places (HuntMap ×2 incl. CAPTURE_RANGE at
     line 290, GameContext ×1) instead of living in gameTypes.ts per CLAUDE.md.
6. **Double-payment guard has a stale-closure smell.** `onMonsterCaptured` in
   HostDashboard checks `!paidCaptures.has(monsterId)` from a React state closure;
   two capture events for the same monster processed in one poll batch may both
   pass the check. Needs a failure-case test (per CLAUDE.md hard rule) and likely
   a ref-based guard.

## Core design

Two-tier capture propagation: **optimistic hide fast, host confirmation
authoritative.**

### Tier 1 — optimistic hide from the public dedup tag (no crypto changes)
Capture events already carry a public `d` tag = `sha256("{shareCode}-{monsterId}")`
(`usePublishCapture.ts:61`). Every player knows the shareCode and all monster IDs,
so they can precompute `dedupHash → monsterId` for the roster and recognize "some
monster was claimed" from the tag alone — no decryption needed, works with the
existing `useHuntSync` poll. On match: mark the monster `captured` locally so it
leaves the map within one poll cycle (~5s).
- This is spoofable by any hunt participant (anyone with the shareCode can forge
  the tag), so it only ever *hides* creatures — it must never credit sats,
  affect payment, or feed anti-cheat. Griefing risk is capped at hiding creatures
  from co-players, and Tier 2 corrects the record.

### Tier 2 — host capture-state broadcasts over the zero-trust relay (authoritative)
**Privacy decision (2026-07-08, resolved with user):** confirmations must NOT be a
new addressable/persistent event kind. Addressable events live on relays forever,
and the shareCode is already public (32959 `d` tag), so neither the blinded `x`
tag nor any shareCode-derived encryption hides anything from a relay observer.
Instead, reuse the existing **zero-trust relay** (`src/lib/zeroTrustRelay.ts`,
outer kind 21111 — *ephemeral* range, relays do not retain it) with its throwaway
keys and field-tested 1-to-many broadcast mode (see memory: 20-player test,
`rotateThrowaway=false`).

After the host validates a capture (existing rate-limit / distance / proof checks
in `HostDashboard.onMonsterCaptured`) and picks the winner, it broadcasts an
encrypted `capture_state` message to connected players' sessions containing the
**full list of captured monster ids + winner session pubkeys** (small; idempotent).
- Full-state (not delta) makes the sync self-healing: a player who slept through
  N messages is corrected by the next one. Host also rebroadcasts periodically
  (e.g. every ~15s while any player is connected) so recovery doesn't depend on
  capture activity.
- Authenticity comes from the zero-trust session itself (per-session encryption
  keys established at the authenticated hello) — a message that decrypts under
  the session is by construction from the host; there is no host-npub signature
  to leak or verify. Sequence-window rules already reject replays.
- On receiving `capture_state`: monsters in the list become terminally captured;
  if the local player optimistically credited a capture the state attributes to
  someone else, roll back the credit and show "Too slow — another hunter got it!".
- **Verify during phase design:** whether player zero-trust sessions currently
  stay subscribed after the hello handshake or are torn down
  (`useHuntConnection.ts` resolves after one payload) — if torn down, keeping the
  subscription alive is part of Phase 2.

### Late joiners / reconnects
Host merges `syncedCaptures` into the monster list it sends in the hello snapshot
(captured flags + capturedBy), so a late joiner's map is correct from second zero.
Reconnecting/waking players are healed by the next periodic `capture_state`
broadcast — no relay backfill query exists or is needed, because nothing
persistent is published.

### Conflict resolution
First valid `capturedAt` the host processes wins (host clock is authority; it
already ignores client-reported amounts). Losing capture publishes nothing new —
the loser learns from the Tier 2 confirmation naming a different winner. Client
UX: when a player taps a monster that is optimistically hidden or confirmed
captured, `canCaptureMonster` refuses with an "already captured" reason instead
of a fake success.

### Sticky visibility (field report #2)
Once a creature has appeared for a player, it stays on their map until they have
genuinely walked away — **disappear threshold 100m** (user decision 2026-07-08:
initially "20–50 meters", then raised to 100m "just to be safe" — disappearing
too eagerly is the failure players actually hit, and a wide band has no gameplay
cost since capture range is unchanged). Appear
range stays tied to capture range (~15m — read gameTypes.ts for the live value).
- Single source of truth: `APPEAR_RANGE` / `DISAPPEAR_RANGE` / `CAPTURE_RANGE`
  move to `src/lib/gameTypes.ts`; one shared hysteresis helper (pure function +
  persistent id-set) consumed by both HuntMap and GameContext so map and
  capture-UI can never disagree.
- Hysteresis state must survive HuntMap remounts (lift to GameContext or a
  module-level store keyed by hunt id; reset on hunt change).
- Optional hardening if 100m still flickers in testing: require 2–3 consecutive
  fixes beyond DISAPPEAR_RANGE before despawning (single-spike absorption).
- Distinct from capture-removal: a creature captured by another player (Tier 1/2)
  is removed immediately regardless of distance — that's signal, not jitter.
- Widening DISAPPEAR_RANGE must NOT touch CAPTURE_RANGE or any anti-cheat
  distance check — visibility is display-only; payments still require ≤15m.

## Hard constraints (CLAUDE.md / lessons.md)
- **Privacy (user directive 2026-07-08):** maximum encryption, ephemeral keys, and
  nothing sensitive persisted on relays forever. Concretely:
  - No new persistent/addressable event kinds for gameplay state — host→player
    sync goes over the ephemeral zero-trust relay (kind 21111) only.
  - No latitude/longitude or geohash in any payload players can read; location
    stays inside NIP-44 content addressed to the host (existing coarse-geohash
    path) and the encrypted hello. Grep new code paths for `lat`, `lng`,
    `location`, `geohash` in review.
  - Never derive encryption keys or secrecy claims from the shareCode — it is
    public in the 32959 `d` tag, which also makes the `x` blinded tag observer-
    computable (weak blinding, don't rely on it for confidentiality).
  - Secrets for broadcast (if any) travel only inside the encrypted hello,
    like `captureSecret` does today. Never logged/printed (CLAUDE.md).
- `verifyEvent` on every relay event acted upon — Tier 1 tag-matching still
  verifies the outer event signature before trusting its tags. Timestamp-window
  rejection on all new event handling.
- Payment amounts stay host-side authoritative; Tier 1 optimistic data influences
  **display only**, never payment or trust scores.
- Payment/anti-cheat changes ship with tests proving the failure case:
  - two players capture the same monster in one poll batch → exactly one payment;
  - forged Tier 1 event (valid `d` tag, garbage content) hides but never credits;
  - a `capture_state` message not encrypted under the player's zero-trust session
    fails to decrypt and is ignored (host authenticity by construction);
  - replayed/out-of-window `capture_state` is rejected by the sequence rules;
  - no new player-readable payload contains lat/lng/geohash (assert on the
    serialized messages, not just types).
- Never `npm run deploy` / never publish real Nostr events from tests — follow the
  existing mock-relay patterns in `src/test/`.
- Demo hunts (`isDemo`) have no relay: all new sync paths must stay dead in demo
  mode (the demo guards tests must stay green).
- Read `src/lib/gameTypes.ts` for current field names before coding (e.g. it is
  `monster.satAmount`, not `monster.sats`; `capturedBy` exists on Monster).
- Pure crypto/hash tests need `// @vitest-environment node` (jsdom Uint8Array
  breaks @noble/hashes).

## Phases
- [x] **0. Sticky visibility** — constants to gameTypes.ts, shared hysteresis
      helper with remount-surviving state, DISAPPEAR_RANGE → 100m. Tests: a
      ~80m GPS spike does not despawn a visible creature; HuntMap remount does not
      despawn creatures in the hysteresis band; map and nearby-UI visibility
      agree for the same location sequence; capture still requires CAPTURE_RANGE.
- [x] **1. Player-side capture awareness (Tier 1)** — dedupHash→monsterId map for
      the roster; wire a real `onMonsterCaptured`/tag-match path in GamePage's
      `useHuntSync` so claimed monsters get marked captured in GameContext
      (display-only reducer action, no stats/sats side effects). Ghost creatures
      disappear within one poll (~5s).
- [ ] **2. Host `capture_state` broadcasts (Tier 2)** — keep player zero-trust
      sessions alive past hello (verify current lifetime first); host broadcasts
      full captured-state over the ephemeral relay after each validated capture
      and on a ~15s heartbeat; players terminally resolve monsters from it,
      including loser rollback + "too slow" UX.
- [ ] **3. Late-joiner correctness** — host hello snapshot merges syncedCaptures
      into monster captured/capturedBy flags; rejoining players reconcile from
      the snapshot + next heartbeat rather than duplicate.
- [ ] **4. Race hardening on the host** — ref-based paid/processing guard so one
      poll batch with N claims for one monster produces exactly one payment and
      one winner in `capture_state`; first-capturedAt-wins documented and tested.
- [ ] **5. Field-glitch regression tests** — the failure cases listed under hard
      constraints, plus: player 2 taps an optimistically-hidden monster → clean
      "already captured" refusal, no capture event published.

## Open questions (resolve during phase design, note answers here)
- ~~Confirmation content: plaintext vs encrypted / new event kind~~ **Resolved
  2026-07-08:** no persistent event kind at all; encrypted `capture_state` over
  the ephemeral zero-trust relay (see Tier 2). Driver: shareCode is public in the
  32959 `d` tag, and addressable events persist forever.
- Zero-trust session lifetime after hello: do player sessions stay subscribed, or
  does `useHuntConnection` tear down after the single hunt-data payload? Phase 2
  starts by answering this.
- Host battery/rate cost of a 15s heartbeat at 20+ players in 1-to-many mode —
  the existing stress tests (`zeroTrustRelay.test.ts`) give a baseline; tune the
  interval if needed.
- Should Tier 1 also optimistically hide on the *capturing* player's own publish
  failure/retry path (offline capture queue), or is that out of scope?
- Existing leak worth a separate look (out of scope here): the 32959 hunt event
  exposes shareCode, total_sats, times, and a bolt11 invoice under the host's
  real npub — consider a follow-up goal if that bothers us.

## Progress log
<!-- /goal appends dated entries here as work lands -->

### 2026-07-08 — Phase 0 complete (sticky visibility), verifier PASS after one fix
- Constants consolidated in gameTypes.ts: `CAPTURE_RANGE_METERS=15`,
  `SATSTOP_RANGE_METERS=10`, `MONSTER_APPEAR_RANGE_METERS=capture`,
  `MONSTER_DISAPPEAR_RANGE_METERS=100`. gameUtils defaults now use them.
- Single hysteresis path: pure `filterVisibleMonsters` in gameUtils (also gates
  captured + spawnTime, which the old GameContext copy forgot); state lives ONLY
  in GameContext (`nearbyMonsterIdsRef` + `visibleHuntIdRef` reset on hunt-id
  change), so it survives HuntMap remounts. HuntMap is now a dumb renderer (its
  private `visibleMonsterIdsRef` + 15/25 constants deleted); GameMap renders
  `state.nearbyMonsters`; host `showAllMonsters` path unchanged.
- Verifier caught a third hidden visibility filter: GameHUD's "N nearby" count
  had its own hardcoded 15m cutoff (would flip to 0 during the exact GPS spike
  the map now absorbs). Fixed: GameHUD renders `state.nearbyMonsters` too.
  Lesson: when unifying duplicated logic, grep for the *concept* (distance
  literals), not just the known copies.
- `state.nearbyMonsters` had zero consumers before this phase (dead state) —
  now it is the single visibility source for map + HUD. `getAvailableMonsters`
  remains in the context API (no live consumers outside tests).
- Tests: `src/test/monsterVisibility.test.tsx` (9) — 80m-spike no-despawn,
  despawn only >100m, captured/unspawned never visible, visible-but-far not
  capturable (capture range untouched), new-hunt visibility reset, threshold
  sanity. Full suite green: 99 tests, tsc/eslint/build clean.
- Note for Phase 1: capture-removal must bypass stickiness — already true, the
  helper drops `captured` monsters regardless of the previously-visible set.

### 2026-07-08 — Phase 1 complete (Tier 1 capture awareness), verifier PASS
- `src/lib/captureSync.ts`: `computeCaptureDedupHash` / `buildCaptureDedupIndex`;
  usePublishCapture now calls the same helper for its `d` tag, so the publish
  and match formats are locked together (plus a hardcoded node:crypto vector in
  the test pinning the wire format).
- `useHuntSync`: new optional `onCaptureClaimTag(dedupHash)` — fires once per
  event, only AFTER verifyEvent + timestamp window, before/independent of the
  host decrypt path. Host callbacks unchanged (HostDashboard omits it).
- GameContext: `MARK_MONSTER_CLAIMED` reducer action + `markMonsterClaimed()`.
  Display-only: flips captured/capturedAt, capturedBy left unset for Tier 2 to
  fill; no-ops on unknown/already-captured/no-hunt; removes the monster from
  `nearbyMonsters` immediately (real disappearance bypasses 100m stickiness).
  `scattered_replacement` next-monster activation extracted to
  `activateNextUnspawned` and fired on remote claims too, so all players' local
  worlds progress identically (roster order is host-generated and shared).
- GamePage: `claimIndex` (memoized per hunt, non-host non-demo only) →
  `markMonsterClaimed` via the tag callback. Own-capture echo is a no-op.
- Tests: `captureSync.test.ts` (node env, 3) + `monsterClaims.test.tsx` (5,
  incl. the forged-claim-never-credits failure case). Suite: 107 tests green.
- Verifier note: the two PoW-heavy zeroTrust tests can exceed their 5s timeout
  under parallel CPU contention (pass in isolation) — not related to this work,
  but expect occasional flakes on loaded machines.
- Ghost-creature fix latency: within one 5s poll of the relay seeing the
  capture event. Losing-player "too slow" UX + credit rollback is Phase 2
  (needs the authoritative winner, which Tier 1 can't provide).
