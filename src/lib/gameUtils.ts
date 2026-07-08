import type {
  Monster,
  MonsterRarity,
  MonsterGenConfig,
  GeoLocation,
  GeoFence,
  GeoBounds,
  SatStop,
  LeaderboardEntry,
  CapturedMonster,
  HuntEvent,
} from './gameTypes';

import {
  RARITY_WEIGHTS,
  RARITY_MULTIPLIERS,
  MONSTER_NAMES,
  MONSTER_EMOJI_MAP,
  MONSTER_DESCRIPTIONS,
} from './gameTypes';

// Turf.js for polygon operations
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { polygon as turfPolygon, point as turfPoint } from '@turf/helpers';
import bbox from '@turf/bbox';

// Generate a random ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Generate a short share code for joining hunts
export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusable chars (0,O,1,I)
  const randomValues = crypto.getRandomValues(new Uint8Array(6));
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[randomValues[i] % chars.length];
  }
  return code;
}

// Generate share URL for a hunt
export function generateShareUrl(shareCode: string): string {
  const baseUrl = window.location.origin;
  return `${baseUrl}/join/${shareCode}`;
}

// Calculate distance between two points in meters (Haversine formula)
export function calculateDistance(point1: GeoLocation, point2: GeoLocation): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (point1.lat * Math.PI) / 180;
  const φ2 = (point2.lat * Math.PI) / 180;
  const Δφ = ((point2.lat - point1.lat) * Math.PI) / 180;
  const Δλ = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Check if a point is inside a polygon using Turf.js
export function isInsidePolygon(point: GeoLocation, polygon: GeoLocation[]): boolean {
  if (polygon.length < 3) return false;

  const turfPt = turfPoint([point.lng, point.lat]);
  // Close the polygon by adding the first point at the end
  const coords = [...polygon.map(p => [p.lng, p.lat]), [polygon[0].lng, polygon[0].lat]];
  const turfPoly = turfPolygon([coords]);
  return booleanPointInPolygon(turfPt, turfPoly);
}

// Check if a point is inside a geofence (supports both circle and polygon)
export function isInsideGeoFence(point: GeoLocation, geoFence: GeoFence): boolean {
  // Handle polygon boundaries
  if (geoFence.boundaryType === 'polygon' && geoFence.polygon) {
    return isInsidePolygon(point, geoFence.polygon);
  }

  // Default to bounding box check for circle boundaries
  const { bounds } = geoFence;
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lng >= bounds.west &&
    point.lng <= bounds.east
  );
}

// Generate random point within polygon using rejection sampling
function randomPointInPolygon(geoFence: GeoFence, maxAttempts = 100): GeoLocation {
  const { bounds, polygon, center } = geoFence;

  if (!polygon || polygon.length < 3) {
    console.warn('randomPointInPolygon: invalid polygon, returning center');
    return center;
  }

  for (let i = 0; i < maxAttempts; i++) {
    const lat = bounds.south + Math.random() * (bounds.north - bounds.south);
    const lng = bounds.west + Math.random() * (bounds.east - bounds.west);
    const point = { lat, lng };

    if (isInsidePolygon(point, polygon)) {
      return point;
    }
  }

  console.warn('randomPointInPolygon: max attempts reached, returning center');
  return center;
}

// Generate random point within geofence (supports both circle and polygon)
export function randomPointInGeoFence(geoFence: GeoFence): GeoLocation {
  // Handle polygon boundaries with rejection sampling
  if (geoFence.boundaryType === 'polygon' && geoFence.polygon) {
    return randomPointInPolygon(geoFence);
  }

  // Default to circular distribution
  const { center, radiusMeters } = geoFence;

  // Generate random point within circle using polar coordinates
  // Use sqrt for uniform distribution within circle (not clustered at center)
  const randomRadius = Math.sqrt(Math.random()) * radiusMeters;
  const randomAngle = Math.random() * 2 * Math.PI;

  // Convert meters to degrees (approximate)
  const latDegPerMeter = 1 / 111320;
  const lngDegPerMeter = 1 / (111320 * Math.cos((center.lat * Math.PI) / 180));

  // Calculate offset in degrees
  const latOffset = randomRadius * Math.cos(randomAngle) * latDegPerMeter;
  const lngOffset = randomRadius * Math.sin(randomAngle) * lngDegPerMeter;

  return {
    lat: center.lat + latOffset,
    lng: center.lng + lngOffset,
  };
}

