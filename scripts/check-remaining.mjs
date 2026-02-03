import { SimplePool } from 'nostr-tools/pool';

const RELAYS = ['wss://nos.lol', 'wss://relay.damus.io'];
const HUNT_KIND = 32959;

// The 3 pubkeys with exposed data
const pubkeys = [
  '0cb4de5706efc6649493d2b1bcdff3aa0d624d469caf76f1340e99c13e03986e',
  'eaa5058923db62c5c4b1b2a186b39ea456b4436e683089d7242c73a61d62ab33',
  '276aee867371143b49a5b9cd0029a8853ad8171e8590efefe06291923b1b9c24'
];

const pool = new SimplePool();
console.log('Checking for remaining exposed events...\n');

const events = await pool.querySync(RELAYS, { kinds: [HUNT_KIND], authors: pubkeys });

const exposed = [];
for (const event of events) {
  let content;
  try { content = JSON.parse(event.content); } catch { continue; }

  const hasLocation = content.geoFence ||
    (content.monsters && content.monsters.length > 0) ||
    (content.satStops && content.satStops.length > 0);

  if (hasLocation) {
    const dTag = event.tags.find(t => t[0] === 'd')?.[1] || 'N/A';
    exposed.push({ pubkey: event.pubkey, dTag });
  }
}

// Group by pubkey
const byPubkey = {};
for (const e of exposed) {
  if (!byPubkey[e.pubkey]) byPubkey[e.pubkey] = [];
  byPubkey[e.pubkey].push(e.dTag);
}

console.log('REMAINING EXPOSED EVENTS:\n');
for (const [hex, hunts] of Object.entries(byPubkey)) {
  console.log('Pubkey: ' + hex.slice(0,8) + '...' + hex.slice(-8));
  console.log('Count: ' + hunts.length);
  console.log('Hunts: ' + hunts.join(', '));
  console.log('');
}

if (exposed.length === 0) {
  console.log('✅ All exposed events have been deleted!');
} else {
  console.log('Total remaining: ' + exposed.length + ' exposed events');
}

pool.close(RELAYS);
process.exit(0);
