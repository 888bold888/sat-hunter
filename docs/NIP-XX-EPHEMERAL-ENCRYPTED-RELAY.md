# NIP-XX: Zero-Trust Ephemeral Data Relay

`draft` `optional`

This NIP defines a protocol for relaying end-to-end encrypted data between parties when direct peer-to-peer connections fail. It uses Nostr relays as dumb pipes with **zero trust assumptions**—security is guaranteed cryptographically, not by relay cooperation.

## Motivation

WebRTC peer-to-peer connections fail in 30-40% of real-world scenarios due to NAT traversal issues. Existing solutions have privacy problems:

| Solution | Problem |
|----------|---------|
| TURN servers | Centralized operator sees metadata |
| Plain Nostr DMs | Relay sees sender/recipient pubkeys |
| Trust-based relay agreements | Unenforceable, human failure points |

This NIP provides a **zero-trust** alternative where:

- Relays learn **nothing**—not even who is talking to whom
- Security comes from **cryptography**, not relay behavior
- Relays can store data forever—it remains **permanently unreadable**
- No "please delete" or "please don't log"—we assume they do both

## Design Principles

```
1. ASSUME RELAYS ARE HOSTILE
   - They log everything
   - They store everything forever
   - They analyze all metadata
   - They collude with each other

2. MAKE HOSTILITY IRRELEVANT
   - Encrypt so they can't read
   - Use throwaway keys so they can't identify
   - Delete keys so they can't decrypt later
   - Distribute across relays so no single point of failure
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZERO-TRUST DATA FLOW                          │
│                                                                  │
│  Sender                                              Recipient   │
│    │                                                     │       │
│    │ 1. Generate throwaway keypair (T_s)                 │       │
│    │ 2. Create inner event with session key              │       │
│    │ 3. Encrypt inner to recipient's throwaway (T_r)     │       │
│    │ 4. Gift-wrap: sign outer with T_s                   │       │
│    │                                                     │       │
│    │         ┌─────────────────────────────┐             │       │
│    │         │  RELAY SEES:                │             │       │
│    │         │  from: T_s (random, single-use)           │       │
│    │         │  to:   T_r (random, single-use)           │       │
│    │         │  content: ████████████████  │             │       │
│    │         │                             │             │       │
│    │         │  CAN LEARN: nothing         │             │       │
│    │         │  CAN STORE: yes, but useless│             │       │
│    │         │  CAN DECRYPT: never         │             │       │
│    │         └─────────────────────────────┘             │       │
│    │                        │                            │       │
│    └────────────────────────┼────────────────────────────┘       │
│                             │                                    │
│                     5. Recipient's T_r                           │
│                        receives event                            │
│                     6. Unwraps outer layer                       │
│                     7. Decrypts inner payload                    │
│                     8. DELETES all keys (forward secrecy)        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Event Structure

This NIP uses a two-layer envelope structure inspired by NIP-59 (Gift Wrap).

### Layer 1: Outer Envelope (What Relay Sees)

```json
{
  "kind": 21111,
  "pubkey": "<throwaway_sender_pubkey>",
  "created_at": <random_timestamp_within_2_days>,
  "content": "<encrypted_inner_event>",
  "tags": [
    ["p", "<throwaway_recipient_pubkey>"]
  ],
  "id": "<event_id>",
  "sig": "<signature_by_throwaway_key>"
}
```

**Key properties:**
- `pubkey`: Fresh throwaway key, used once, then deleted
- `created_at`: Randomized ±48 hours to prevent timing correlation
- `tags.p`: Recipient's throwaway key (not their real identity)
- `content`: Encrypted blob—relay cannot parse structure

### Layer 2: Inner Event (Encrypted Payload)

```json
{
  "kind": 21112,
  "pubkey": "<sender_session_pubkey>",
  "created_at": <actual_timestamp>,
  "content": "<encrypted_application_data>",
  "tags": [
    ["session", "<session_id>"],
    ["seq", "<sequence_number>"],
    ["ack", "<last_received_seq>"]
  ]
}
```

**Key properties:**
- `pubkey`: Session pubkey (ephemeral per-session, but consistent within session)
- `content`: Application data encrypted with session key
- `session`: Links messages within a session
- `seq`: Ordering and deduplication
- `ack`: Optional acknowledgment for reliability

## Cryptographic Protocol

### Key Hierarchy

```
Master Key (long-term, never transmitted)
    │
    ├── Session Key (derived per session, deleted after)
    │       │
    │       └── Message Keys (derived per message, immediate deletion)
    │
    └── Throwaway Keys (random per message, immediate deletion)
