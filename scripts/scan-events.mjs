/**
 * Quick scan for hunt events with exposed location data
 */

import { SimplePool, nip19 } from 'nostr-tools';

const HUNT_EVENT_KIND = 32959;

const RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
];

const npubs = [
  'npub14ke3mq8g8cnpcyuen64qqygrm7asnr9pqt8vq4zs8l0646h3q7es2ml6ng',
  'npub19vem9txx6xl9j2dx0pm2g76g8grsccguq5lsfz8l8u0yek5lynzshkgqpq',
  'npub1tgqdnzkj2sju34vj3kdp82m4pdspw2x8eqjrunrpz9399re65adq7usu8r',
  'npub1a2jstzfrmd3vt393k2scdvu753ttgsmwdqcgn4ey93e6v8tz4vesd7xmdp',
];

async function main() {
  console.log('\n🔍 Scanning for hunt events with exposed coordinates...\n');
  console.log('═'.repeat(70));

  const pool = new SimplePool();

  for (const npub of npubs) {
    const { data: pubkey } = nip19.decode(npub);

    console.log(`\n📍 Checking: ${npub.slice(0, 20)}...`);
    console.log(`   Hex: ${pubkey.slice(0, 16)}...`);

    try {
      const events = await pool.querySync(RELAYS, {
        kinds: [HUNT_EVENT_KIND],
        authors: [pubkey],
      });

      if (events.length === 0) {
        console.log('   ✅ No hunt events found\n');
        continue;
      }

      console.log(`   ⚠️  Found ${events.length} hunt event(s):\n`);

      for (const event of events) {
        const nameTag = event.tags.find(t => t[0] === 'title');
        const dTag = event.tags.find(t => t[0] === 'd');
        const statusTag = event.tags.find(t => t[0] === 'status');

        console.log(`   ─────────────────────────────────────────────`);
        console.log(`   Event ID:    ${event.id}`);
        console.log(`   Name:        ${nameTag?.[1] || 'Unnamed'}`);
        console.log(`   Share Code:  ${dTag?.[1] || 'N/A'}`);
        console.log(`   Status:      ${statusTag?.[1] || 'unknown'}`);
        console.log(`   Created:     ${new Date(event.created_at * 1000).toISOString()}`);

        try {
          const content = JSON.parse(event.content);

          // Check for exposed coordinates
          if (content.geoFence?.center) {
            const { lat, lng } = content.geoFence.center;
            console.log(`   🚨 EXPOSED:  Center coords: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
          }

          if (content.geoFence?.polygon) {
            console.log(`   🚨 EXPOSED:  Polygon with ${content.geoFence.polygon.length} vertices`);
          }

          if (content.monsters?.length > 0) {
            const monstersWithLocation = content.monsters.filter(m => m.location);
            if (monstersWithLocation.length > 0) {
              console.log(`   🚨 EXPOSED:  ${monstersWithLocation.length} monster locations`);
              // Show first monster location as sample
              const sample = monstersWithLocation[0].location;
              console.log(`                Sample: ${sample.lat.toFixed(6)}, ${sample.lng.toFixed(6)}`);
            }
          }

          if (content.satStops?.length > 0) {
            const stopsWithLocation = content.satStops.filter(s => s.location);
            if (stopsWithLocation.length > 0) {
              console.log(`   🚨 EXPOSED:  ${stopsWithLocation.length} sat stop locations`);
            }
          }
        } catch (e) {
          console.log(`   ⚠️  Could not parse content`);
        }
      }

      console.log(`\n   Event IDs for deletion:`);
      for (const event of events) {
        console.log(`     ${event.id}`);
      }

    } catch (err) {
      console.log(`   ❌ Error querying: ${err.message}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('\n📋 To delete these events, use nak CLI:');
  console.log('   nak event -k 5 -e <event-id> --sec <your-nsec> | nak publish\n');

  pool.close(RELAYS);
}

main().catch(console.error);
