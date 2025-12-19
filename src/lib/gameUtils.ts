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
} from './gameTypes';

import {
  RARITY_WEIGHTS,
  RARITY_MULTIPLIERS,
  MONSTER_NAMES,
  MONSTER_EMOJIS,
  MONSTER_DESCRIPTIONS,
} from './gameTypes';

// Generate a random ID
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Generate a short share code for joining hunts
export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusable chars (0,O,1,I)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
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

// Check if a point is inside a geofence
export function isInsideGeoFence(point: GeoLocation, geoFence: GeoFence): boolean {
  const { bounds } = geoFence;
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lng >= bounds.west &&
    point.lng <= bounds.east
  );
}

// Generate random point within geofence
export function randomPointInGeoFence(geoFence: GeoFence): GeoLocation {
  const { bounds } = geoFence;
  const lat = bounds.south + Math.random() * (bounds.north - bounds.south);
  const lng = bounds.west + Math.random() * (bounds.east - bounds.west);
  return { lat, lng };
}

// Create geofence from center point and radius
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
  };
}

// Select random rarity based on weights (excludes mythic - handled separately)
function selectRarity(): MonsterRarity {
  const weights = { ...RARITY_WEIGHTS };
  delete weights.mythic; // Mythic is guaranteed, not random

  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (const [rarity, weight] of Object.entries(weights)) {
    random -= weight;
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

// Generate random monster emoji
function getMonsterEmoji(rarity: MonsterRarity): string {
  const emojis = MONSTER_EMOJIS[rarity];
  return emojis[Math.floor(Math.random() * emojis.length)];
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

// Generate monsters for a hunt event
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
      emoji: getMonsterEmoji(rarity),
      spawnTime: now + Math.random() * 60000, // Spawn within first minute randomly
      captured: false,
      invoiceStatus: 'pending',
    };
    monsters.push(monster);
  }

  return monsters;
}

// Generate sat stops (collection points)
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
      description: `Collect SatBalls at ${stopNames[i]} to catch more creatures!`,
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

// Format sats with commas
export function formatSats(sats: number): string {
  return sats.toLocaleString();
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

// Check if monster is within capture range (3 meters = ~10 feet)
export function isInCaptureRange(
  playerLocation: GeoLocation,
  monsterLocation: GeoLocation,
  rangeMeters: number = 3
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