// Create geofence from center point and radius (circle boundary)
export function createGeoFence(center: GeoLocation, radiusMeters: number): GeoFence {
  // Approximate degrees per meter at given latitude
  const latDegPerMeter = 1 / 111320;
  const lngDegPerMeter = 1 / (111320 * Math.cos((center.lat * Math.PI) / 180));

  const latOffset = radiusMeters * latDegPerMeter;
  const lngOffset = radiusMeters * lngDegPerMeter;

  const bounds: GeoBounds = {
    north: center.lat + latOffset,
    south: center.lat - latOffset,
    east: center.lng + lngOffset,
    west: center.lng - lngOffset,
  };

  return {
    center,
    bounds,
    radiusMeters,
    boundaryType: 'circle',
  };
}

// Create geofence from polygon vertices
export function createPolygonGeoFence(polygonPoints: GeoLocation[]): GeoFence {
  if (polygonPoints.length < 3) {
    throw new Error('Polygon must have at least 3 points');
  }

  // Calculate bounding box using Turf.js
  const coords = [...polygonPoints.map(p => [p.lng, p.lat]), [polygonPoints[0].lng, polygonPoints[0].lat]];
  const turfPoly = turfPolygon([coords]);
  const [west, south, east, north] = bbox(turfPoly);

  const bounds: GeoBounds = { north, south, east, west };

  // Calculate center as centroid of bounding box
  const center: GeoLocation = {
    lat: (north + south) / 2,
    lng: (east + west) / 2,
  };

  // Calculate approximate radius (half of diagonal) for fallback/display purposes
  const diagonalMeters = calculateDistance(
    { lat: south, lng: west },
    { lat: north, lng: east }
  );

  return {
    center,
    bounds,
    radiusMeters: diagonalMeters / 2,
    boundaryType: 'polygon',
    polygon: polygonPoints,
  };
}

// Select random rarity based on weights (excludes mythic - handled separately)
function selectRarity(): MonsterRarity {
  // Create weights without mythic (mythic is guaranteed, not random)
  const weights: Partial<typeof RARITY_WEIGHTS> = {
    common: RARITY_WEIGHTS.common,
    uncommon: RARITY_WEIGHTS.uncommon,
    rare: RARITY_WEIGHTS.rare,
    legendary: RARITY_WEIGHTS.legendary,
  };

  const totalWeight = Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
  let random = Math.random() * totalWeight;

  for (const [rarity, weight] of Object.entries(weights)) {
    random -= weight ?? 0;
    if (random <= 0) {
      return rarity as MonsterRarity;
    }
  }

  return 'common';
}

// Generate random monster name from the fixed set of types
function generateMonsterName(rarity: MonsterRarity): string {
  const names = MONSTER_NAMES[rarity];
  return names[Math.floor(Math.random() * names.length)];
}

// Get monster emoji by name
function getMonsterEmoji(name: string): string {
  return MONSTER_EMOJI_MAP[name] || '⚡';
}

// Generate random monster description
function generateMonsterDescription(rarity: MonsterRarity): string {
  const descriptions = MONSTER_DESCRIPTIONS[rarity];
  return descriptions[Math.floor(Math.random() * descriptions.length)];
}

