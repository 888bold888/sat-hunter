import { useMutation } from '@tanstack/react-query';
import { useNostr } from '@nostrify/react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { Monster, GeoLocation } from '@/lib/gameTypes';
import { encodeCoarseGeohash, computeCaptureProof } from '@/lib/antiCheat';
import { signWithSessionKey, nip44EncryptWithSessionKey } from '@/lib/sessionKeys';

const CLAIM_EVENT_KIND = 32960;

interface CaptureEventData {
  huntId: string;
  huntShareCode: string;
  monster: Monster;
  playerPubkey: string;
  hostPubkey: string;
  // Anti-cheat data
  playerLocation?: GeoLocation;
  trustScore?: number;
  trustFlags?: string[];
  // Capture proof (HMAC token from hunt secret)
  captureSecret?: string;
}

export function usePublishCapture() {
  const { nostr } = useNostr();

  return useMutation({
    mutationFn: async (data: CaptureEventData) => {
      // Generate coarse geohash for privacy (5 chars = ~5km cell)
      const geohash = data.playerLocation
        ? encodeCoarseGeohash(data.playerLocation)
        : undefined;

      // Compute capture proof if secret is available
      const capturedAt = Date.now();
      const captureProof = data.captureSecret
        ? computeCaptureProof(data.captureSecret, data.monster.id, data.playerPubkey, capturedAt)
        : undefined;

      // All sensitive data goes into encrypted content (only host can read)
      const plaintext = JSON.stringify({
        playerPubkey: data.playerPubkey,
        monsterId: data.monster.id,
        monsterName: data.monster.name,
        satAmount: data.monster.satAmount,
        rarity: data.monster.rarity,
        capturedAt,
        geohash,
        trustScore: data.trustScore,
        trustFlags: data.trustFlags,
        captureProof,
      });

      // Encrypt content with session key -> host pubkey (NIP-44)
      const encryptedContent = nip44EncryptWithSessionKey(data.hostPubkey, plaintext);

      // Only non-identifying tags: blinded hunt ref + hashed dedup key
      const enc = new TextEncoder();
      const huntBlind = bytesToHex(sha256(enc.encode(data.huntShareCode)));
      const dedupHash = bytesToHex(sha256(enc.encode(`${data.huntShareCode}-${data.monster.id}`)));
      const tags: string[][] = [
        ['x', huntBlind],
        ['d', dedupHash],
      ];

      // Sign with ephemeral session key (no browser extension prompt, unlinkable)
      const signedEvent = signWithSessionKey({
        kind: CLAIM_EVENT_KIND,
        content: encryptedContent,
        tags,
      });

      // Publish to relays
      await nostr.event(signedEvent);

      console.log('Capture event published (encrypted):', signedEvent.id);
      return signedEvent;
    },
    onError: (error) => {
      console.error('Failed to publish capture event:', error);
    },
  });
}
