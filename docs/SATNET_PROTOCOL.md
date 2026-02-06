# SatNet Protocol: Deep Exploration

## Vision

A purpose-built protocol for location-based Bitcoin games that treats privacy and anti-cheat as first-class citizens, not afterthoughts.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SATNET PROTOCOL                              │
│                                                                     │
│   "What if we designed a protocol from scratch for exactly this    │
│    use case, taking the best ideas from Nostr, Lightning, zk,      │
│    and decentralized gaming?"                                       │
│                                                                     │
│   Core principles:                                                  │
│   1. Location data NEVER leaves device unencrypted                  │
│   2. Proofs, not coordinates                                        │
│   3. Economic skin-in-the-game for all participants                 │
│   4. Community-driven cheat detection and governance                │
│   5. Works offline-first, syncs when connected                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Protocol Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SATNET STACK                                │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 5: APPLICATION                                        │   │
│  │  Sat Hunter game logic, UI, creature mechanics               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 4: GOVERNANCE                                         │   │
│  │  DAO-style dispute resolution, community bans, reputation    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 3: CONSENSUS                                          │   │
│  │  Proof-of-Turn capture ordering, Lightning witness stakes    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 2: PRIVACY                                            │   │
│  │  zk-PoL proofs, E2E encryption, ephemeral IDs                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 1: TRANSPORT                                          │   │
│  │  Nostr pubsub (extended NIPs), P2P mesh, offline sync        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Transport (Extended Nostr)

### New NIPs for SatNet

- **NIP-SN01**: Hunt Announcements (metadata only)
- **NIP-SN02**: Encrypted Hunt Data Blobs
- **NIP-SN03**: Proximity Proof Events
- **NIP-SN04**: Witness Attestations
- **NIP-SN05**: Dispute Events
- **NIP-SN06**: Reputation/Ban Events
- **NIP-SN07**: P2P Mesh Coordination

### Event Kinds

| Kind  | Purpose             | Privacy                    |
|-------|---------------------|----------------------------|
| 33001 | Hunt Announcement   | Public (no location)       |
| 33002 | Encrypted Hunt Blob | E2E encrypted              |
| 33003 | Proximity Proof     | ZK proof only              |
| 33004 | Witness Attestation | Signed + Lightning receipt |
| 33005 | Capture Claim       | Hashed creature ID         |
| 33006 | Dispute             | Public accusation          |
| 33007 | Reputation Update   | Community vote result      |
| 33008 | P2P Handshake       | Ephemeral, not stored      |

### Relay Requirements

- **Standard Nostr relays**: Hunt announcements, reputation
- **SatNet-aware relays**: Proof verification, witness coordination
- **Optional**: Self-hosted relay for maximum privacy

---

## Layer 2: Privacy (SimpleX-Inspired)

### No Persistent IDs

Inspired by SimpleX's "no user IDs" approach:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    IDENTITY MODEL                                   │
│                                                                     │
│  Traditional Nostr:                                                 │
│  ├── Permanent npub identifies you everywhere                       │
│  ├── All activity linkable                                          │
│  └── Location history buildable                                     │
│                                                                     │
│  SatNet:                                                            │
│  ├── Per-hunt ephemeral keypair                                     │
│  ├── Keypair derived: hash(master_key + hunt_id)                    │
│  ├── Cannot link player across hunts                                │
│  ├── Master key only used for Lightning + reputation                │
│  └── Plausible deniability for participation                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
// Ephemeral identity per hunt
interface SatNetIdentity {
  // Master identity (used for Lightning, reputation)
  masterPubkey: string;
  masterPrivkey: string;  // Stored securely

  // Per-hunt ephemeral identity
  huntIdentities: Map<string, {
    ephemeralPubkey: string;
    ephemeralPrivkey: string;
    huntId: string;
  }>;
}

function deriveHuntIdentity(masterPrivkey: string, huntId: string) {
  // Deterministic derivation - can recreate if needed
  const seed = sha256(masterPrivkey + huntId);
  const ephemeralPrivkey = secp256k1.privateKeyFromSeed(seed);
  const ephemeralPubkey = secp256k1.publicKeyCreate(ephemeralPrivkey);

  return { ephemeralPrivkey, ephemeralPubkey };
}