```

### Key Derivation

```typescript
// Session establishment (one-time per session)
function deriveSessionKey(
  myMasterPrivkey: Uint8Array,
  theirSessionPubkey: Uint8Array,
  sessionId: string
): Uint8Array {
  const sharedSecret = ecdh(myMasterPrivkey, theirSessionPubkey);
  return hkdf(
    ikm: sharedSecret,
    salt: sha256(sessionId),
    info: "nip-xx-session-v1",
    length: 32
  );
}

// Per-message key (forward secrecy)
function deriveMessageKey(
  sessionKey: Uint8Array,
  sequenceNumber: number
): Uint8Array {
  return hkdf(
    ikm: sessionKey,
    salt: uint64ToBytes(sequenceNumber),
    info: "nip-xx-message-v1",
    length: 32
  );
}
```

### Encryption Layers

**Layer 2 (Inner) Encryption:**
```
algorithm: XChaCha20-Poly1305
key: messageKey (derived from sessionKey + sequence)
nonce: random 24 bytes
plaintext: JSON-serialized inner event
ciphertext: nonce || encrypted || auth_tag
```

**Layer 1 (Outer) Encryption:**
```
algorithm: XChaCha20-Poly1305
key: ECDH(throwaway_sender_privkey, throwaway_recipient_pubkey)
nonce: random 24 bytes
plaintext: layer 2 ciphertext
ciphertext: nonce || encrypted || auth_tag
```

### Forward Secrecy Protocol

```typescript
class ForwardSecureChannel {
  private sessionKey: Uint8Array;
  private sequenceNumber: number = 0;

  async send(data: object): Promise<void> {
    // 1. Derive message key
    const messageKey = deriveMessageKey(this.sessionKey, this.sequenceNumber++);

    // 2. Encrypt inner event
    const innerCiphertext = encrypt(messageKey, JSON.stringify({
      kind: 21112,
      content: JSON.stringify(data),
      // ... other fields
    }));

    // 3. Generate throwaway keypair (RANDOM, not derived)
    const throwaway = generateKeypair();

    // 4. Encrypt outer envelope to recipient's throwaway
    const outerKey = ecdh(throwaway.privkey, this.recipientThrowaway);
    const outerCiphertext = encrypt(outerKey, innerCiphertext);

    // 5. Build and sign outer event
    const outerEvent = finalizeEvent({
      kind: 21111,
      content: base64Encode(outerCiphertext),
      tags: [["p", this.recipientThrowaway]],
      created_at: randomizeTimestamp(),
    }, throwaway.privkey);

    // 6. Publish to multiple relays
    await Promise.allSettled(
      this.relays.map(r => r.publish(outerEvent))
    );

    // 7. IMMEDIATELY DELETE throwaway key
    throwaway.privkey.fill(0);
    messageKey.fill(0);
  }
}
```

## Session Establishment

Before data relay, parties must exchange throwaway pubkeys through a secure channel.

### Option A: Via QR Code / Share Code

```
QR/Share code contains:
{
  "huntId": "abc123",
  "hostSessionPubkey": "02...",
  "hostThrowawayPubkey": "03...",  // For first message
  "relays": ["wss://relay1", "wss://relay2"]
}

Player generates their own throwaway and includes it in first message.
```

### Option B: Via Initial P2P (When It Works)

```
1. Attempt WebRTC P2P connection
2. If successful: exchange data directly (preferred)
3. If fails after 10s: exchange throwaway pubkeys via signaling
4. Fall back to relay-based data transfer
```

### Option C: Via NIP-17 Private DM (Bootstrap)

```
1. Player sends NIP-17 DM to host with their throwaway pubkey
2. Host responds with their throwaway pubkey
3. Subsequent data uses kind 21111 (this NIP)
```

## Relay Requirements

### What Relays MUST Do

| Requirement | Reason |
|-------------|--------|
| Accept kind 21111 events | Standard event handling |
| Forward to subscribers of `#p` tag | Standard subscription |

### What Relays MAY Do (We Don't Care)

| Behavior | Impact on Security |
|----------|-------------------|
| Store events forever | None—encrypted, keys deleted |
| Log all events | None—only throwaway keys visible |
| Analyze traffic patterns | Minimal—timestamps randomized |
| Refuse to delete | None—we never asked them to |
| Share data with others | None—it's all encrypted noise |

### What Relays CANNOT Do

