# Security Audit — Fix Tracker

## Round 1 — Critical Fixes (commit 4458872)

- [x] **#3 Verify Nostr event signatures on capture events** — `verifyEvent()` in `useHuntSync.ts`
- [x] **#7 Clear session keys and NWC on logout** — `clearSessionKey()` + NWC keys in `useLoginActions.ts`
- [x] **Host-side payment amount validation** — `monster.satAmount` in `HostDashboard.tsx`

## Round 2 — Code Fixes (all complete)

- [x] **1. Timestamp validation** (6049b2a) — `MAX_EVENT_AGE_SECONDS = 300` in `useHuntSync.ts`
- [x] **2. Remove CORS proxy** (ea57eda) — Removed `corsproxy.io` fallback from `usePayPlayer.ts`
- [x] **3. Host-side distance validation** (27e732d) — Geohash decode + 5km threshold in `HostDashboard.tsx`
- [x] **4. Harden CSP** (4e27d79) — Added `form-action`, `object-src`, `frame-ancestors` to `index.html`
- [x] **5. Capture rate limiting** (bb8a972) — Max 3 captures per 10s per player in `HostDashboard.tsx`
- [x] **6. Input validation** (50dfc33) — `maxLength` on hunt name (100) and description (500) in `CreateHuntForm.tsx`
- [x] **7. Payment preimage validation** (7afd072) — `sha256(preimage) === payment_hash` in `usePayPlayer.ts`
- [x] **8. Verify join/leave signatures** (6654165) — `verifyEvent()` on join and leave events in `useHuntSync.ts`

## Round 3 — Architectural Security Fixes

- [x] **1. PBKDF2 + crypto RNG** (ff8ec9a)
- [x] **2. CSP wss: whitelist + relay allowlist** (64cc047, CSP wss: reverted in c48e31e — see note)
- [x] **3. Encrypted NWC storage** (01f4324)
- [x] **4. HMAC capture proof tokens** (518fa2a)

### Details

### 1. PBKDF2 key stretching + crypto RNG for share codes (Audit #6)

**Problem**: Share codes have 30 bits entropy, generated with `Math.random()`, and the PSK is derived with a single `sha256()`. An attacker can brute-force all 1B codes in ~100 seconds.

**Files**:
- `src/lib/gameUtils.ts` (~line 32) — `generateShareCode()` uses `Math.random()`
- `src/lib/zeroTrustRelay.ts` (~line 201) — `createSessionFromPSK()` uses bare `sha256()`

**Fix A — Crypto RNG**: Replace `Math.random()` with `crypto.getRandomValues()` in `generateShareCode()`.

**Fix B — PBKDF2 key stretching**: Replace `sha256(preSharedKey)` with `pbkdf2(sha256, preSharedKey, salt, { c: 100_000, dkLen: 32 })` in `createSessionFromPSK()`. Salt is `sha256(sessionId)` for uniqueness. `@noble/hashes` already has `pbkdf2`. ~150ms latency per connection (acceptable, happens once at hunt join). Brute-force goes from 100 seconds to 3+ years.

**Both host and player** call `createSessionFromPSK()`, so the change is symmetric — no protocol mismatch.

### 2. CSP wss: whitelist + relay allowlist validation (Audit #9)

**Problem**: `connect-src wss:` allows connections to any WebSocket domain. Rogue relays can be injected via RelayListManager.

**Files**:
- `index.html` (line 6, CSP meta tag)
- `src/components/RelayListManager.tsx` (~line 59-85)

**Fix A — CSP**: ~~Split `wss:` out of the wildcard.~~ **Reverted (c48e31e)**: NWC connection strings embed arbitrary relay URLs (e.g., `wss://relay.getalby.com/v1`) that can't be whitelisted in CSP. The specific whitelist blocked all NWC payments. Reverted to `wss:` wildcard. Residual risk is minimal since `https:` is also open (required for LNURL), so the `wss:` wildcard doesn't meaningfully widen the attack surface beyond what `https:` already allows.

**Fix B — Relay validation** (still active): Approved relay allowlist in `RelayListManager.tsx`. Rejects relay URLs not on the list. This is the effective defense against rogue Nostr relays.

### 3. Encrypted credential storage (Audit #1 + #4)

**Problem**: NWC connection strings and session keys stored as plaintext. XSS or malicious extension can steal them.

**Files**:
- New: `src/lib/encryptedStorage.ts`
- `src/hooks/useNWC.ts` (lines 24-25, storage)
- `src/lib/sessionKeys.ts` (lines 40-63, storage)

**Approach — Nostr signer-derived encryption key**:
1. On login, ask extension to sign deterministic message: `"sathunter:storage-key:v1"`
2. `sha256(signature)` = AES-256-GCM encryption key
3. Encrypt NWC connections and session keys before writing to storage
4. On next load: re-sign same message → same key → decrypt
5. Fallback for generated keypairs (no extension): PBKDF2 from nsec

**Implementation**:
- `encryptedStorage.ts`: `encrypt(key, plaintext)` and `decrypt(key, ciphertext)` using Web Crypto AES-256-GCM
- Update `useNWC.ts`: encrypt before `localStorage.setItem`, decrypt on load
- Update `sessionKeys.ts`: encrypt before `sessionStorage.setItem`, decrypt on load
- Key derivation happens once per session, cached in memory

### 4. HMAC-based capture proof tokens (Audit #2)

**Problem**: Host has no independent verification that a capture event came from a player who actually joined the hunt through the authenticated channel.

**Solution**: HMAC-based capture tokens — simpler than full challenge-response, no persistent bidirectional connection needed.

**Files**:
- `src/lib/antiCheat.ts` — `generateCaptureSecret()`, `computeCaptureProof()`, `verifyCaptureProof()`
- `src/lib/p2pSignaling.ts` — Added `captureSecret` to `HuntLocationData`
- `src/lib/gameTypes.ts` — Added `captureSecret?` to `HuntEvent`
- `src/hooks/useHostConnection.ts` — Generates secret, includes in hunt data, exposes to HostDashboard
- `src/hooks/usePublishCapture.ts` — Computes `HMAC-SHA256(secret, monsterId+pubkey+timestamp)` in capture events
- `src/components/game/GameMap.tsx` — Passes `captureSecret` to publishCapture
- `src/hooks/useHuntSync.ts` — Extracts `captureProof` from capture events
- `src/components/game/HostDashboard.tsx` — Verifies HMAC before triggering payment
- `src/contexts/GameContext.tsx` — Strips `captureSecret` before persisting to localStorage
- `src/pages/JoinHuntPage.tsx` — Includes `captureSecret` when merging location data

**Protocol**:
1. Host generates random 32-byte `captureSecret` per hunt session
2. Secret included in encrypted hunt data (P2P or zero-trust relay)
3. Player computes `HMAC-SHA256(captureSecret, monsterId:playerPubkey:capturedAt)`
4. HMAC proof included in capture event content
5. Host verifies HMAC before payment — rejects if missing or invalid

**Security properties**: Proves player received hunt data through authenticated channel. Cannot forge captures without the secret. Secret is never persisted to storage.

## Review

All 11 original findings addressed across 3 rounds. Round 3 completed 4 architectural security fixes with privacy-preserving solutions. All changes committed on `audit` branch.
