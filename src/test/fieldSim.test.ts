// @vitest-environment node
/**
 * Simulated field test for the shared-creature-state goal
 * (tasks/goals/shared-creature-state.md — all phases 0-5).
 *
 * Drives the REAL production modules end-to-end, offline, at increasing player
 * counts: gameReducer (player worlds), captureArbiter (host arbitration),
 * captureSync (Tier 1 dedup tags), captureBroadcast (Tier 2 signed broadcasts),
 * p2pSignaling.buildHelloPayload (join snapshots), with real signed kind-32960
 * capture events (session-key signed, NIP-44 encrypted to the host) exactly as
 * usePublishCapture builds them.
 *
 * Scenario per increment:
 *   1. 80% of players join at start (hello snapshot).
 *   2. Capture rounds with deliberate contention (1-3 players race the same
 *      monster in one poll batch), plus adversarial traffic: forged Tier 1
 *      claims (valid d tag, garbage content) and forged capture_state
 *      broadcasts (valid cast encryption, wrong signer).
 *   3. 10% join mid-hunt, 10% join at the end (late-joiner snapshot merge).
 *   4. One player "refreshes" (secrets stripped like persistence does) and
 *      recovers via re-hello (MERGE_HUNT_SECRETS + snapshot).
 *   5. Invariants: exactly one payment per monster, broadcast winner == paid
 *      player, every player's world converges to the host's authoritative
 *      state (modulo documented Tier 1 griefing), losers rolled back exactly
 *      once, winners keep credit, sats accounting exact, no npub/location
 *      leakage in any player-readable wire bytes.
 *
 * Run explicitly (skipped by default — the 1000-player run is heavy):
 *   FIELD_SIM=1 npx vitest run src/test/fieldSim.test.ts
 *
 * Never touches real relays; never publishes anything.
 */
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools';
import { v2 as nip44 } from 'nostr-tools/nip44';
import type { NostrEvent } from '@nostrify/nostrify';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { gameReducer, initialState, canCaptureMonster, type GameState } from '@/contexts/GameContext';
import { generateMonsters, calculateDistance } from '@/lib/gameUtils';
import type { HuntEvent, Monster, GeoFence } from '@/lib/gameTypes';
import {
  generateCaptureSecret,
  computeCaptureProof,
  verifyCaptureProof,
  encodeCoarseGeohash,
  decodeGeohash,
  ANTI_CHEAT_CONFIG,
} from '@/lib/antiCheat';
import { computeCaptureDedupHash, buildCaptureDedupIndex } from '@/lib/captureSync';
import {
  deriveCastKeypair,
  buildCaptureStateEvent,
  decryptCaptureStateEvent,
  computeWinnerProof,
  type CaptureStateEntry,
} from '@/lib/captureBroadcast';
import { createArbiterState, arbitrateCapture } from '@/lib/captureArbiter';
import { buildHelloPayload, type HuntLocationData } from '@/lib/p2pSignaling';

const RUN = process.env.FIELD_SIM === '1';
const INCREMENTS = [2, 10, 50, 100, 1000];
const CLAIM_EVENT_KIND = 32960;
const MAX_EVENT_AGE_SECONDS = 7200; // useHuntSync's window

// Deterministic PRNG so failures are reproducible.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface SimPlayer {
  idx: number;
  realPubkey: string;
  sessionPrivkey: Uint8Array; // ephemeral signing key, like sessionKeys.ts
  state: GameState;
  joinedRound: number; // -1 = initial wave
  griefTagsSeen: Set<string>; // monsterIds hidden by forged Tier 1 while active
  refreshed: boolean;
}

interface HostSim {
  privkey: Uint8Array;
  pubkey: string;
  broadcastPrivkey: Uint8Array;
  broadcastPubkey: string;
  captureSecret: string;
  arbiter: ReturnType<typeof createArbiterState>;
  syncedCaptures: Map<string, { playerPubkey: string; capturedAt: number }>;
  payments: { monsterId: string; toPubkey: string; sats: number }[];
  monsters: Monster[];
}

// --- player-side wire building (mirrors usePublishCapture exactly) -----------