// Linkability: Only host knows mapping (ephemeral → master)
// Host needs it for Lightning payouts
// But host can't prove it to anyone else
```

### Zero Metadata

| What relays see        | What they DON'T see     |
|------------------------|-------------------------|
| Hunt exists            | Hunt location           |
| N players joined       | Player real identities  |
| Proofs submitted       | Player locations        |
| Hunt ended             | Creature locations      |
| Winner announced       | Any coordinates ever    |

---

## Layer 3: Consensus (Proof-of-Turn + Lightning)

### Proof-of-Turn for Capture Ordering

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PROOF-OF-TURN CAPTURE                            │
│                                                                     │
│  Problem: Two players claim same creature simultaneously            │
│                                                                     │
│  Solution: Round-robin witness slots                                │
│                                                                     │
│  Time: |----T1----|----T2----|----T3----|----T4----|               │
│        Player A    Player B    Player C   Player A   ...            │
│        witnesses   witnesses   witnesses  witnesses                 │
│                                                                     │
│  To capture during your witness slot:                               │
│  1. Your capture has priority                                       │
│  2. Others must wait or get your witness signature                  │
│                                                                     │
│  To capture outside your slot:                                      │
│  1. Need signature from current slot holder                         │
│  2. Slot holder earns witness fee (1 sat)                           │
│  3. Creates fair ordering without central server                    │
└─────────────────────────────────────────────────────────────────────┘
```

### Lightning Witness Stakes

```typescript
interface WitnessStake {
  amount: number;           // Sats staked (e.g., 100)
  lockedUntil: number;      // Hunt end + dispute period
  pubkey: string;
  invoiceHash: string;
}

interface CaptureConsensus {
  captureId: string;
  claimer: string;

  // Witnesses who attested (staked)
  witnesses: {
    pubkey: string;
    attestation: string;
    stakeProof: string;     // Lightning payment preimage
  }[];

  // Consensus rules
  requiredWitnesses: 2;
  disputePeriod: 300;       // 5 minutes

  // Status
  status: 'pending' | 'confirmed' | 'disputed' | 'slashed';
}

// Witness gets slashed if:
// 1. Attested to capture that's later proven fraudulent
// 2. Attested without being in proximity (caught by other witnesses)
// 3. Participated in collusion (detected by pattern analysis)
```

### Consensus Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. CLAIM                                                           │
│     Player broadcasts: "I captured creature X"                      │
│     Includes: zk-PoL proof, timestamp, stake (10 sats)              │
│                                                                     │
│  2. WITNESS                                                         │
│     Nearby players (within 50m) see claim                           │
│     Witnesses broadcast: "I confirm player near creature X"         │
│     Includes: Their own zk-PoL proof, stake (10 sats)               │
│                                                                     │
│  3. CONSENSUS                                                       │
│     2+ witnesses within 30 seconds = CONFIRMED                      │
│     0-1 witnesses = PENDING (extended timer)                        │
│     Conflicting claims = DISPUTE                                    │
│                                                                     │
│  4. FINALIZATION                                                    │
│     Confirmed: Claimer receives creature reward                     │
│     Disputed: Goes to governance layer                              │
│     Timeout: Claim expires, stakes returned                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 4: Governance (DAO-Lite)

### Dispute Resolution

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DISPUTE FLOW                                     │
│                                                                     │
│  1. ACCUSATION                                                      │
│     Any player can dispute within 5 minutes                         │
│     Must stake 50 sats (anti-spam)                                  │
│     Provides evidence: conflicting proofs, timing analysis          │
│                                                                     │
│  2. JURY SELECTION                                                  │
│     5 random players from hunt (not involved in dispute)            │
│     Must have reputation score > 0.7                                │
│     Each juror stakes 20 sats                                       │
│                                                                     │
│  3. EVIDENCE PERIOD (2 minutes)                                     │
│     Both sides present evidence                                     │
│     Encrypted to jurors only                                        │
│                                                                     │
│  4. VOTING (1 minute)                                               │
│     Jurors vote: legitimate / fraudulent / unclear                  │
│     3/5 majority required                                           │
│                                                                     │
│  5. RESOLUTION                                                      │
│     Fraudulent: Cheater loses stake, accuser wins                   │
│     Legitimate: Accuser loses stake                                 │
│     Unclear: All stakes returned, no penalty                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Reputation System

