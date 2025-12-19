# NIP-SAT-HUNTER

## Sat Hunter - Location-Based Bitcoin Scavenger Hunts

`draft` `optional`

This NIP defines the event kinds used by Sat Hunter for creating and sharing location-based Bitcoin scavenger hunt events.

## Event Kinds

### Hunt Event (kind 32959)

A parameterized replaceable event that represents a scavenger hunt event. The `d` tag contains the hunt's unique identifier (share code).

**Example:**

```json
{
  "kind": 32959,
  "content": "{\"description\":\"Find Bitcoin in downtown!\",\"geoFence\":{\"center\":{\"lat\":37.7749,\"lng\":-122.4194},\"bounds\":{\"north\":37.7799,\"south\":37.7699,\"east\":-122.4144,\"west\":-122.4244},\"radiusMeters\":500},\"monsters\":[...],\"satStops\":[...]}",
  "tags": [
    ["d", "ABC123"],
    ["title", "Downtown Bitcoin Hunt"],
    ["total_sats", "100000"],
    ["monster_count", "50"],
    ["start_time", "1703001600"],
    ["end_time", "1703005200"],
    ["status", "active"],
    ["payment_status", "paid"],
    ["g", "9q8yy"]
  ]
}
```

#### Required Tags

- `d` - Hunt share code (6-character identifier)
- `title` - Hunt name
- `total_sats` - Total satoshis deployed in the hunt
- `monster_count` - Number of creatures to spawn
- `start_time` - Unix timestamp when hunt begins
- `end_time` - Unix timestamp when hunt ends
- `status` - Hunt status: `draft`, `pending_payment`, `ready`, `active`, or `ended`
- `payment_status` - Payment status: `pending`, `paid`, `failed`, or `expired`

#### Optional Tags

- `g` - Geohash of hunt center location (for discovery)
- `bolt11` - Lightning invoice for hunt funding
- `payment_hash` - Payment hash for verification
- `image` - Hunt image/banner URL

#### Content Field

JSON object containing:
- `description` - Hunt description
- `geoFence` - Geographic boundary with center, bounds, and radius
- `monsters` - Array of monster spawns with locations and sat amounts
- `satStops` - Array of collection points for SatBalls

### Monster Capture Event (kind 1)

A regular text note event announcing a successful monster capture. Uses standard kind 1 with custom tags.

**Example:**

```json
{
  "kind": 1,
  "content": "Caught a Pisatchu! ⚡👑 Earned 5000 sats in the Downtown Bitcoin Hunt!",
  "tags": [
    ["t", "sathunter"],
    ["hunt", "ABC123"],
    ["monster_type", "pisatchu"],
    ["monster_rarity", "mythic"],
    ["sats_earned", "5000"]
  ]
}
```

#### Tags for Capture Events

- `t` - Tag with value "sathunter" for filtering
- `hunt` - Hunt share code (d tag value of the hunt event)
- `monster_type` - Type of monster captured (e.g., "pisatchu", "ratasat")
- `monster_rarity` - Rarity tier: `common`, `uncommon`, `rare`, `legendary`, or `mythic`
- `sats_earned` - Amount of satoshis earned from capture

## Monster Types

Sat Hunter features exactly **11 predefined creature types**:

### Common (3 types)
- Ratasat
- Saterpie
- Satgey

### Uncommon (2 types)
- Mesatpod
- Satgeotto

### Rare (2 types)
- Saterfree
- Satgeot

### Legendary (3 types)
- Bulsatba
- Satmander
- Saturtle

### Mythic (1 type)
- Pisatchu (always spawns exactly once per hunt with highest sat value)

## Spawn Mechanics

- **Mythic**: Exactly 1 spawn per hunt (~1% of total)
- **Legendary**: ~9% of total spawns
- **Rare**: ~15% of total spawns
- **Uncommon**: ~25% of total spawns
- **Common**: ~50% of total spawns (most abundant)

Sat values are distributed hierarchically: common < uncommon < rare < legendary < mythic.

## Privacy Considerations

- Player locations are not published to Nostr
- Only the hunt configuration and captures are shared publicly
- Host can see participant locations only within their client session
- All location data remains client-side

## Implementation Notes

Clients implementing Sat Hunter should:
1. Query for hunt events using kind 32959 with geohash filters for discovery
2. Validate payment_status before allowing players to join
3. Use high-accuracy GPS for location tracking
4. Implement 3-meter visibility range for creature discovery
5. Only spawn exactly 1 Pisatchu (mythic) per hunt