| Attack | Why It Fails |
|--------|--------------|
| Read message content | Encrypted with keys they don't have |
| Identify sender | Throwaway key, used once, deleted |
| Identify recipient | Throwaway key, unlinkable to identity |
| Decrypt stored messages later | Forward secrecy—keys deleted |
| Correlate messages in session | Different throwaway keys per message |
| Prove who talked to whom | No linkable identifiers |

## Privacy Analysis

### What Different Attackers Learn

**Single Relay Operator:**
```
Sees: random_pubkey_1 -> random_pubkey_2, encrypted blob
Learns: Someone sent something to someone
Cannot: Link to identities, read content, correlate sessions
```

**All Relays Colluding:**
```
Sees: Same as single relay, across all relays
Learns: Traffic volume between throwaway keys
Cannot: Still can't link to identities or read content
Additional risk: May correlate timing across relays (mitigated by timestamp randomization)
```

**Network-Level Attacker (ISP):**
```
Sees: Connections to relay IP addresses
Learns: User connects to Nostr relays
Cannot: See event content (TLS), link events to users
Additional risk: Timing correlation with network traffic
```

**Future Attacker (Stored Ciphertext):**
```
Has: Encrypted blobs from relays
Learns: Nothing
Cannot: Decrypt—forward secrecy means keys no longer exist
Even if: Quantum computers break ECDH, per-message keys were symmetric
```

## Example Implementation

### Sender

```typescript
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { secp256k1 } from '@noble/curves/secp256k1';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/ciphers/webcrypto';

async function sendZeroTrust(
  payload: object,
  sessionKey: Uint8Array,
  sequenceNumber: number,
  recipientThrowaway: string,
  relays: string[]
): Promise<void> {
  // 1. Derive per-message key (forward secrecy)
  const messageKey = hkdf(sha256, sessionKey,
    uint64ToBytes(sequenceNumber), 'nip-xx-message-v1', 32);

  // 2. Build inner event
  const innerEvent = {
    kind: 21112,
    pubkey: mySessionPubkey,
    created_at: Math.floor(Date.now() / 1000),
    content: JSON.stringify(payload),
    tags: [
      ['session', sessionId],
      ['seq', String(sequenceNumber)],
    ],
  };

  // 3. Encrypt inner event
  const innerNonce = randomBytes(24);
  const innerCipher = xchacha20poly1305(messageKey, innerNonce);
  const innerCiphertext = concatBytes(
    innerNonce,
    innerCipher.encrypt(new TextEncoder().encode(JSON.stringify(innerEvent)))
  );

  // 4. Generate throwaway keypair
  const throwawayPrivkey = randomBytes(32);
  const throwawayPubkey = bytesToHex(secp256k1.getPublicKey(throwawayPrivkey, true));

  // 5. Derive outer encryption key
  const outerSharedSecret = secp256k1.getSharedSecret(
    throwawayPrivkey,
    hexToBytes(recipientThrowaway)
  );
  const outerKey = sha256(outerSharedSecret.slice(1));

  // 6. Encrypt outer envelope
  const outerNonce = randomBytes(24);
  const outerCipher = xchacha20poly1305(outerKey, outerNonce);
  const outerCiphertext = concatBytes(
    outerNonce,
    outerCipher.encrypt(innerCiphertext)
  );

  // 7. Build outer event with randomized timestamp
  const randomOffset = Math.floor(Math.random() * 172800) - 86400; // ±24 hours
  const outerEvent = finalizeEvent({
    kind: 21111,
    created_at: Math.floor(Date.now() / 1000) + randomOffset,
    content: bytesToBase64(outerCiphertext),
    tags: [['p', recipientThrowaway]],
  }, throwawayPrivkey);

  // 8. Publish to multiple relays
  await Promise.allSettled(relays.map(r => publishToRelay(r, outerEvent)));

  // 9. CRITICAL: Securely delete keys
  throwawayPrivkey.fill(0);
  messageKey.fill(0);
  outerKey.fill(0);
}
```

### Receiver

