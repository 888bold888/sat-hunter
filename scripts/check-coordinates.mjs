import { SimplePool } from 'nostr-tools/pool';

const RELAYS = ['wss://nos.lol', 'wss://relay.damus.io'];
const HUNT_KIND = 32959;

// The 2 pubkeys with remaining exposed data
const pubkeys = [
  '0cb4de5706efc6649493d2b1bcdff3aa0d624d469caf76f1340e99c13e03986e',
  '276aee867371143b49a5b9cd0029a8853ad8171e8590efefe06291923b1b9c24'
];

const pool = new SimplePool();
console.log('Fetching coordinates of exposed hunt events...\n');

const events = await pool.querySync(RELAYS, { kinds: [HUNT_KIND], authors: pubkeys });

const locations = [];

for (const event of events) {
  let content;
  try { content = JSON.parse(event.content); } catch { continue; }

  const hasLocation = content.geoFence ||
    (content.monsters && content.monsters.length > 0) ||
    (content.satStops && content.satStops.length > 0);

  if (hasLocation) {
    const dTag = event.tags.find(t => t[0] === 'd')?.[1] || 'N/A';
    const title = event.tags.find(t => t[0] === 'title')?.[1] || 'Unnamed';

    let lat, lng;
    if (content.geoFence && content.geoFence.center) {
      lat = content.geoFence.center.lat;
      lng = content.geoFence.center.lng;
    } else if (content.monsters && content.monsters.length > 0) {
      lat = content.monsters[0].lat;
      lng = content.monsters[0].lng;
    } else if (content.satStops && content.satStops.length > 0) {
      lat = content.satStops[0].lat;
      lng = content.satStops[0].lng;
    }

    locations.push({
      dTag,
      title,
      lat,
      lng,
      pubkey: event.pubkey.slice(0,8)
    });
  }
}

// Group by approximate area (round to 2 decimal places ~1km precision)
const areas = {};
for (const loc of locations) {
  const areaKey = (Math.round(loc.lat * 100) / 100) + ',' + (Math.round(loc.lng * 100) / 100);
  if (!areas[areaKey]) areas[areaKey] = [];
  areas[areaKey].push(loc);
}

console.log('EXPOSED COORDINATES BY AREA:\n');
console.log('=' .repeat(80) + '\n');

for (const [area, locs] of Object.entries(areas)) {
  const [lat, lng] = area.split(',').map(Number);
  console.log('AREA: ~' + lat.toFixed(2) + ', ' + lng.toFixed(2) + ' (' + locs.length + ' hunts)');
  console.log('Google Maps: https://www.google.com/maps?q=' + lat + ',' + lng);
  console.log('');
  for (const loc of locs) {
    console.log('  ' + loc.dTag + ' - ' + loc.title);
    console.log('    Exact: ' + loc.lat.toFixed(6) + ', ' + loc.lng.toFixed(6));
  }
  console.log('');
  console.log('-'.repeat(80));
  console.log('');
}

console.log('Total: ' + locations.length + ' exposed hunts in ' + Object.keys(areas).length + ' area(s)');

pool.close(RELAYS);
process.exit(0);
