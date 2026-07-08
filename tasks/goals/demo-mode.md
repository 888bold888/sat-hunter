# Goal: Demo Mode — try the game with zero setup

**Status**: done (v1 — parked ideas below remain open)
**Why**: People hear about Sat Hunter, open the website, and hit a dead end — no
host is running a hunt, and Nostr login + wallet setup is too much friction just to
look around. They should be able to feel the core loop (walk → creature appears →
capture → sats counter goes up) within 30 seconds of landing, with no login, no
wallet, no host.

## Core design

A **self-hosted local hunt** that runs entirely on the player's device. No Nostr
events, no NWC, no host connection — just the existing generation and capture logic
pointed at a geofence around the player.

### Entry flow (main page)
- "Try Demo" button on `src/pages/Index.tsx`, secondary to "Start Hunting" —
  visible always, but especially the answer for the not-logged-in visitor.
- Tap → ask for geolocation. On grant: spawn a demo hunt geofence (~300m radius,
  `createGeoFence`) centered on the player.
- On deny / desktop / no GPS: fall back to **couch mode** — drop the player at a
  scenic default location and let them move with tap-to-walk on the map (reuse the
  DevTools mock-location mechanism, `src/components/game/DevTools.tsx`). The demo
  must never dead-end on a permission prompt; that's the exact failure it exists to fix.

### Gameplay
- Generate monsters with `generateMonsters` / `generateMonstersAsync`
  (`src/lib/gameUtils.ts`) and sat cubes with `generateSatStops` inside the demo
  geofence. Include the full rarity ladder ending with the 1 Pisatchu.
- Guided first minute: guarantee the first creature spawns just inside capture
  range so the very first tap succeeds, then the rest require actual walking
  (or tap-to-walk in couch mode).
- Captures credit **demo sats** to an on-screen counter styled like the real
  balance, clearly badged "DEMO".
- Reuse `GameMap`, `MonsterCard`, `CaptureSuccessDialog`, `GameHUD` — the demo
  should look identical to the real game, because it *is* the real game minus
  payouts.

### Ending / conversion
- Demo ends when the player catches Pisatchu or clears the field (optionally a
  soft 5-minute timer). Show a summary: "You caught X creatures worth N sats.
  In a real hunt those sats land in your Lightning wallet instantly."
- Two CTAs: **Join a real hunt** (share-code / QR path) and **Host your own**.
  This is where Nostr login is introduced — after they're hooked, not before.

## Hard constraints (from CLAUDE.md / lessons.md)
- Demo publishes **zero Nostr events** and makes **zero NWC / Lightning calls**.
  Grep the demo path for `publish`, `nwc`, `payInvoice` in review.
- Demo state is namespaced separately in localStorage (e.g. `demo-hunt` key or a
  `mode: 'demo'` flag on the hunt) so it can never collide with or corrupt a real
  hunt in `GameContext`. Exiting demo fully clears demo state.
- Anti-cheat / rate-limit code paths must not fire in demo mode (no host to
  enforce them, and no money at stake).
- Read `src/lib/gameTypes.ts` for current capture range / SatStop values before
  coding — don't trust numbers in this file.
- Demo creatures use the existing roster; any new ones follow the sat-pun pattern.

## Phases
- [x] **1. Demo hunt engine** — a `startDemoHunt(center: GeoLocation)` path in
      GameContext (or a thin demo wrapper around it) that builds a local hunt
      object with generated monsters + sat stops and `mode: 'demo'`. Capture
      reducer path credits demo sats locally, skips publish/payment hooks.
- [x] **2. Entry flow on Index** — Try Demo button, geolocation request,
      couch-mode fallback with tap-to-walk movement.
- [x] **3. Demo HUD & guardrails** — DEMO badge, demo sat counter, exit-demo
      control, guaranteed first catch, state cleanup on exit.
- [x] **4. End screen & conversion CTAs** — summary dialog, join/host CTAs
      leading into the existing login flow.
- [x] **5. Tests** — the failure cases, not just happy path: demo capture never
      calls publish/payment code; demo state never leaks into a real hunt;
      geolocation-denied path still produces a playable demo.