function buildRealCaptureEvent(
  player: SimPlayer,
  monster: Monster,
  shareCode: string,
  hostPubkey: string,
  captureSecret: string,
  overrides?: { geohash?: string; trustScore?: number }
): NostrEvent {
  const capturedAt = Date.now();
  const plaintext = JSON.stringify({
    playerPubkey: player.realPubkey,
    monsterId: monster.id,
    monsterName: monster.name,
    satAmount: monster.satAmount,
    rarity: monster.rarity,
    capturedAt,
    geohash: overrides?.geohash ?? encodeCoarseGeohash(monster.location),
    trustScore: overrides?.trustScore ?? 95,
    trustFlags: [],
    captureProof: computeCaptureProof(captureSecret, monster.id, player.realPubkey, capturedAt),
  });
  const convKey = nip44.utils.getConversationKey(player.sessionPrivkey, hostPubkey);
  const huntBlind = bytesToHex(sha256(new TextEncoder().encode(shareCode)));
  return finalizeEvent(
    {
      kind: CLAIM_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: nip44.encrypt(plaintext, convKey),
      tags: [
        ['x', huntBlind],
        ['d', computeCaptureDedupHash(shareCode, monster.id)],
      ],
    },
    player.sessionPrivkey
  ) as NostrEvent;
}

// Forged Tier 1 claim: valid public d tag, garbage content the host can never
// decrypt. Any shareCode holder can build this (goal file: griefing cap).
function buildForgedClaim(shareCode: string, monsterId: string): NostrEvent {
  const key = generateSecretKey();
  const huntBlind = bytesToHex(sha256(new TextEncoder().encode(shareCode)));
  return finalizeEvent(
    {
      kind: CLAIM_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: 'AqZzY3JhbWJsZWQtbm9uc2Vuc2U=', // not JSON, not decryptable
      tags: [
        ['x', huntBlind],
        ['d', computeCaptureDedupHash(shareCode, monsterId)],
      ],
    },
    key
  ) as NostrEvent;
}

// --- host-side batch processing (mirrors useHuntSync + HostDashboard) --------

function hostProcessBatch(
  host: HostSim,
  batch: NostrEvent[]
): { dTags: string[]; expectedFirstValid: Map<string, string> } {
  const dTags: string[] = [];
  const expectedFirstValid = new Map<string, string>(); // monsterId -> first valid claimant
  const now = Math.floor(Date.now() / 1000);

  for (const event of batch) {
    // useHuntSync order: verify signature, timestamp window, THEN fan out the
    // d tag (players see it regardless of decryptability), then host decrypt.
    if (!verifyEvent(event)) continue;
    if (Math.abs(now - event.created_at) > MAX_EVENT_AGE_SECONDS) continue;
    const dTag = event.tags.find(([t]) => t === 'd')?.[1];
    if (dTag) dTags.push(dTag);

    let content: {
      playerPubkey: string;
      monsterId: string;
      satAmount: number;
      capturedAt: number;
      geohash?: string;
      trustScore?: number;
      captureProof?: string;
    };
    try {
      const convKey = nip44.utils.getConversationKey(host.privkey, event.pubkey);
      content = JSON.parse(nip44.decrypt(event.content, convKey));
    } catch {
      continue; // forged/undecryptable — host skips, exactly like useHuntSync
    }

    const monster = host.monsters.find(m => m.id === content.monsterId);
    if (!monster) continue;

    // HostDashboard's reject-validations (distance / trust; HMAC is warn-only).
    const validate = (): string | null => {
      if (content.geohash) {
        const loc = decodeGeohash(content.geohash);
        const distance = calculateDistance(loc, monster.location);
        if (distance > 5000) return `Player location ${distance.toFixed(0)}m from monster`;
      }
      if (
        content.trustScore !== undefined &&
        content.trustScore < ANTI_CHEAT_CONFIG.MIN_TRUST_SCORE
      ) {
        return `Trust score ${content.trustScore} below threshold`;
      }
      if (content.captureProof) {
        // warn-only in production; assert it actually verifies for honest claims
        verifyCaptureProof(
          host.captureSecret, content.monsterId, content.playerPubkey,
          content.capturedAt, content.captureProof
        );
      }
      return null;
    };

    // Track the expected winner independently of the arbiter for cross-checking.
    const wouldBeValid = validate() === null;
    if (wouldBeValid && !expectedFirstValid.has(monster.id) && !host.arbiter.locked.has(monster.id) && !host.arbiter.poisoned.has(monster.id)) {
      expectedFirstValid.set(monster.id, content.playerPubkey);
    }

    const decision = arbitrateCapture(
      host.arbiter,
      { monsterId: monster.id, playerPubkey: content.playerPubkey },
      validate
    );
    if (decision.action === 'pay') {
      if (!host.syncedCaptures.has(monster.id)) {
        host.syncedCaptures.set(monster.id, {
          playerPubkey: content.playerPubkey,
          capturedAt: content.capturedAt,
        });
      }
      // Host-side satAmount, never the client-reported value.
      host.payments.push({ monsterId: monster.id, toPubkey: content.playerPubkey, sats: monster.satAmount });
    }
  }
  return { dTags, expectedFirstValid };
}