// Distribute sats among monsters based on rarity
function distributeSats(totalSats: number, monsterCount: number, rarities: MonsterRarity[]): number[] {
  // Calculate relative weights for each monster
  const weights = rarities.map((rarity) => {
    const { min, max } = RARITY_MULTIPLIERS[rarity];
    return min + Math.random() * (max - min);
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // Distribute proportionally
  const amounts = weights.map((weight) => Math.floor((weight / totalWeight) * totalSats));

  // Distribute remaining sats to random monsters
  let remaining = totalSats - amounts.reduce((sum, a) => sum + a, 0);
  while (remaining > 0) {
    const idx = Math.floor(Math.random() * monsterCount);
    amounts[idx]++;
    remaining--;
  }

  return amounts;
}

// Get canonical monster type from name
function getMonsterType(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}

// OSM Element type for Overpass API responses (nodes and ways)
interface OSMElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

// Fetch streets/roads from Overpass API and return points along them
async function fetchStreetPointsFromOverpass(
  geoFence: GeoFence,
  count: number,
  retryCount = 0
): Promise<{ points: GeoLocation[]; success: boolean; error?: string }> {
  const { bounds, center, radiusMeters } = geoFence;
  const MAX_RETRIES = 2;
  const TIMEOUT_MS = 30000;

  // Fetch streets, paths, and footways (public walkable areas)
  const query = `
    [out:json][timeout:25];
    (
      way["highway"~"residential|tertiary|secondary|primary|footway|path|pedestrian|living_street|service|cycleway|unclassified"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    );
    out body;
    >;
    out skel qt;
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    console.log(`Fetching streets from Overpass API (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorMsg = `Overpass API returned status ${response.status}`;
      console.warn(errorMsg);

      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        console.log(`Retrying street fetch...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return fetchStreetPointsFromOverpass(geoFence, count, retryCount + 1);
      }

      return { points: [], success: false, error: errorMsg };
    }

    const data = await response.json();
    const elements: OSMElement[] = data.elements || [];

    // Build a map of node IDs to coordinates
    const nodeCoords = new Map<number, GeoLocation>();
    elements.forEach(el => {
      if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
        nodeCoords.set(el.id, { lat: el.lat, lng: el.lon });
      }
    });

    // Helper to check if a point is within the boundary (polygon or circle)
    const isInBoundary = (point: GeoLocation): boolean => {
      if (geoFence.boundaryType === 'polygon' && geoFence.polygon) {
        return isInsidePolygon(point, geoFence.polygon);
      }
      return calculateDistance(center, point) <= radiusMeters;
    };

    // Collect all street segments as pairs of points
    const streetSegments: Array<{ start: GeoLocation; end: GeoLocation }> = [];
    elements.forEach(el => {
      if (el.type === 'way' && el.nodes) {
        for (let i = 0; i < el.nodes.length - 1; i++) {
          const startCoord = nodeCoords.get(el.nodes[i]);
          const endCoord = nodeCoords.get(el.nodes[i + 1]);
          if (startCoord && endCoord) {
            // Only include segments within the boundary (polygon or circle)
            if (isInBoundary(startCoord) && isInBoundary(endCoord)) {
              streetSegments.push({ start: startCoord, end: endCoord });
            }
          }
        }
      }
    });

    if (streetSegments.length === 0) {
      console.log('No street segments found within hunt radius');
      return { points: [], success: true, error: 'No streets found' };
    }

    console.log(`Found ${streetSegments.length} street segments within hunt radius`);

    // Generate random points along street segments
    const points: GeoLocation[] = [];
    for (let i = 0; i < count; i++) {
      // Pick a random segment
      const segment = streetSegments[Math.floor(Math.random() * streetSegments.length)];
      // Pick a random point along the segment
      const t = Math.random();
      const point: GeoLocation = {
        lat: segment.start.lat + t * (segment.end.lat - segment.start.lat),
        lng: segment.start.lng + t * (segment.end.lng - segment.start.lng),
      };
      points.push(point);
    }

    return { points, success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.warn('Failed to fetch streets from Overpass:', errorMsg);

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying street fetch after error...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return fetchStreetPointsFromOverpass(geoFence, count, retryCount + 1);
    }

    return { points: [], success: false, error: errorMsg };
  }
}

// Result type for monster generation
export interface MonstersResult {
  monsters: Monster[];
  usedFallback: boolean;
  streetPointCount: number;
  error?: string;
}

// Calculate spawn time based on spawn mode
function calculateSpawnTime(
  index: number,
  now: number,
  spawnMode: string | undefined,
  huntDurationMs: number | undefined,
  maxConcurrentMonsters: number | undefined
): number {
  const mode = spawnMode || 'all_at_once';

  switch (mode) {
    case 'scattered': {
      // Spread spawn times across 90% of hunt duration
      const spawnWindow = (huntDurationMs || 60000) * 0.9;
      return now + Math.random() * spawnWindow;
    }

    case 'scattered_replacement': {
      // First N monsters spawn within first minute, rest are held back
      const maxConcurrent = maxConcurrentMonsters || 20;
      if (index < maxConcurrent) {
        return now + Math.random() * 60000; // Spawn within first minute
      }
      return Number.MAX_SAFE_INTEGER; // Not spawned yet - activated on capture
    }

    case 'all_at_once':
    default:
      // Current behavior: all spawn within first minute
      return now + Math.random() * 60000;
  }
}

// Generate monsters for a hunt event (async - fetches street locations)
export async function generateMonstersAsync(config: MonsterGenConfig): Promise<MonstersResult> {
  const { totalSats, monsterCount, geoFence, spawnMode, huntDurationMs, maxConcurrentMonsters } = config;

  // ALWAYS spawn exactly 1 mythic creature (Pisatchu)
  const rarities: MonsterRarity[] = ['mythic'];

  // Generate remaining monsters (excluding the 1 mythic)
  for (let i = 1; i < monsterCount; i++) {
    rarities.push(selectRarity());
  }

  // Shuffle to randomize mythic position
  for (let i = rarities.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rarities[i], rarities[j]] = [rarities[j], rarities[i]];
  }

  // Distribute sats based on rarities
  const satAmounts = distributeSats(totalSats, monsterCount, rarities);

  // Fetch street points for monster placement
  const { points: streetPoints, success, error } = await fetchStreetPointsFromOverpass(geoFence, monsterCount);

  const usedFallback = streetPoints.length < monsterCount;
  if (usedFallback) {
    console.log(`Only got ${streetPoints.length} street points, need ${monsterCount}. Will use fallback for remaining.`);
  }

  // Create monsters
  const monsters: Monster[] = [];
  const now = Date.now();

  for (let i = 0; i < monsterCount; i++) {
    const rarity = rarities[i];
    const name = generateMonsterName(rarity);

    // Use street point if available, otherwise fall back to random (should not happen ideally)
    const location = i < streetPoints.length
      ? streetPoints[i]
      : randomPointInGeoFence(geoFence);

    const monster: Monster = {
      id: generateId(),
      name,
      type: getMonsterType(name),
      description: generateMonsterDescription(rarity),
      satAmount: satAmounts[i],
      rarity,
      location,
      emoji: getMonsterEmoji(name),
      spawnTime: calculateSpawnTime(i, now, spawnMode, huntDurationMs, maxConcurrentMonsters),
      captured: false,
      invoiceStatus: 'pending',
    };
    monsters.push(monster);
  }

  return {
    monsters,
    usedFallback,
    streetPointCount: streetPoints.length,
    error: !success ? error : undefined,
  };
}

// Sync version for backwards compatibility (uses random locations - NOT RECOMMENDED)
export function generateMonsters(config: MonsterGenConfig): Monster[] {
  const { totalSats, monsterCount, geoFence } = config;

  // ALWAYS spawn exactly 1 mythic creature (Pisatchu)
  const rarities: MonsterRarity[] = ['mythic'];

  // Generate remaining monsters (excluding the 1 mythic)
  for (let i = 1; i < monsterCount; i++) {
    rarities.push(selectRarity());
  }

  // Shuffle to randomize mythic position
  for (let i = rarities.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rarities[i], rarities[j]] = [rarities[j], rarities[i]];
  }

  // Distribute sats based on rarities
  const satAmounts = distributeSats(totalSats, monsterCount, rarities);

  // Create monsters
  const monsters: Monster[] = [];
  const now = Date.now();

  for (let i = 0; i < monsterCount; i++) {
    const rarity = rarities[i];
    const name = generateMonsterName(rarity);
    const monster: Monster = {
      id: generateId(),
      name,
      type: getMonsterType(name),
      description: generateMonsterDescription(rarity),
      satAmount: satAmounts[i],
      rarity,
      location: randomPointInGeoFence(geoFence),
      emoji: getMonsterEmoji(name),
      spawnTime: now + Math.random() * 60000, // Spawn within first minute randomly
      captured: false,
      invoiceStatus: 'pending',
    };
    monsters.push(monster);
  }

  return monsters;
}

// Fetch real Points of Interest from OpenStreetMap Overpass API
interface OSMNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: {
    name?: string;
    amenity?: string;
    shop?: string;
    tourism?: string;
    leisure?: string;
    building?: string;
    [key: string]: string | undefined;
  };
}

async function fetchPOIsFromOverpass(
  geoFence: GeoFence,
  retryCount = 0
): Promise<{ pois: Array<{ name: string; lat: number; lng: number; type: string }>; success: boolean; error?: string }> {
  const { bounds, center, radiusMeters } = geoFence;
  const MAX_RETRIES = 2;
  const TIMEOUT_MS = 30000; // 30 second timeout

  // Overpass QL query for all POI types - no limit, fetch everything in the area
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"~"cafe|restaurant|bar|pub|fast_food|bank|pharmacy|hospital|library|theatre|cinema|museum|place_of_worship|community_centre|marketplace|fuel|parking"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      node["shop"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      node["tourism"~"attraction|museum|artwork|viewpoint|hotel|hostel|information|gallery"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      node["leisure"~"park|playground|sports_centre|fitness_centre|garden|swimming_pool|stadium"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      node["building"~"church|cathedral|mosque|synagogue|temple|public|government|school|university|college|hospital"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      node["office"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      node["historic"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
      node["natural"~"peak|spring|cave_entrance"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    );
    out body;
  `;

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    console.log(`Fetching POIs from Overpass API (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorMsg = `Overpass API returned status ${response.status}`;
      console.warn(errorMsg);

      // Retry on server errors (5xx)
      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        console.log(`Retrying Overpass API request...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
        return fetchPOIsFromOverpass(geoFence, retryCount + 1);
      }

      return { pois: [], success: false, error: errorMsg };
    }

    const data = await response.json();
    const nodes: OSMNode[] = data.elements || [];

    // Helper to check if a point is within the boundary (polygon or circle)
    const isInBoundary = (point: GeoLocation): boolean => {
      if (geoFence.boundaryType === 'polygon' && geoFence.polygon) {
        return isInsidePolygon(point, geoFence.polygon);
      }
      return calculateDistance(center, point) <= radiusMeters;
    };

    // Filter nodes with names, within boundary, and map to our format
    const pois = nodes
      .filter((node): node is OSMNode & { tags: { name: string } } =>
        node.type === 'node' && !!node.tags?.name
      )
      .map(node => ({
        name: node.tags.name,
        lat: node.lat,
        lng: node.lon,
        type: node.tags.amenity || node.tags.shop || node.tags.tourism || node.tags.leisure || node.tags.historic || 'place',
      }))
      // Filter to only POIs within the boundary (polygon or circle)
      .filter(poi => isInBoundary({ lat: poi.lat, lng: poi.lng }));

    console.log(`Found ${pois.length} POIs within hunt radius`);
    return { pois, success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.warn('Failed to fetch POIs from Overpass:', errorMsg);

    // Retry on network errors
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying Overpass API request after error...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
      return fetchPOIsFromOverpass(geoFence, retryCount + 1);
    }

    return { pois: [], success: false, error: errorMsg };
  }
}

// Cypherpunk-themed name generator for SatStops
function generateSatStopName(poiName: string, _poiType: string): string {
  const prefixes = ['Nakamoto', 'Satoshi', 'Cypherpunk', 'Lightning', 'Hash', 'Block', 'Node', 'Freedom'];
  const suffixes = ['Stop', 'Cache', 'Hub', 'Point', 'Station', 'Beacon'];

  // Use POI name if it's short enough, otherwise generate themed name
  if (poiName.length <= 20) {
    return poiName;
  }

  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${prefix} ${suffix}`;
}

// Result type for SatStop generation
export interface SatStopsResult {
  stops: SatStop[];
  usedFallback: boolean;
  poiCount: number;
  error?: string;
}

// Generate sat stops from ALL real POIs within the hunt radius
export async function generateSatStopsAsync(geoFence: GeoFence): Promise<SatStopsResult> {
  // Fetch all real POIs within the hunt radius
  const { pois, success, error } = await fetchPOIsFromOverpass(geoFence);

  const stops: SatStop[] = [];
  let usedFallback = false;

  // Convert all POIs to SatStops
  for (const poi of pois) {
    stops.push({
      id: generateId(),
      name: generateSatStopName(poi.name, poi.type),
      description: `Collect SatCubes at ${poi.name}!`,
      location: { lat: poi.lat, lng: poi.lng },
      cooldownMs: 5 * 60 * 1000, // 5 minute cooldown per stop
      ballsPerCollection: 3 + Math.floor(Math.random() * 3), // 3-5 balls
    });
  }

  // If no POIs found, add some fallback stops at random locations
  if (stops.length === 0) {
    usedFallback = true;
    const fallbackReason = !success ? `API error: ${error}` : 'No named POIs found in area';
    console.log(`Using fallback SatStops: ${fallbackReason}`);

    const fallbackNames = [
      'Nakamoto Node', 'Cypherpunk Cache', 'Lightning Lair',
      'Hash Hub', 'Block Beacon', 'Satoshi Shrine',
      'Freedom Forge', 'Privacy Point', 'Consensus Corner'
    ];

    for (const name of fallbackNames) {
      stops.push({
        id: generateId(),
        name,
        description: `Collect SatCubes at ${name} to capture more creatures!`,
        location: randomPointInGeoFence(geoFence),
        cooldownMs: 5 * 60 * 1000,
        ballsPerCollection: 3 + Math.floor(Math.random() * 3),
      });
    }
  }

  console.log(`Created ${stops.length} SatStops for hunt (POIs: ${pois.length}, fallback: ${usedFallback})`);
  return {
    stops,
    usedFallback,
    poiCount: pois.length,
    error: usedFallback ? error : undefined,
  };
}

// Generate sat stops (sync fallback - uses random locations)
export function generateSatStops(geoFence: GeoFence, count: number = 5): SatStop[] {
  const stopNames = [
    'Nakamoto Node',
    'Cypherpunk Cache',
    'Lightning Lair',
    'Hash Hub',
    'Block Beacon',
    'Satoshi Shrine',
    'Meme Mansion',
    'Freedom Forge',
    'Privacy Point',
    'Consensus Corner',
  ];

  const stops: SatStop[] = [];

  for (let i = 0; i < count && i < stopNames.length; i++) {
    stops.push({
      id: generateId(),
      name: stopNames[i],
      description: `Collect SatCubes at ${stopNames[i]} to capture more creatures!`,
      location: randomPointInGeoFence(geoFence),
      cooldownMs: 5 * 60 * 1000, // 5 minutes cooldown
      ballsPerCollection: 3 + Math.floor(Math.random() * 3), // 3-5 balls
    });
  }

  return stops;
}

// Calculate time remaining in human readable format
export function formatTimeRemaining(endTime: number): string {
  const remaining = endTime - Date.now();

  if (remaining <= 0) return 'Ended';

  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((remaining % (1000 * 60)) / 1000);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

// Format countdown to a future start time
export function formatCountdown(startTime: number): string {
  const remaining = startTime - Date.now();

  if (remaining <= 0) return 'Starting now';

  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `in ${days}d ${hours}h`;
  } else if (hours > 0) {
    return `in ${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `in ${minutes}m`;
  } else {
    return 'in <1m';
  }
}

// Format sats with commas
export function formatSats(sats: number | undefined | null): string {
  return (sats ?? 0).toLocaleString();
}

// Get rarity color class
export function getRarityColor(rarity: MonsterRarity): string {
  switch (rarity) {
    case 'common':
      return 'text-gray-400';
    case 'uncommon':
      return 'text-green-400';
    case 'rare':
      return 'text-blue-400';
    case 'legendary':
      return 'text-purple-400';
    case 'mythic':
      return 'text-yellow-400';
    default:
      return 'text-gray-400';
  }
}

// Get rarity background class
export function getRarityBgColor(rarity: MonsterRarity): string {
  switch (rarity) {
    case 'common':
      return 'bg-gray-500/20 border-gray-500/50';
    case 'uncommon':
      return 'bg-green-500/20 border-green-500/50';
    case 'rare':
      return 'bg-blue-500/20 border-blue-500/50';
    case 'legendary':
      return 'bg-purple-500/20 border-purple-500/50';
    case 'mythic':
      return 'bg-yellow-500/20 border-yellow-500/50 animate-glow-pulse';
    default:
      return 'bg-gray-500/20 border-gray-500/50';
  }
}

// Get rarity glow class
export function getRarityGlow(rarity: MonsterRarity): string {
  switch (rarity) {
    case 'common':
      return '';
    case 'uncommon':
      return 'shadow-glow-green';
    case 'rare':
      return 'shadow-[0_0_15px_hsl(200_90%_60%/0.4)]';
    case 'legendary':
      return 'shadow-glow-purple';
    case 'mythic':
      return 'shadow-glow-orange animate-glow-pulse';
    default:
      return '';
  }
}

// Sort and rank leaderboard
export function calculateLeaderboard(
  playerStats: Map<string, { totalSats: number; monstersCount: number; displayName?: string; avatar?: string }>
): LeaderboardEntry[] {
  const entries = Array.from(playerStats.entries())
    .map(([pubkey, stats]) => ({
      pubkey,
      ...stats,
      rank: 0,
    }))
    .sort((a, b) => b.totalSats - a.totalSats);

  return entries.map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

// Check if monster is within capture range (15 meters = ~50 feet)
export function isInCaptureRange(
  playerLocation: GeoLocation,
  monsterLocation: GeoLocation,
  rangeMeters: number = 15
): boolean {
  return calculateDistance(playerLocation, monsterLocation) <= rangeMeters;
}

// Check if player is at a sat stop (10 meters range)
export function isAtSatStop(
  playerLocation: GeoLocation,
  stopLocation: GeoLocation,
  rangeMeters: number = 10
): boolean {
  return calculateDistance(playerLocation, stopLocation) <= rangeMeters;
}

// Calculate total sats from captured monsters
export function calculateTotalSats(capturedMonsters: CapturedMonster[]): number {
  return capturedMonsters.reduce((sum, monster) => sum + monster.satAmount, 0);
}

// Get monster size class based on sat amount
export function getMonsterSize(satAmount: number, totalSats: number): string {
  const ratio = satAmount / (totalSats / 100); // relative to average
  if (ratio > 5) return 'w-20 h-20 text-5xl';
  if (ratio > 2) return 'w-16 h-16 text-4xl';
  if (ratio > 1) return 'w-14 h-14 text-3xl';
  return 'w-12 h-12 text-2xl';
}

// Validate hunt configuration
export function validateHuntConfig(
  totalSats: number,
  monsterCount: number,
  durationMinutes: number
): { valid: boolean; error?: string } {
  if (totalSats < 100) {
    return { valid: false, error: 'Minimum total sats is 100' };
  }
  if (monsterCount < 10) {
    return { valid: false, error: 'Minimum monster count is 10' };
  }
  if (monsterCount > 500) {
    return { valid: false, error: 'Maximum monster count is 500' };
  }
  if (durationMinutes < 15) {
    return { valid: false, error: 'Minimum hunt duration is 15 minutes' };
  }
  if (durationMinutes > 480) {
    return { valid: false, error: 'Maximum hunt duration is 8 hours' };
  }
  if (totalSats / monsterCount < 10) {
    return { valid: false, error: 'Average sats per monster must be at least 10' };
  }

  return { valid: true };
}

/**
 * Why the demo end screen should show, or null if it should not.
 * Only ever fires for demo hunts (a real hunt returns null — its ending is the
 * host-driven HuntEndedDialog, never this conversion screen). Reasons, in priority
 * order: the whole field was cleared, the mythic Pisatchu was captured, or the
 * 30-minute demo window elapsed. All-captured must rank above mythic: every demo
 * contains exactly one mythic, so a cleared field would otherwise re-evaluate to
 * the already-dismissed 'mythic' reason and the end screen could never reopen
 * after "Keep exploring".
 */
export type DemoEndReason = 'mythic' | 'all-captured' | 'time-expired';

export function getDemoEndReason(
  hunt: HuntEvent | null | undefined,
  now: number = Date.now()
): DemoEndReason | null {
  if (!hunt?.isDemo) return null;
  if (hunt.monsters.length > 0 && hunt.monsters.every((m) => m.captured)) return 'all-captured';
  if (hunt.monsters.some((m) => m.rarity === 'mythic' && m.captured)) return 'mythic';
  if (now > hunt.endTime) return 'time-expired';
  return null;
}

/** Convenience boolean wrapper around getDemoEndReason. */
export function shouldShowDemoEnd(
  hunt: HuntEvent | null | undefined,
  now: number = Date.now()
): boolean {
  return getDemoEndReason(hunt, now) !== null;
}
