/**
 * Delete Hunt Events with Exposed Location Data
 * 
 * Usage: node --experimental-strip-types scripts/delete-exposed-hunts.mjs <nsec>
 * 
 * This script will:
 * 1. Find all hunt events from your pubkey with exposed location data
 * 2. Publish NIP-09 deletion requests for each one
 * 
 * Note: Relays are NOT required to honor deletion requests.
 */

import { SimplePool, finalizeEvent, nip19, getPublicKey } from 'nostr-tools';

const RELAYS = ['wss://nos.lol', 'wss://relay.damus.io'];
const HUNT_KIND = 32959;
const DELETE_KIND = 5;

async function main() {
  const nsecArg = process.argv[2];
  
  if (!nsecArg) {
    console.log('Usage: node --experimental-strip-types scripts/delete-exposed-hunts.mjs <nsec>');
    console.log('');
    console.log('To find exposed events without deleting, run without nsec:');
    console.log('  node --experimental-strip-types scripts/delete-exposed-hunts.mjs --list');
    process.exit(1);
  }

  const pool = new SimplePool();
  
  // Decode nsec to get secret key and pubkey
  let secretKey, pubkey;
  
  if (nsecArg === '--list') {
    pubkey = null; // List all
  } else {
    try {
      const decoded = nip19.decode(nsecArg);
      if (decoded.type !== 'nsec') {
        console.error('Error: Please provide an nsec (not ' + decoded.type + ')');
        process.exit(1);
      }
      secretKey = decoded.data;
      pubkey = getPublicKey(secretKey);
      console.log('Your pubkey: ' + pubkey.slice(0, 8) + '...' + pubkey.slice(-8));
    } catch (e) {
      console.error('Error: Invalid nsec format');
      process.exit(1);
    }
  }

  console.log('\nFetching hunt events...');
  
  const filter = { kinds: [HUNT_KIND], limit: 100 };
  if (pubkey) filter.authors = [pubkey];
  
  const events = await pool.querySync(RELAYS, filter);
  
  // Find exposed events
  const exposed = [];
  for (const event of events) {
    let content;
    try {
      content = JSON.parse(event.content);
    } catch {
      continue;
    }

    const hasLocation = content.geoFence || 
                       (content.monsters && content.monsters.length > 0) || 
                       (content.satStops && content.satStops.length > 0);
    
    if (hasLocation) {
      const dTag = event.tags.find(t => t[0] === 'd')?.[1] || 'N/A';
      const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Unnamed';
      exposed.push({ id: event.id, dTag, title, pubkey: event.pubkey });
    }
  }

  if (exposed.length === 0) {
    console.log('\nNo exposed hunt events found' + (pubkey ? ' for your pubkey' : '') + '!');
    pool.close(RELAYS);
    process.exit(0);
  }

  console.log('\nFound ' + exposed.length + ' exposed hunt event(s):\n');
  for (const e of exposed) {
    console.log('  - ' + e.title + ' (' + e.dTag + ') - ' + e.id.slice(0, 16) + '...');
  }

  if (!secretKey) {
    console.log('\nRun with your nsec to delete these events.');
    pool.close(RELAYS);
    process.exit(0);
  }

  console.log('\nPublishing deletion requests...\n');

  for (const e of exposed) {
    const deleteEvent = finalizeEvent({
      kind: DELETE_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', e.id],
        ['k', String(HUNT_KIND)],
      ],
      content: 'Deleting hunt with exposed location data',
    }, secretKey);

    try {
      await Promise.any(pool.publish(RELAYS, deleteEvent));
      console.log('✅ Deleted: ' + e.title + ' (' + e.dTag + ')');
    } catch (err) {
      console.log('❌ Failed: ' + e.title + ' - ' + err.message);
    }
  }

  console.log('\nDone! Note: Relays may not honor deletion requests.');
  
  pool.close(RELAYS);
  process.exit(0);
}

main().catch(console.error);
