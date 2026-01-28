# Phase 2 Security Implementation Plan

> Last updated: 2026-01-27

## Summary

Implement four security features to protect Sat Hunter from location spoofing, ensure player privacy, and give hosts control over their hunts.

**Current State:** P2P is already the default! `usePublishHunt.ts` strips location data from Nostr events and sets `p2p: required`. The foundation is in place.

---

## Phase 2A: Host Approval System (Priority 1)

**Goal:** Give hosts control over who joins their hunt.

### New Nostr Event Kinds

**Kind 32962: Join Request**
```json
{
  "kind": 32962,
  "content": "{\"message\": \"optional\"}",
  "tags": [
    ["d", "join-{shareCode}-{playerPubkeyShort}"],
    ["e", "{huntId}"],
    ["p", "{hostPubkey}"],
    ["hunt_code", "{shareCode}"],
    ["status", "pending"]
  ]
}
```

**Kind 32963: Join Response**
```json
{
  "kind": 32963,
  "content": "{\"reason\": \"optional rejection reason\"}",
  "tags": [
    ["d", "response-{shareCode}-{playerPubkeyShort}"],
    ["e", "{huntId}"],
    ["p", "{playerPubkey}"],
    ["decision", "approved"]
  ]
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/gameTypes.ts` | Add `requiresApproval: boolean` to `HuntEvent` |
| `src/hooks/useJoinRequest.ts` | **NEW** - Publish join request, subscribe to response |
| `src/hooks/useHostApprovals.ts` | **NEW** - Fetch pending requests, approve/reject |
| `src/pages/JoinHuntPage.tsx` | Add approval flow: show "Request to Join" when `requiresApproval` |
| `src/components/game/HostDashboard.tsx` | Add "Pending Requests" section with approve/reject buttons |
| `src/components/game/CreateHuntForm.tsx` | Add toggle: "Require approval to join" |
| `src/hooks/usePublishHunt.ts` | Add `requires_approval` tag to hunt event |

### Player Join Flow (with approval)

```
1. Player scans QR / enters code
2. Hunt metadata displayed (name, sats, duration)
3. "Request to Join" button shown
4. Player clicks -> Kind 32962 published
5. Player sees "Waiting for host approval..."
6. Host sees request in dashboard
7. Host approves -> Kind 32963 published
8. Player's app detects response
9. P2P connection established
10. Player receives location data
```

---

## Phase 2B: Progressive Creature Reveal (Priority 2)

**Goal:** Prevent screenshots showing exact creature locations.

### Distance Tiers

| Distance | Visibility | Displayed Info |
|----------|------------|----------------|
| 200m+ | Hidden | Not visible |
| 150-200m | Silhouette | Grey blur, "?" |
| 75-150m | Type | Emoji only |
| 30-75m | Identity | Name + rarity |
| 15-30m | Full | + sat amount |
| 0-15m | Catchable | + catch button |

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/gameTypes.ts` | Add `CreatureVisibility` type, `VisibleCreature` interface |
| `src/lib/gameUtils.ts` | Add `getCreatureVisibility(distance)`, `getVisibleCreatures(playerLoc, monsters)` |
| `src/contexts/GameContext.tsx` | Change visibility from fixed 15m to tiered calculation |
| `src/components/game/HuntMap.tsx` | Render markers differently based on visibility tier |
| `src/index.css` | Add `.monster-marker.silhouette`, `.catchable` animations |

### Implementation

```typescript
// gameUtils.ts
type CreatureVisibility = 'hidden' | 'silhouette' | 'type' | 'identity' | 'full' | 'catchable';

function getCreatureVisibility(distance: number): CreatureVisibility {
  if (distance > 200) return 'hidden';
  if (distance > 150) return 'silhouette';
  if (distance > 75) return 'type';
  if (distance > 30) return 'identity';
  if (distance > 15) return 'full';
  return 'catchable';
}
```

---

## Phase 2C: Accelerometer Anti-Spoofing (Priority 3)

**Goal:** Require physical device movement to validate location changes.

### Files to Create/Modify

| File | Changes |
|------|---------|
| `src/lib/motionTracking.ts` | **NEW** - DeviceMotionEvent handler, movement analysis |
| `src/lib/antiCheat.ts` | Add motion component to trust score (20% weight) |
| `src/hooks/useAntiCheat.ts` | Integrate motion tracker, add to capture validation |
| `src/pages/JoinHuntPage.tsx` | Request motion permission on join |

### Trust Score Update

```typescript
// antiCheat.ts - update breakdown
const composite = Math.round(
  breakdown.location * 0.25 +
  breakdown.environment * 0.25 +
  breakdown.velocity * 0.20 +
  breakdown.history * 0.10 +
  breakdown.motion * 0.20  // NEW
);
```

### Motion Tracking Logic

- Track acceleration/rotation via DeviceMotionEvent
- If player moved 50+ meters but no sensor activity detected -> flag
- iOS 13+ requires permission request from user gesture
- Desktop browsers without sensors: skip motion check (not penalized)

---

## Implementation Order

```
Phase 2A: Host Approval     (1-2 days)
    ↓
Phase 2B: Progressive Reveal (1 day)
    ↓
Phase 2C: Accelerometer     (1 day)
```

**Rationale:**
- Host Approval is most requested feature for private hunts
- Progressive Reveal prevents screenshot-based cheating
- Accelerometer enhances existing anti-cheat

---

## Testing Strategy

### Phase 2A Tests
- Create hunt with `requiresApproval: true`
- Join as another user, verify request appears in host dashboard
- Approve/reject, verify player notification
- Verify P2P connection only after approval

### Phase 2B Tests
- Mock location at various distances from creature
- Verify correct visibility tier displayed
- Verify catch button only appears at 15m

### Phase 2C Tests
- Move phone while walking, verify sensor activity detected
- Keep phone still while location changes, verify flag raised
- Test on desktop (no sensors), verify no penalty

### Verification Commands
```bash
npm run test   # Run full test suite
npm run dev    # Test manually with mock location
```

---

## Backwards Compatibility

- Existing hunts have `requiresApproval: false` (default)
- Old clients can still join non-approval hunts
- Progressive reveal is host-side, benefits all players
- Motion check is optional enhancement

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Host offline during approval | Clear message: "Host must be online to approve" |
| Motion permission denied | Allow gameplay, just lower trust score |
| P2P connection fails | Retry with exponential backoff, helpful error messages |