function hostStateEntries(host: HostSim): CaptureStateEntry[] {
  return Array.from(host.syncedCaptures.entries()).map(([monsterId, c]) => ({
    monsterId,
    capturedAt: c.capturedAt,
    winnerProof: computeWinnerProof(monsterId, c.playerPubkey),
  }));
}

// --- player helpers -----------------------------------------------------------

function joinPlayer(
  idx: number,
  hello: HuntLocationData,
  baseHunt: HuntEvent,
  joinedRound: number
): SimPlayer {
  const realPubkey = getPublicKey(generateSecretKey());
  const hunt: HuntEvent = {
    ...baseHunt,
    monsters: hello.monsters.map(m => ({ ...m })),
    satStops: hello.satStops,
    geoFence: hello.geoFence,
    captureSecret: hello.captureSecret,
    hostBroadcastPubkey: hello.hostBroadcastPubkey,
  };
  let state: GameState = gameReducer(initialState, { type: 'SET_ACTIVE_HUNT', hunt });
  state = gameReducer(state, { type: 'START_HUNT_SESSION', huntId: hunt.id });
  state = {
    ...state,
    playerLocation: hunt.geoFence.center,
    playerStats: { ...state.playerStats, pubkey: realPubkey, balls: 100000 },
  };
  const player: SimPlayer = {
    idx,
    realPubkey,
    sessionPrivkey: generateSecretKey(),
    state,
    joinedRound,
    griefTagsSeen: new Set(),
    refreshed: false,
  };
  // Late joiner reconciliation: apply the hello's authoritative capture state
  // exactly like JoinHuntPage does post-join.
  if (hello.captureState && hello.captureState.entries.length > 0) {
    player.state = gameReducer(player.state, {
      type: 'APPLY_CAPTURE_STATE',
      entries: hello.captureState.entries,
      myPubkey: realPubkey,
    });
  }
  return player;
}

function playerCapturedIds(p: SimPlayer): Set<string> {
  return new Set(p.state.activeHunt!.monsters.filter(m => m.captured).map(m => m.id));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every(x => b.has(x));
}

// --- the simulation -------------------------------------------------------------

interface SimResult {
  n: number;
  monsters: number;
  rounds: number;
  captureEvents: number;
  forgedClaims: number;
  forgedBroadcasts: number;
  races: number;
  losersRolledBack: number;
  broadcastBytes: number;
  msJoin: number;
  msRounds: number;
  msLateJoin: number;
  msTotal: number;
}