```typescript
interface PlayerReputation {
  pubkey: string;           // Master pubkey (persistent)

  // Scoring
  trustScore: number;       // 0.0 - 1.0
  totalCaptures: number;
  successfulWitnesses: number;
  failedWitnesses: number;  // Slashed
  disputesWon: number;
  disputesLost: number;

  // Bans
  strikes: number;          // 3 strikes = temp ban
  permaBanned: boolean;
  banExpiry?: number;

  // Computed
  canJoinHunts: boolean;    // trustScore > 0.3 && !banned
  canWitness: boolean;      // trustScore > 0.7 && !banned
  canJury: boolean;         // trustScore > 0.8 && totalCaptures > 10
}

// Trust score calculation
function calculateTrustScore(rep: PlayerReputation): number {
  const witnessRatio = rep.successfulWitnesses /
    (rep.successfulWitnesses + rep.failedWitnesses + 1);

  const disputeRatio = rep.disputesWon /
    (rep.disputesWon + rep.disputesLost + 1);

  const activityBonus = Math.min(rep.totalCaptures / 100, 0.1);

  // Weighted combination
  return (witnessRatio * 0.4) + (disputeRatio * 0.4) + activityBonus + 0.1;
}
```

### Community Bans

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BAN MECHANICS                                    │
│                                                                     │
│  Strike 1: Warning, -0.1 trust score                                │
│  Strike 2: 24-hour ban from joining hunts                           │
│  Strike 3: 7-day ban, must re-stake to return                       │
│  Strike 4: Permanent ban (appealable after 30 days)                 │
│                                                                     │
│  Ban evidence stored immutably:                                     │
│  - Dispute records                                                  │
│  - Voting results                                                   │
│  - Timestamp + signatures                                           │
│                                                                     │
│  Appeal process:                                                    │
│  - Stake 500 sats                                                   │
│  - 10 random high-rep players vote                                  │
│  - 7/10 required to overturn                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Layer 5: Application Integration

### How Sat Hunter Uses SatNet

```typescript
// Hunt creation
async function createHunt(config: HuntConfig) {
  // 1. Generate hunt-specific encryption key
  const huntKey = generateHuntKey();

  // 2. Encrypt all location data
  const encryptedData = await encrypt(huntKey, {
    geofence: config.geofence,
    creatures: config.creatures,
    satStops: config.satStops,
  });

  // 3. Create creature commitments (for zk proofs)
  const commitments = config.creatures.map(c =>
    poseidonHash(c.location.lat, c.location.lng)
  );

  // 4. Publish to SatNet
  await satnet.publish({
    kind: 33001, // Hunt announcement
    content: JSON.stringify({
      name: config.name,
      playerCount: config.maxPlayers,
      totalSats: config.totalSats,
      // NO LOCATION DATA
    }),
    tags: [
      ['commitments', ...commitments],
      ['huntKey', encryptHuntKey(huntKey, hostPubkey)],
    ],
  });

  // 5. Hunt key distributed via QR + host approval
  // Never published to relays
}

// Player joining
async function joinHunt(huntId: string, qrData: QRPayload) {
  // 1. Derive ephemeral identity for this hunt
  const ephemeralId = deriveHuntIdentity(masterKey, huntId);

  // 2. Request join (goes to host for approval)
  await satnet.requestJoin({
    huntId,
    ephemeralPubkey: ephemeralId.pubkey,
    // Host will link to master pubkey for Lightning payout
    masterPubkeyEncrypted: encrypt(qrData.hostPubkey, masterPubkey),
  });

  // 3. On approval, receive hunt key via encrypted DM
  const huntKey = await satnet.awaitHuntKey(huntId);

  // 4. Decrypt hunt data locally
  const huntData = decrypt(huntKey, encryptedData);

  // Location data now on device, never touched relays
}

// Capturing
async function captureCreature(creature: Creature, myLocation: GeoLocation) {
  // 1. Generate zk-PoL proof
  const proof = await generateProximityProof({
    playerLocation: myLocation,      // PRIVATE, never leaves device
    creatureCommitment: creature.commitment,
    threshold: 15,                   // meters
  });

  // 2. Broadcast capture claim with proof
  const claim = await satnet.publish({
    kind: 33005, // Capture claim
    tags: [
      ['proof', proof],
      ['creature', creature.commitment],
      ['hunt', huntId],
      ['stake', await createStakeInvoice(10)],
    ],
  });

  // 3. Await witness consensus
  const consensus = await satnet.awaitConsensus(claim.id, {
    requiredWitnesses: 2,
    timeout: 30000,
  });

  if (consensus.confirmed) {
    // Creature captured!
    await claimReward(creature);
  }
}
```

