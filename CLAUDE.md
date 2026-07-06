# CLAUDE.md

## what this is
Sat Hunter: Pokemon GO meets Bitcoin. Location-based scavenger-hunt PWA — players
physically catch sat-pun creatures (Pisatchu, Satmander...) within capture range for
instant Lightning payouts via Nostr Wallet Connect. React 18 + TS + Vite, shadcn/ui,
Nostrify/nostr-tools, Getalby SDK, Leaflet + geohash. Field-tested with live players.

## commands
- npm run dev      # Vite dev server, port 8080
- npm run test     # the proof-of-work command: tsc + eslint + vitest + build
- npm run build    # production build
- npm run deploy   # publishes to the Nostr network — see hard rules

## hard rules
- NEVER run npm run deploy or publish Nostr events without an explicit ask — publishing is outward-facing and effectively irreversible
- never print, log, or commit nsec/private keys or NWC connection strings
- verify Nostr event signatures (verifyEvent) before trusting any event data you act on — all event kinds, not just payment-critical ones
- payment amounts come from host-side authoritative data, never client-reported values
- payment and anti-cheat changes need a test proving the failure case, not just the happy path
- new creatures follow the sat-pun naming pattern (Pisatchu, Ratasat, Satmander...)

## architecture pointers
- game state: GameContext (src/contexts/GameContext.tsx), useReducer + localStorage
- core types/constants: src/lib/gameTypes.ts (capture range, SatStop range/cooldown — read the file for current values, don't trust docs)
- monster generation: src/lib/gameUtils.ts (weighted rarity, exactly 1 Pisatchu per hunt)
- provider order in App.tsx matters: App > QueryClient > NostrLogin > Nostr > NWC > Game > Tooltip
- custom eslint rules in eslint-rules/: no TODO/FIXME comments, no inline scripts, manifest required

## dev notes
- mock location: DevTools button (bottom right, dev mode) — test hunt mechanics without GPS
- geolocation needs HTTPS in production; localhost is fine in dev
- Nostr login needs a browser extension (Alby, nos2x) or falls back to a local keypair

## memory
- read tasks/lessons.md before starting — it holds hard-won patterns from real bugs
- after any correction or repeated mistake, add a lesson there; delete lessons that turn out wrong
- plans and progress live in tasks/todo.md

## known mistakes
- field names in plans can be stale — read the actual type definition before coding against it (was: monster.sats vs monster.satAmount)
