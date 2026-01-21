/**
 * Cleanup Script: Delete Hunt Events from Nostr Relays
 *
 * This script finds all hunt events (kind: 32959) published by a given pubkey
 * and publishes NIP-09 deletion events to request their removal.
 *
 * IMPORTANT: Relays are not required to honor deletion requests.
 * This is a best-effort cleanup.
 *
 * Usage:
 *   npx ts-node scripts/cleanup-hunt-events.ts <your-pubkey-hex>
 *
 * Or with nsec (will be converted):
 *   npx ts-node scripts/cleanup-hunt-events.ts <your-nsec>
 */

import { SimplePool, finalizeEvent, nip19 } from 'nostr-tools';

const HUNT_EVENT_KIND = 32959;
const DELETION_KIND = 5; // NIP-09

const RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
];

interface HuntEventSummary {
  id: string;
  createdAt: Date;
  name: string;
  shareCode: string;
  hasCoordinates: boolean;
  coordinatePreview?: string;
}

async function findHuntEvents(pubkey: string): Promise<HuntEventSummary[]> {
  console.log('\n🔍 Searching for hunt events on relays...\n');

  const pool = new SimplePool();
  const events: HuntEventSummary[] = [];

  try {
    const huntEvents = await pool.querySync(RELAYS, {
      kinds: [HUNT_EVENT_KIND],
      authors: [pubkey],
    });

    for (const event of huntEvents) {
      const nameTag = event.tags.find(t => t[0] === 'title');
      const dTag = event.tags.find(t => t[0] === 'd');

      let hasCoordinates = false;
      let coordinatePreview = '';

      try {
        const content = JSON.parse(event.content);
        if (content.geoFence?.center) {
          hasCoordinates = true;
          const { lat, lng } = content.geoFence.center;
          coordinatePreview = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        }
        if (content.monsters?.length > 0 && content.monsters[0].location) {
          hasCoordinates = true;
        }
      } catch {
        // Content parse failed
      }

      events.push({
        id: event.id,
        createdAt: new Date(event.created_at * 1000),
        name: nameTag?.[1] || 'Unnamed Hunt',
        shareCode: dTag?.[1] || 'N/A',
        hasCoordinates,
        coordinatePreview,
      });
    }
  } finally {
    pool.close(RELAYS);
  }

  return events;
}

async function _publishDeletions(pubkey: string, secretKey: Uint8Array, eventIds: string[]): Promise<void> {
  console.log('\n🗑️  Publishing deletion events...\n');

  const pool = new SimplePool();

  try {
    for (const eventId of eventIds) {
      const deletionEvent = finalizeEvent({
        kind: DELETION_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', eventId],
          ['k', HUNT_EVENT_KIND.toString()],
        ],
        content: 'Deleting hunt event - location data cleanup',
      }, secretKey);

      console.log(`  Requesting deletion of ${eventId.slice(0, 8)}...`);

      await Promise.any(
        pool.publish(RELAYS, deletionEvent)
      );

      console.log(`  ✅ Deletion event published`);
    }
  } finally {
    pool.close(RELAYS);
  }
}

function printUsage() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║           SAT HUNTER - Hunt Event Cleanup Script                  ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  This script finds and deletes hunt events that may contain       ║
║  exposed location data on Nostr relays.                           ║
║                                                                   ║
║  Usage:                                                           ║
║    npx ts-node scripts/cleanup-hunt-events.ts [pubkey]            ║
║                                                                   ║
║  Options:                                                         ║
║    --list-only    Only list events, don't delete                  ║
║    --help         Show this message                               ║
║                                                                   ║
║  ⚠️  WARNING: Deletion is best-effort. Relays may not comply.     ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
  `);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const listOnly = args.includes('--list-only');
  const pubkeyArg = args.find(a => !a.startsWith('--'));

  if (!pubkeyArg) {
    console.error('❌ Please provide a pubkey');
    process.exit(1);
  }

  // Handle npub format
  let pubkey = pubkeyArg;
  if (pubkeyArg.startsWith('npub')) {
    const decoded = nip19.decode(pubkeyArg);
    if (decoded.type !== 'npub') {
      console.error('❌ Invalid npub');
      process.exit(1);
    }
    pubkey = decoded.data;
  }

  console.log(`\n📍 Looking for hunt events from: ${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`);

  // Find events
  const events = await findHuntEvents(pubkey);

  if (events.length === 0) {
    console.log('\n✅ No hunt events found for this pubkey!\n');
    process.exit(0);
  }

  // Display found events
  console.log(`\n📋 Found ${events.length} hunt event(s):\n`);
  console.log('─'.repeat(70));

  for (const event of events) {
    console.log(`  ID:          ${event.id.slice(0, 16)}...`);
    console.log(`  Name:        ${event.name}`);
    console.log(`  Share Code:  ${event.shareCode}`);
    console.log(`  Created:     ${event.createdAt.toISOString()}`);
    console.log(`  Has Coords:  ${event.hasCoordinates ? '⚠️  YES - EXPOSED' : '✅ No'}`);
    if (event.coordinatePreview) {
      console.log(`  Location:    ~${event.coordinatePreview}`);
    }
    console.log('─'.repeat(70));
  }

  const exposedCount = events.filter(e => e.hasCoordinates).length;
  console.log(`\n⚠️  ${exposedCount} of ${events.length} events contain exposed coordinates\n`);

  if (listOnly) {
    console.log('(--list-only mode, not deleting)\n');
    process.exit(0);
  }

  // Prompt for deletion (in a real script, would ask for nsec)
  console.log(`
To delete these events, you need to sign deletion requests with your private key.

For security, this script doesn't handle private keys directly.
Instead, use a tool like:

  1. Nostr client with deletion support (Damus, Amethyst, etc.)
  2. nak CLI: nak event -k 5 -e <event-id> | nak publish
  3. Add your nsec to this script (edit carefully!)

Event IDs to delete:
${events.map(e => `  ${e.id}`).join('\n')}
  `);
}

main().catch(console.error);
