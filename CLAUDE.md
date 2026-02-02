# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Sat Hunter?

**Pokemon GO meets Bitcoin.** A location-based scavenger hunt where players physically explore the real world to catch creatures containing real satoshis, paid instantly via Lightning Network.

- Hosts deploy sats into a geofenced area as catchable creatures
- Players walk around to find and catch creatures (must be within 3 meters)
- Catching a creature instantly pays the player via Lightning
- Cypherpunk aesthetic with Bitcoin orange, neon accents, dark mode

### Creature Naming Convention

All creatures are Pokemon parodies with "sat" in the name:
- **Pisatchu** (Pikachu) - Mythic, exactly 1 per hunt, highest value
- **Ratasat** (Rattata), **Saterpie** (Caterpie), **Satgey** (Pidgey) - Common
- **Satmander** (Charmander), **Saturtle** (Squirtle), **Bulsatba** (Bulbasaur) - Legendary

When adding new creatures, follow this pattern.

## Build & Development Commands

```bash
npm run dev      # Start Vite dev server (port 8080)
npm run test     # Full suite: TypeScript + ESLint + Vitest + build
npm run build    # Production build
npm run deploy   # Build and deploy to Nostr network
```

The test command runs the entire pipeline: `tsc --noEmit && eslint && vitest run && vite build`.

## Architecture Overview

React 18 + TypeScript PWA built with Vite.

### Core Stack
- **UI**: shadcn/ui (Radix primitives) + TailwindCSS
- **State**: React Context + TanStack Query
- **Nostr**: Nostrify + nostr-tools for relay communication
- **Payments**: Getalby SDK (Nostr Wallet Connect + WebLN)
- **Maps**: Leaflet + geohash for location features
- **Storage**: localStorage for game state, IndexedDB for larger data

### Key Directories
- `src/components/game/` - Game-specific UI (HuntMap, CreateHuntForm, HostDashboard, PlayerDashboard)
- `src/components/ui/` - shadcn/ui components
- `src/contexts/` - State providers (GameContext, NWCContext, DMContext)
- `src/hooks/` - Custom hooks for Nostr, payments, game logic
- `src/lib/` - Core types (`gameTypes.ts`) and utilities (`gameUtils.ts`)
- `src/pages/` - Route components

### State Management Pattern

GameContext (`src/contexts/GameContext.tsx`) is the central game state using useReducer:
- Actions: SET_ACTIVE_HUNT, CAPTURE_MONSTER, COLLECT_BALLS, etc.
- Auto-persists to localStorage via useLocalStorage hook
- Includes location tracking with mock location support for development

### Provider Stack (App.tsx)

The app wraps in this order: AppProvider > QueryClientProvider > NostrLoginProvider > NostrProvider > NWCProvider > GameProvider > TooltipProvider.

## Game Logic

### Monster Generation (`src/lib/gameUtils.ts`)
- Weighted rarity: Common 50%, Uncommon 25%, Rare 15%, Legendary 9%, Mythic 1%
- Each hunt has exactly 1 Pisatchu (mythic) plus randomly distributed creatures
- Sats distributed proportionally to rarity multipliers

### Key Constants (`src/lib/gameTypes.ts`)
- Visibility/Capture range: 15 meters (creatures appear and can be caught within this distance)
- SatStop range: 10 meters
- SatStop cooldown: 5 minutes

### Hunt Flow
1. Host creates hunt: deploys sats + creatures within geofenced area
2. Pays Lightning invoice to activate hunt
3. Players join via 6-character share code
4. Players collect SatBalls from SatStops, catch creatures within range
5. Catches trigger instant Lightning payments to player wallets

## Nostr Integration

- Relays configured in NostrProvider: damus.io, nos.lol, primal.net, nostr.wine
- Hunt events published via usePublishHunt hook
- Direct messages use NIP-04 (encrypted) and NIP-17 (group chats)

## Development Notes

### Mock Location (for testing without GPS)
Enable via DevTools button (bottom right in dev mode). Sets a fixed location for testing hunt mechanics.

### HTTPS Required
Geolocation API requires HTTPS in production. localhost works for development.

### Browser Extensions
Nostr login requires a browser extension (Alby, nos2x, etc.) or generates a local keypair.

## ESLint Custom Rules

Located in `eslint-rules/`:
- `no-placeholder-comments`: Prevents TODO/FIXME comments
- `no-inline-script`: No inline scripts in HTML
- `require-webmanifest`: PWA manifest required

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests - then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
