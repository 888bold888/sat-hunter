# Security Audit — Fix Tracker

## Round 1 — Critical Fixes (commit 4458872)

- [x] **#3 Verify Nostr event signatures on capture events** — `verifyEvent()` in `useHuntSync.ts`
- [x] **#7 Clear session keys and NWC on logout** — `clearSessionKey()` + NWC keys in `useLoginActions.ts`
- [x] **Host-side payment amount validation** — `monster.satAmount` in `HostDashboard.tsx`

## Round 2 — Code Fixes (all complete)

- [x] **1. Timestamp validation** (6049b2a) — `MAX_EVENT_AGE_SECONDS = 300` in `useHuntSync.ts`
- [x] **2. Remove CORS proxy** (ea57eda) — Removed `corsproxy.io` fallback from `usePayPlayer.ts`
- [x] **3. Host-side distance validation** (27e732d) — Geohash decode + 5km threshold in `HostDashboard.tsx`
- [x] **4. Harden CSP** (4e27d79) — Added `form-action`, `object-src`, `frame-ancestors` to `index.html`. Note: `connect-src https: wss:` cannot be tightened due to dynamic Lightning endpoints and user-configurable relays.
- [x] **5. Capture rate limiting** (bb8a972) — Max 3 captures per 10s per player in `HostDashboard.tsx`
- [x] **6. Input validation** (50dfc33) — `maxLength` on hunt name (100) and description (500) in `CreateHuntForm.tsx`
- [x] **7. Payment preimage validation** (7afd072) — `sha256(preimage) === payment_hash` in `usePayPlayer.ts`
- [x] **8. Verify join/leave signatures** (6654165) — `verifyEvent()` on join and leave events in `useHuntSync.ts`

## Deferred / Architectural

- **#1 NWC in plain localStorage** — Mitigated by CSP hardening. True fix requires PIN-based encryption or WebAuthn (larger UX change).
- **#4 Session keys as plain JSON** — Same mitigation via CSP. sessionStorage already cleared on browser close.
- **#6 Weak PSK (6-char share code)** — Could add PBKDF2 key stretching or rate-limit handshake attempts. Lower priority since it requires physical proximity context.

## Review

All 11 actionable findings addressed across 2 rounds. 3 architectural items deferred with mitigations in place.