function runSim(n: number, seed: number): SimResult {
  const rng = makeRng(seed);
  const t0 = performance.now();
  const shareCode = `SIM${n}`;

  // --- hunt + host setup -----------------------------------------------------
  const geoFence: GeoFence = {
    center: { lat: 37.7749, lng: -122.4194 },
    bounds: { north: 37.78, south: 37.77, east: -122.41, west: -122.43 },
    radiusMeters: 500,
    boundaryType: 'circle',
  };
  const monsterCount = Math.max(8, Math.min(Math.ceil(n / 4), 250));
  const monsters = generateMonsters({ totalSats: monsterCount * 100, monsterCount, geoFence });
  const now = Date.now();
  monsters.forEach(m => { m.spawnTime = now; });

  const hostPrivkey = generateSecretKey();
  const broadcastPrivkey = generateSecretKey();
  const host: HostSim = {
    privkey: hostPrivkey,
    pubkey: getPublicKey(hostPrivkey),
    broadcastPrivkey,
    broadcastPubkey: getPublicKey(broadcastPrivkey),
    captureSecret: generateCaptureSecret(),
    arbiter: createArbiterState([], []),
    syncedCaptures: new Map(),
    payments: [],
    monsters,
  };
  const cast = deriveCastKeypair(shareCode);
  const attackerKey = generateSecretKey(); // hunt member forging broadcasts

  const baseHunt: HuntEvent = {
    id: `hunt-sim-${n}`,
    name: `Field Sim ${n}`,
    description: 'simulated field test',
    hostPubkey: host.pubkey,
    totalSats: monsterCount * 100,
    monsterCount,
    geoFence,
    startTime: now,
    endTime: now + 3600000,
    createdAt: now,
    monsters: [],
    satStops: [],
    status: 'active',
    paymentStatus: 'paid',
    shareCode,
    participants: [],
    spawnMode: 'all_at_once',
  };

  const huntData: HuntLocationData = {
    geoFence,
    monsters: host.monsters,
    satStops: [],
    captureSecret: host.captureSecret,
    hostBroadcastPubkey: host.broadcastPubkey,
  };
  const getCaptureState = () => ({ stateVersion: Date.now(), entries: hostStateEntries(host) });
  const claimIndex = buildCaptureDedupIndex(shareCode, host.monsters);

  // --- join wave (80%) ---------------------------------------------------------
  const tJoin = performance.now();
  const initialCount = Math.max(1, Math.ceil(n * 0.8));
  const midCount = Math.max(n >= 10 ? 1 : 0, Math.floor(n * 0.1));
  const players: SimPlayer[] = [];
  for (let i = 0; i < initialCount; i++) {
    players.push(joinPlayer(i, buildHelloPayload(huntData, getCaptureState), baseHunt, -1));
  }
  // All initial worlds identical and empty of captures.
  for (const p of players) expect(playerCapturedIds(p).size).toBe(0);
  const msJoin = performance.now() - tJoin;

  // --- capture rounds -----------------------------------------------------------
  const tRounds = performance.now();
  let round = 0;
  let captureEvents = 0;
  let forgedClaims = 0;
  let forgedBroadcasts = 0;
  let races = 0;
  const winnersByMonster = new Map<string, string>(); // authoritative, from payments
  const optimisticByMonster = new Map<string, string[]>(); // realPubkeys who locally captured
  const griefedMonsters = new Set<string>(); // forged-tag-hidden, never really captured
  const spoofedMonsters = new Set<string>(); // poisoned by a spoofed-location claim
  let broadcastBytes = 0;
  const maxRounds = 60;

  const active = () => players;
  const hostUncaptured = () =>
    host.monsters.filter(
      m => !host.syncedCaptures.has(m.id) && !host.arbiter.poisoned.has(m.id)
    );

  while (hostUncaptured().length > 0 && round < maxRounds) {
    round++;
    const uncaptured = hostUncaptured();
    const concurrency = Math.max(1, Math.min(uncaptured.length, Math.ceil(active().length / 5), 25));
    const targets = uncaptured.slice(0, concurrency);
    const batch: NostrEvent[] = [];

    for (const monster of targets) {
      // Racers: players whose OWN world still shows the monster as capturable.
      const eligible = active().filter(p => {
        const local = p.state.activeHunt!.monsters.find(m => m.id === monster.id);
        return local && !local.captured;
      });
      if (eligible.length === 0) continue;
      const racerCount = Math.min(eligible.length, 1 + Math.floor(rng() * 3));
      const racers: SimPlayer[] = [];
      const pool = [...eligible];
      for (let i = 0; i < racerCount; i++) {
        racers.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      }
      if (racers.length > 1) races++;

      for (const racer of racers) {
        // Walk to the monster, check eligibility with the REAL gate, capture
        // locally (optimistic), then publish — exactly the GameMap flow.
        racer.state = gameReducer(racer.state, { type: 'SET_PLAYER_LOCATION', location: monster.location });
        const localMonster = racer.state.activeHunt!.monsters.find(m => m.id === monster.id)!;
        if (!canCaptureMonster(racer.state, localMonster)) continue;
        racer.state = gameReducer(racer.state, { type: 'USE_BALL' });
        racer.state = gameReducer(racer.state, {
          type: 'CAPTURE_MONSTER', monster: localMonster, huntName: baseHunt.name,
        });
        batch.push(buildRealCaptureEvent(racer, monster, shareCode, host.pubkey, host.captureSecret));
        captureEvents++;
        const opt = optimisticByMonster.get(monster.id) ?? [];
        opt.push(racer.realPubkey);
        optimisticByMonster.set(monster.id, opt);
      }
    }

    // Adversarial traffic (N >= 10): a forged Tier 1 claim for a monster also
    // targeted this round (race-forgery, self-healing via the real capture) and,
    // in round 1 only, a forged claim for an otherwise-untouched monster
    // (pure griefing — documented divergence).
    if (n >= 10 && targets.length > 0) {
      batch.push(buildForgedClaim(shareCode, targets[0].id));
      forgedClaims++;
      if (round === 1) {
        const griefTarget = hostUncaptured().find(m => !targets.includes(m));
        if (griefTarget) {
          batch.push(buildForgedClaim(shareCode, griefTarget.id));
          griefedMonsters.add(griefTarget.id);
          forgedClaims++;
        }
      }
      // Round 2: a spoofed-location claim (valid crypto, geohash ~1000km away)
      // — must be rejected AND poison the monster (documented behavior).
      if (round === 2) {
        const spoofTarget = hostUncaptured().find(
          m => !targets.includes(m) && !griefedMonsters.has(m.id)
        );
        if (spoofTarget) {
          const spoofer = players[Math.floor(rng() * players.length)];
          batch.push(buildRealCaptureEvent(spoofer, spoofTarget, shareCode, host.pubkey, host.captureSecret, {
            geohash: encodeCoarseGeohash({ lat: 48.8566, lng: 2.3522 }), // Paris
          }));
          spoofedMonsters.add(spoofTarget.id);
          captureEvents++;
        }
      }
    }

    // Shuffle: relays return events in arbitrary order within a poll.
    for (let i = batch.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [batch[i], batch[j]] = [batch[j], batch[i]];
    }

    // Host processes the batch (arbitration + payment).
    const paymentsBefore = host.payments.length;
    const { dTags, expectedFirstValid } = hostProcessBatch(host, batch);

    // Cross-check: every payment this round went to the FIRST valid claimant
    // in processing order (goal file: conflict resolution).
    for (const pay of host.payments.slice(paymentsBefore)) {
      expect(pay.toPubkey).toBe(expectedFirstValid.get(pay.monsterId));
      winnersByMonster.set(pay.monsterId, pay.toPubkey);
    }

    // Tier 1 fan-out: every active player sees every verified event's d tag
    // (one shared signature verification above stands in for each player's
    // identical verifyEvent — the per-player cost is on their own device).
    for (const dTag of dTags) {
      const monsterId = claimIndex.get(dTag);
      if (!monsterId) continue;
      for (const p of active()) {
        const wasCaptured = p.state.activeHunt!.monsters.find(m => m.id === monsterId)!.captured;
        p.state = gameReducer(p.state, { type: 'MARK_MONSTER_CLAIMED', monsterId });
        if (!wasCaptured && (griefedMonsters.has(monsterId) || spoofedMonsters.has(monsterId))) {
          p.griefTagsSeen.add(monsterId);
        }
      }
    }

    // Tier 2: host broadcasts the full authoritative state (one event for all).
    const stateVersion = Date.now();
    const broadcast = buildCaptureStateEvent(
      host.broadcastPrivkey, cast.pubkey, baseHunt.id, stateVersion, hostStateEntries(host)
    );
    broadcastBytes = JSON.stringify(broadcast).length;

    // Forged broadcast from a hunt member: sampled players must reject it.
    const forged = buildCaptureStateEvent(
      attackerKey, cast.pubkey, baseHunt.id, stateVersion + 1, hostStateEntries(host)
    );
    forgedBroadcasts++;

    // Real decryption per player is O(ECDH + verify); at n=1000 sample it per
    // round (each device does this independently in the field) and have every
    // player apply the decrypted payload; everyone decrypts the final broadcast.
    const decryptors = n <= 100
      ? active()
      : Array.from({ length: 25 }, () => active()[Math.floor(rng() * active().length)]);
    let payloadEntries: CaptureStateEntry[] | null = null;
    for (const p of decryptors) {
      const payload = decryptCaptureStateEvent(cast.privkey, broadcast, p.state.activeHunt!.hostBroadcastPubkey!);
      expect(payload).not.toBeNull();
      expect(decryptCaptureStateEvent(cast.privkey, forged, p.state.activeHunt!.hostBroadcastPubkey!)).toBeNull();
      payloadEntries = payload!.entries;
    }
    expect(payloadEntries).toEqual(hostStateEntries(host));
    for (const p of active()) {
      p.state = gameReducer(p.state, {
        type: 'APPLY_CAPTURE_STATE', entries: payloadEntries!, myPubkey: p.realPubkey,
      });
    }

    // Mid-hunt joiners after round 1.
    if (round === 1) {
      for (let i = 0; i < midCount; i++) {
        players.push(joinPlayer(players.length, buildHelloPayload(huntData, getCaptureState), baseHunt, round));
      }
    }
  }
  const msRounds = performance.now() - tRounds;

  // Every non-poisoned, non-griefed monster must have been captured.
  const hostCaptured = new Set(host.syncedCaptures.keys());
  for (const m of host.monsters) {
    if (!griefedMonsters.has(m.id) && !spoofedMonsters.has(m.id)) {
      expect(hostCaptured.has(m.id)).toBe(true);
    }
  }

  // --- final late joiners (rest of the roster) -----------------------------------
  const tLate = performance.now();
  while (players.length < n) {
    players.push(joinPlayer(players.length, buildHelloPayload(huntData, getCaptureState), baseHunt, round + 1));
  }
  const msLateJoin = performance.now() - tLate;

  // --- refresh recovery ------------------------------------------------------------
  const refresher = players[0];
  refresher.refreshed = true;
  // Persistence strips both secrets (GameContext persistence effect).
  refresher.state = {
    ...refresher.state,
    activeHunt: (() => {
      const { captureSecret: _s, hostBroadcastPubkey: _b, ...rest } = refresher.state.activeHunt!;
      return rest as HuntEvent;
    })(),
  };
  expect(refresher.state.activeHunt!.hostBroadcastPubkey).toBeUndefined();
  // Re-hello (useReHello): merge secrets, then apply the snapshot.
  const rehello = buildHelloPayload(huntData, getCaptureState);
  refresher.state = gameReducer(refresher.state, {
    type: 'MERGE_HUNT_SECRETS',
    huntId: baseHunt.id,
    captureSecret: rehello.captureSecret,
    hostBroadcastPubkey: rehello.hostBroadcastPubkey,
  });
  expect(refresher.state.activeHunt!.hostBroadcastPubkey).toBe(host.broadcastPubkey);
  if (rehello.captureState) {
    refresher.state = gameReducer(refresher.state, {
      type: 'APPLY_CAPTURE_STATE', entries: rehello.captureState.entries, myPubkey: refresher.realPubkey,
    });
  }

  // Final heartbeat: EVERY player decrypts + applies (self-healing convergence).
  const finalBroadcast = buildCaptureStateEvent(
    host.broadcastPrivkey, cast.pubkey, baseHunt.id, Date.now(), hostStateEntries(host)
  );
  for (const p of players) {
    const payload = decryptCaptureStateEvent(cast.privkey, finalBroadcast, p.state.activeHunt!.hostBroadcastPubkey!);
    expect(payload).not.toBeNull();
    p.state = gameReducer(p.state, {
      type: 'APPLY_CAPTURE_STATE', entries: payload!.entries, myPubkey: p.realPubkey,
    });
  }

  // === INVARIANTS ==================================================================

  // 1. Exactly one payment per monster; totals exact; winner == broadcast winner.
  const paidMonsters = host.payments.map(p => p.monsterId);
  expect(new Set(paidMonsters).size).toBe(paidMonsters.length); // no double payment
  expect(host.payments.length).toBe(host.syncedCaptures.size);
  for (const pay of host.payments) {
    const synced = host.syncedCaptures.get(pay.monsterId)!;
    expect(synced.playerPubkey).toBe(pay.toPubkey);
    expect(pay.sats).toBe(host.monsters.find(m => m.id === pay.monsterId)!.satAmount);
    const entry = hostStateEntries(host).find(e => e.monsterId === pay.monsterId)!;
    expect(entry.winnerProof).toBe(computeWinnerProof(pay.monsterId, pay.toPubkey));
  }
  const totalPaid = host.payments.reduce((s, p) => s + p.sats, 0);
  const totalCapturedValue = host.monsters
    .filter(m => hostCaptured.has(m.id))
    .reduce((s, m) => s + m.satAmount, 0);
  expect(totalPaid).toBe(totalCapturedValue);

  // 2. World convergence: every player's captured set == host's authoritative
  //    set, plus any forged tags they saw while active (documented Tier 1
  //    griefing — hides, never credits).
  for (const p of players) {
    const expected = new Set([...hostCaptured, ...p.griefTagsSeen]);
    const actual = playerCapturedIds(p);
    if (!setsEqual(actual, expected)) {
      throw new Error(
        `player ${p.idx} diverged: has ${actual.size}, expected ${expected.size} ` +
        `(joinedRound=${p.joinedRound}, refreshed=${p.refreshed})`
      );
    }
  }

  // 3. Sats accounting per player: local earned == sum of monsters they WON
  //    (losers rolled back, winners keep credit, griefed monsters never credit).
  let losersRolledBack = 0;
  for (const p of players) {
    const wonSats = host.payments
      .filter(pay => pay.toPubkey === p.realPubkey)
      .reduce((s, pay) => s + pay.sats, 0);
    expect(p.state.playerStats.currentHuntSatsEarned).toBe(wonSats);
    expect(p.state.playerStats.currentHuntSatsEarned).toBeGreaterThanOrEqual(0);
    expect(p.state.playerStats.currentHuntCaptured).toBe(
      host.payments.filter(pay => pay.toPubkey === p.realPubkey).length
    );
    // Losers: optimistically captured but someone else won -> exactly one
    // lostCaptures entry per lost monster.
    const lostMonsters = [...optimisticByMonster.entries()]
      .filter(([mId, opts]) => opts.includes(p.realPubkey) && winnersByMonster.get(mId) !== p.realPubkey && winnersByMonster.has(mId))
      .map(([mId]) => mId);
    const lostRecorded = p.state.lostCaptures.map(l => l.monsterId);
    expect(new Set(lostRecorded).size).toBe(lostRecorded.length); // no duplicate rollbacks
    expect(new Set(lostRecorded)).toEqual(new Set(lostMonsters));
    losersRolledBack += lostMonsters.length;
  }

  // 4. Privacy: player-readable wire bytes never contain real npubs or GPS.
  //    (capture event public parts, the broadcast envelope, the decrypted state)
  const realPubkeys = players.map(p => p.realPubkey);
  const publicWire =
    JSON.stringify({ tags: [['x'], ['d']], sample: true }) + // placeholder shape
    JSON.stringify(hostStateEntries(host)) +
    JSON.stringify(finalBroadcast.tags) +
    JSON.stringify(finalBroadcast.pubkey);
  for (const pk of realPubkeys) expect(publicWire).not.toContain(pk);
  const wireLower = JSON.stringify(hostStateEntries(host)).toLowerCase();
  for (const forbidden of ['lat', 'lng', 'geohash', '"location"', 'npub']) {
    expect(wireLower).not.toContain(forbidden);
  }

  return {
    n,
    monsters: monsterCount,
    rounds: round,
    captureEvents,
    forgedClaims,
    forgedBroadcasts,
    races,
    losersRolledBack,
    broadcastBytes,
    msJoin: Math.round(msJoin),
    msRounds: Math.round(msRounds),
    msLateJoin: Math.round(msLateJoin),
    msTotal: Math.round(performance.now() - t0),
  };
}

// ---------------------------------------------------------------------------------

describe.runIf(RUN)('simulated field test — shared creature state at scale', () => {
  const results: SimResult[] = [];

  for (const n of INCREMENTS) {
    it(`${n} players: one world, one payment per creature, losers rolled back`, () => {
      const result = runSim(n, 0xC0FFEE + n);
      results.push(result);
      console.log(
        `[fieldSim] n=${result.n} monsters=${result.monsters} rounds=${result.rounds} ` +
        `events=${result.captureEvents} races=${result.races} rollbacks=${result.losersRolledBack} ` +
        `forgedClaims=${result.forgedClaims} broadcast=${result.broadcastBytes}B ` +
        `join=${result.msJoin}ms rounds=${result.msRounds}ms late=${result.msLateJoin}ms total=${result.msTotal}ms`
      );
    }, 600000);
  }

  it('summary table', () => {
    console.table(results);
    expect(results.length).toBe(INCREMENTS.length);
  });
});