---

## Privacy Analysis: What Leaks Where

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DATA FLOW ANALYSIS                               │
│                                                                     │
│  PUBLIC RELAYS SEE:                                                 │
│  ├── Hunt exists (name, sat amount, player count)                   │
│  ├── Ephemeral pubkeys participated                                 │
│  ├── Capture proofs (ZK, no coordinates)                            │
│  ├── Witness attestations (no location data)                        │
│  ├── Dispute records                                                │
│  └── Reputation updates                                             │
│                                                                     │
│  PUBLIC RELAYS NEVER SEE:                                           │
│  ├── Hunt location/geofence                                         │
│  ├── Creature coordinates                                           │
│  ├── Player locations                                               │
│  ├── Player real identities (only ephemeral)                        │
│  └── Hunt encryption keys                                           │
│                                                                     │
│  HOST SEES:                                                         │
│  ├── All of the above                                               │
│  ├── Player master pubkeys (for payouts)                            │
│  └── Who joined (but not their locations during play)               │
│                                                                     │
│  OTHER PLAYERS SEE:                                                 │
│  ├── Decrypted hunt data (after approved join)                      │
│  ├── Other players' ephemeral pubkeys                               │
│  ├── Proximity (via witness requests) - but not exact coords        │
│  └── Nothing linkable to real identities                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Bad Actor Mitigations

| Attack              | Mitigation                               | Effectiveness |
|---------------------|------------------------------------------|---------------|
| GPS Spoofing        | Witness consensus + behavioral AI        | ~85%          |
| Photo/QR Sharing    | Time-bound invites + host approval       | ~95%          |
| Screenshot Sharing  | Progressive reveal + ephemeral IDs       | ~80%          |
| Sybil (Fake Accts)  | Lightning stakes, reputation             | ~90%          |
| Witness Collusion   | Random selection, stake slashing         | ~75%          |
| Brute Force Join    | No public codes, QR + approval           | ~99%          |
| Metadata Analysis   | Ephemeral IDs, no coordinates on relay   | ~95%          |
| Replay Attacks      | Timestamps, hunt-specific proofs         | ~99%          |

**Overall Cheat Prevention: ~80-85%**

The remaining 15-20% are sophisticated attacks requiring:
- Multiple colluding real players
- Technical expertise
- Economic cost (stakes at risk)

Acceptable for casual gaming; high-stakes tournaments might need additional measures.

---

## Implementation Roadmap

### Phase 1: Foundation (Months 1-3)

- Week 1-2: Protocol specification document
- Week 3-4: NIP drafts for SatNet events
- Week 5-6: Ephemeral identity system
- Week 7-8: E2E encryption for hunt data
- Week 9-10: P2P hunt key distribution
- Week 11-12: Basic integration with existing Sat Hunter

**Deliverable**: Hunts with encrypted data, no coordinates on relays

### Phase 2: Proofs (Months 4-6)

- Week 13-14: zk-PoL circuit design
- Week 15-16: Circom implementation
- Week 17-18: Trusted setup ceremony
- Week 19-20: Client-side proof generation
- Week 21-22: Relay-side proof verification
- Week 23-24: Integration + testing

**Deliverable**: Captures verified by ZK proofs

### Phase 3: Consensus (Months 7-9)