## Parked ideas (brainstorm leftovers — revisit after v1)
- 5-minute "blitz" demo with a shareable score card at the end.
- Replay/spectator mode showing an anonymized past real hunt on its actual map.
- Demo-only tutorial creature ("Satchel"?) that talks the player through the UI.
- Host-side demo: let a would-be host draw a boundary and watch fake players hunt.

## Progress log
<!-- /goal appends dated entries here as work lands -->

### 2026-07-06 — Phase 1 complete (demo hunt engine), verifier PASS
- `isDemo?: boolean` on `HuntEvent`; `startDemoHunt(center)` / `exitDemoHunt()` in
  GameContext (300m fence, 8 monsters / 21000 demo sats via sync generators, all
  spawnTime=now, cheapest common planted ~11m from center — inside the 15m capture
  range confirmed in gameUtils).
- Isolation: demo captures don't touch lifetime/total stats; stats + hunt
  persistence skipped for demo; anti-cheat integrity block bypassed only for demo;
  `leaveHunt` for demo = local cleanup (no publishLeave, no history);
  `useKickSubscription` and `useHuntSync` get null; `publishCapture` gated in GameMap.
- Structural note: capture eligibility extracted to pure `canCaptureMonster(state,
  monster)` (exported with `gameReducer`/`initialState` for tests) — verifier
  confirmed line-for-line equivalence for real hunts. Adds 5 benign
  react-refresh/only-export-components eslint warnings.
- Tests: `src/test/demoMode.test.tsx` (7 failure-case tests). `npm run test` green (72 tests).
- Watch-out for Phase 3/4: `handleEndHunt` in GamePage would publish if reached
  with a demo hunt — currently unreachable (host-gated); demo exit must go through
  `leaveHunt`/`exitDemoHunt`.

### 2026-07-06 — Phase 2 complete (Try Demo entry + couch mode), verifier PASS
- GameContext: `manualMovement` state (reset on every hunt change/exit),
  `startDemoHunt(center, { manualMovement })` sets playerLocation synchronously,
  `setManualLocation` hard-guarded to `isDemo && manualMovement` (real hunts can
  never accept injected locations), `startLocationTracking` no-ops only in couch demo.
- HuntMap: `onMapClick` prop via Leaflet click + ref pattern. GameMap: tap-to-walk
  wiring + dismissable "Tap the map to walk" badge.
- Index: outline "Try Demo" button ("No login, no wallet — just play"), GPS
  success → demo at user coords; deny/timeout/unsupported → couch demo at
  DEFAULT_TEST_LOCATION. No dead-end branches. Hidden when a real hunt is active.
- 5 new tests (injection rejection, GPS-watch suppression + control, etc.).
  `npm run test` green (77 tests).

### 2026-07-06 — Phases 3+4 complete (HUD, end screen, conversion), Phase 5 complete
- GameHUD: purple DEMO badge, "demo sats" labeling, lifetime tiles swapped for
  demo-session values during demo only. GamePage: "Exit Demo" relabel (same
  demo-safe `leaveHunt`), `DemoEndDialog` (new component) with Join a real hunt /
  Host your own / Keep exploring CTAs — navigation CTAs call `leaveHunt()` first.
- Triggers via pure `getDemoEndReason` in gameUtils ('all-captured' | 'mythic' |
  'time-expired'), deduped per reason, fired on CaptureSuccessDialog close + a
  1s poll for time expiry. Real hunts still use HuntEndedDialog (now demo-gated).
- Verifier initially FAILED phases 3+4: `getDemoEndReason` ranked mythic above
  all-captured, but every demo has exactly one mythic, so a cleared field
  re-evaluated to the already-dismissed 'mythic' and the end screen could never
  reopen after "Keep exploring". Fixed by reordering (all-captured first) +
  regression test. Verifier re-check was cut short by a session limit; the fix
  and dedup flow were re-verified manually (GamePage.tsx:119-125, 536).
- Phase 5: `src/test/demoGuards.test.tsx` — demo capture publishes zero Nostr
  events (+ real-hunt control asserting publish args), Try Demo never dead-ends
  (geolocation denied / unsupported → couch demo at DEFAULT_TEST_LOCATION,
  success control → GPS demo at user coords). Note: MonsterCard defers onCapture
  ~500ms for the catch animation — capture tests must waitFor.
- Final: `npm run test` green — 90 tests, 11 files, tsc/eslint/build clean
  (5 benign react-refresh warnings from test-only exports in GameContext).
