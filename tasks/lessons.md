# Lessons Learned

Patterns and rules to prevent repeated mistakes.

## Patterns

### Always verify Nostr event signatures before trusting event data
Any code that reads `event.pubkey` or `event.content` and acts on it (especially payments) must call `verifyEvent(event)` first. This applies to all event kinds, not just the financially critical ones.

### Use host-side values for payment amounts, never client-reported
When the host has authoritative data (e.g., monster sat values), always use the host's copy. Never trust amounts from the client event content — the client can be modified.

### Clear ALL credentials on logout, not just the login token
Logout must wipe every storage location: sessionStorage keys, localStorage credentials (NWC, session keys), and in-memory caches. Audit all storage keys when adding new credential storage.

### Don't proxy through third-party services for sensitive requests
Never route payment-related requests (LNURL, invoices) through untrusted CORS proxies. If a provider doesn't support CORS, fail cleanly rather than introducing a MITM. The security cost outweighs the convenience.

### Check field names against actual types before coding
The plan said `monster.sats` but the actual field was `monster.satAmount`. Always read the type definition before writing the fix — don't trust the plan's field names verbatim.

### CSP can't be fully locked down in decentralized apps
Nostr apps connect to user-configurable relays and dynamic Lightning endpoints on arbitrary domains. `connect-src` and `img-src` can't be whitelisted. Focus on adding missing directives (`form-action`, `object-src`, `frame-ancestors`) that don't conflict with dynamic connectivity.

### Geohash precision limits distance validation
With precision 5 (~5km cells), geohash-based distance checks can only catch gross spoofing (different city), not subtle range cheating. Document the limitation and set thresholds accordingly (5km, not 15m).

### Use `.js` extensions for `@noble/hashes` imports
`@noble/hashes` requires explicit `.js` extensions in import paths (e.g., `@noble/hashes/sha2.js`, not `@noble/hashes/sha256`). Check existing imports in the codebase for the correct pattern before adding new ones.

### Timestamp validation prevents replay attacks
Always reject Nostr events with `created_at` too far from `now`. A 5-minute window (`MAX_EVENT_AGE_SECONDS = 300`) balances clock skew tolerance with replay protection.

### Rate limiting belongs on the host side, not client side
Client-side rate limits are trivially bypassed. The host's `onMonsterCaptured` callback is the enforcement point — track timestamps per player in a ref and reject excess captures there.