```typescript
async function receiveZeroTrust(
  event: NostrEvent,
  myThrowawayPrivkey: Uint8Array,
  sessionKey: Uint8Array
): Promise<{ payload: object; seq: number }> {
  // 1. Derive outer decryption key
  const senderThrowaway = event.pubkey;
  const outerSharedSecret = secp256k1.getSharedSecret(
    myThrowawayPrivkey,
    hexToBytes(senderThrowaway)
  );
  const outerKey = sha256(outerSharedSecret.slice(1));

  // 2. Decrypt outer layer
  const outerCiphertext = base64ToBytes(event.content);
  const outerNonce = outerCiphertext.slice(0, 24);
  const outerEncrypted = outerCiphertext.slice(24);
  const outerCipher = xchacha20poly1305(outerKey, outerNonce);
  const innerCiphertext = outerCipher.decrypt(outerEncrypted);

  // 3. Parse inner ciphertext
  const innerNonce = innerCiphertext.slice(0, 24);
  const innerEncrypted = innerCiphertext.slice(24);

  // 4. Extract sequence number from inner event to derive correct key
  // (In practice, try recent sequence numbers or include hint)
  const seq = extractSequenceHint(event); // Implementation-specific
  const messageKey = hkdf(sha256, sessionKey,
    uint64ToBytes(seq), 'nip-xx-message-v1', 32);

  // 5. Decrypt inner event
  const innerCipher = xchacha20poly1305(messageKey, innerNonce);
  const innerPlaintext = innerCipher.decrypt(innerEncrypted);
  const innerEvent = JSON.parse(new TextDecoder().decode(innerPlaintext));

  // 6. Extract payload
  const payload = JSON.parse(innerEvent.content);

  // 7. Securely delete keys
  messageKey.fill(0);
  outerKey.fill(0);

  return { payload, seq };
}
```

## Throwaway Key Rotation

For ongoing communication, recipient must provide new throwaway keys:

```typescript
// Include next throwaway in each message
const innerEvent = {
  kind: 21112,
  content: JSON.stringify(payload),
  tags: [
    ['session', sessionId],
    ['seq', String(seq)],
    ['next_throwaway', nextThrowawayPubkey], // For sender's next message
  ],
};
```

This ensures:
- Each message uses fresh throwaway keys
- Relay cannot correlate consecutive messages
- Compromise of one throwaway doesn't affect others

## Multi-Relay Strategy

```typescript
const RELAY_STRATEGY = {
  // Send to multiple relays for reliability
  sendRelays: ['wss://relay1.com', 'wss://relay2.com', 'wss://relay3.com'],

  // Subscribe to all for receiving
  receiveRelays: ['wss://relay1.com', 'wss://relay2.com', 'wss://relay3.com'],

  // Success criteria
  minRelaysForSend: 2,  // At least 2 must accept

  // Deduplication
  seenEvents: new Set<string>(),  // By event ID
};
```

## Use Cases

1. **Location-based games**: Relay hunt coordinates when P2P fails
2. **Private file sharing**: Send files through hostile infrastructure
3. **Whistleblowing**: Communicate without metadata leakage
4. **IoT data relay**: Sensor data through untrusted networks

## Security Considerations

### Sequence Number Management

Receivers must track sequence numbers to:
- Derive correct message keys
- Detect replay attacks
- Handle out-of-order delivery

### Throwaway Key Storage

Receivers must temporarily store throwaway privkeys to decrypt incoming messages:
- Store in memory only, never persist
- Delete immediately after decryption
- Rotate frequently

### Session Key Compromise

If a session key is compromised:
- Future messages in that session are at risk
- Past messages remain safe (forward secrecy from message keys)
- Other sessions are unaffected
- Mitigation: Keep sessions short, rotate frequently

### Relay Availability

If all relays go offline:
- Data cannot be relayed
- Mitigation: Use diverse relay set, have P2P fallback

## Comparison to Alternatives

| Aspect | TURN | NIP-04 DM | NIP-17 Gift Wrap | This NIP |
|--------|------|-----------|------------------|----------|
| Content private | Yes | Yes | Yes | Yes |
| Metadata private | No | No | Partial | **Yes** |
| Forward secrecy | No | No | No | **Yes** |
| Zero relay trust | No | No | No | **Yes** |
| Works if stored | N/A | Yes | Yes | **Yes** |
| Correlation resistant | No | No | Partial | **Yes** |

## References

- [NIP-01: Basic Protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-04: Encrypted Direct Message](https://github.com/nostr-protocol/nips/blob/master/04.md)
- [NIP-17: Private Direct Messages](https://github.com/nostr-protocol/nips/blob/master/17.md)
- [NIP-44: Versioned Encryption](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [NIP-59: Gift Wrap](https://github.com/nostr-protocol/nips/blob/master/59.md)
- [Signal Protocol: Forward Secrecy](https://signal.org/docs/specifications/doubleratchet/)
- [SimpleX: No User Identifiers](https://simplex.chat/docs/protocol.html)