- Week 25-26: Proof-of-Turn design
- Week 27-28: Witness protocol implementation
- Week 29-30: Lightning stake integration
- Week 31-32: Capture ordering consensus
- Week 33-34: Dispute initiation
- Week 35-36: Testing + edge cases

**Deliverable**: Decentralized capture consensus

### Phase 4: Governance (Months 10-12)

- Week 37-38: Reputation system design
- Week 39-40: Jury selection mechanism
- Week 41-42: Voting + resolution logic
- Week 43-44: Ban/appeal system
- Week 45-46: Governance UI
- Week 47-48: Full integration + beta

**Deliverable**: Complete SatNet MVP

---

## Risks & Challenges

| Risk           | Severity | Mitigation                             |
|----------------|----------|----------------------------------------|
| Scope creep    | High     | Strict phase gates, MVP focus          |
| ZK complexity  | High     | Use existing libraries, hire consultant|
| User adoption  | High     | Gradual migration, backwards compatible|
| Performance    | Medium   | Optimize proof generation, caching     |
| Relay adoption | Medium   | Self-host initially, standard Nostr fallback |
| Regulatory     | Low      | Decentralized, no custody, small amounts |

---

## Comparison: SatNet vs Alternatives

| Aspect               | Current | P2P-Inspired | Full SSB | SatNet |
|----------------------|---------|--------------|----------|--------|
| Privacy              | Low     | High         | High     | Highest|
| Spoofing prevention  | Medium  | Low          | Low      | High   |
| Photo sharing        | Low     | Medium       | Medium   | High   |
| Offline support      | Low     | Medium       | High     | High   |
| Implementation time  | Done    | 4-6 weeks    | 8-12 wks | 6-12 mo|
| Maintenance burden   | Low     | Medium       | High     | High   |
| Future extensibility | Limited | Medium       | Medium   | High   |
| Community moat       | None    | None         | None     | Strong |

---

## Assessment

SatNet is the right long-term vision but may be premature for current stage.

### Suggested Path

**NOW (Weeks 1-8):**
- Implement P2P layer (location off relays)
- Add host approval (anti-brute-force)
- Progressive reveal (anti-screenshot)
- Ship to users, get feedback

**NEXT (Months 3-6):**
- Add behavioral AI (anti-spoofing)
- Lightning witness stakes (optional)
- Validate with real usage

**LATER (Months 6-12):**
- If traction + need: Build full SatNet
- If not: P2P + AI is "good enough"
- Decision point based on real data

This lets you ship something valuable quickly while keeping SatNet as the north star.

---

## What Claude Can Build

| Component                          | Confidence | Notes                             |
|------------------------------------|------------|-----------------------------------|
| P2P layer (WebRTC + Nostr signaling) | High     | Straightforward, proven patterns  |
| E2E encryption for hunt data       | High       | Standard crypto libraries         |
| Ephemeral identity system          | High       | Key derivation is well-understood |
| Host approval flow                 | High       | UI + simple protocol              |
| Progressive reveal                 | High       | Filter creatures by distance      |
| Nostr NIP extensions (event types) | High       | Just new event kinds              |
| Behavioral analysis (accelerometer)| High       | Sensor APIs + analysis            |
| Lightning witness payments         | High       | Build on existing NWC             |
| Reputation system                  | High       | State management + storage        |
| Basic dispute flow                 | Medium     | Logic is clear, edge cases tricky |

### What's Harder

| Component                       | Confidence | Blocker                                      |
|---------------------------------|------------|----------------------------------------------|
| zk-PoL circuits (Circom)        | Medium     | Can write it, but needs expert audit         |
| Proof-of-Turn consensus         | Medium     | Novel design, edge cases unknown             |
| ML model for behavioral detection| Low       | Need real training data from actual players  |
| Trusted setup ceremony          | Cannot     | Requires multi-party computation, human coordination |
| Production security audit       | Cannot     | Need external auditor for crypto             |

### What Claude Cannot Do

- Deploy and run infrastructure
- Collect training data for ML
- Perform trusted setup ceremony
- Guarantee cryptographic security (needs audit)
- Long-term maintenance and monitoring
- Make product/business decisions for you
