import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Monster } from './gameTypes';

// Capture events (kind 32960) carry a public dedup tag:
// d = sha256("{shareCode}-{monsterId}") hex. Content is encrypted to the host,
// but anyone who knows the shareCode and the roster can recognize WHICH monster
// was claimed from the tag alone. Players use this as the Tier 1 optimistic
// "someone caught it" signal (tasks/goals/shared-creature-state.md).
//
// SECURITY: the tag is forgeable by any shareCode holder. It may only ever
// HIDE creatures from a player's map — never credit sats, trigger payments,
// or feed anti-cheat. The host's Tier 2 state broadcast is the authority.
export function computeCaptureDedupHash(shareCode: string, monsterId: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${shareCode}-${monsterId}`)));
}

// Precomputed dedupHash -> monsterId lookup for a hunt roster, so incoming
// capture events resolve to a monster in O(1) without decryption.
export function buildCaptureDedupIndex(
  shareCode: string,
  monsters: Monster[]
): Map<string, string> {
  const index = new Map<string, string>();
  for (const m of monsters) {
    index.set(computeCaptureDedupHash(shareCode, m.id), m.id);
  }
  return index;
}
