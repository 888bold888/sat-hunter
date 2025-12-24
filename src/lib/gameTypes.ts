// Sat Hunter Game Types

export interface GeoLocation {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface GeoFence {
  center: GeoLocation;
  bounds: GeoBounds;
  radiusMeters: number;
}

export type MonsterRarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic';

export interface Monster {
  id: string;
  name: string;
  type: string; // e.g., "ratasat", "pisatchu" - the canonical type name
  description: string;
  satAmount: number;
  rarity: MonsterRarity;
  location: GeoLocation;
  imageUrl?: string;
  emoji: string; // Fallback visual
  spawnTime: number;
  captured: boolean;
  capturedBy?: string; // pubkey
  capturedAt?: number;
  // Lightning invoice for this specific monster's reward
  invoice?: string;
  invoiceStatus?: 'pending' | 'paid' | 'expired';
}

export interface SatStop {
  id: string;
  name: string;
  description: string;
  location: GeoLocation;
  cooldownMs: number;
  lastCollected?: number;
  ballsPerCollection: number;
}

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';
export type HuntStatus = 'draft' | 'pending_payment' | 'ready' | 'active' | 'ended';

export interface HuntEvent {
  id: string;
  name: string;
  description: string;
  hostPubkey: string;
  totalSats: number;
  monsterCount: number;
  geoFence: GeoFence;
  startTime: number;
  endTime: number;
  createdAt: number;
  monsters: Monster[];
  satStops: SatStop[];
  status: HuntStatus;
  // Payment tracking
  paymentStatus: PaymentStatus;
  lightningInvoice?: string;
  paymentHash?: string;
  // Sharing
  shareCode: string; // Short code for joining
  shareUrl?: string;
  // Player tracking (for host dashboard)
  participants: HuntParticipant[];
}

export interface HuntParticipant {
  pubkey: string;
  joinedAt: number;
  lastLocation?: GeoLocation;
  lastLocationUpdate?: number;
  totalCaptured: number;
  totalSatsEarned: number;
}

export interface PlayerStats {
  pubkey: string;
  totalCaptured: number;
  totalSatsEarned: number;
  capturedMonsters: CapturedMonster[];
  balls: number;
}

export interface CapturedMonster {
  monsterId: string;
  monsterName: string;
  satAmount: number;
  rarity: MonsterRarity;
  capturedAt: number;
  huntId: string;
}

export interface LeaderboardEntry {
  rank: number;
  pubkey: string;
  displayName?: string;
  avatar?: string;
  totalSats: number;
  monstersCount: number;
}

// Monster Generation Config
export interface MonsterGenConfig {
  totalSats: number;
  monsterCount: number;
  geoFence: GeoFence;
}

// Rarity weights for distribution (percentage of total spawns)
// Common spawns the most, mythic only once
export const RARITY_WEIGHTS: Record<MonsterRarity, number> = {
  common: 50,    // ~50% of all spawns
  uncommon: 25,  // ~25% of all spawns
  rare: 15,      // ~15% of all spawns
  legendary: 9,  // ~9% of all spawns
  mythic: 1,     // Exactly 1 spawn per hunt
};

// Rarity multipliers for sat distribution
// Mythic gets the highest value, common gets smallest
export const RARITY_MULTIPLIERS: Record<MonsterRarity, { min: number; max: number }> = {
  common: { min: 0.3, max: 0.7 },     // Smallest denomination
  uncommon: { min: 0.8, max: 1.5 },
  rare: { min: 2.0, max: 4.0 },
  legendary: { min: 5.0, max: 10.0 },
  mythic: { min: 20.0, max: 30.0 },   // Highest value - only 1 per hunt
};

// Pokémon-inspired monster names with cypherpunk theme
// Fixed set of 11 total monster types
export const MONSTER_NAMES = {
  common: ['Ratasat', 'Saterpie', 'Satgey'], // 3 types
  uncommon: ['Mesatpod', 'Satgeotto'], // 2 types
  rare: ['Saterfree', 'Satgeot'], // 2 types
  legendary: ['Bulsatba', 'Satmander', 'Saturtle'], // 3 types
  mythic: ['Pisatchu'], // 1 type - THE rarest, only spawns once per hunt
};

// Fixed emoji for each monster type
export const MONSTER_EMOJI_MAP: Record<string, string> = {
  'Ratasat': '🐀',
  'Saterpie': '🐛',
  'Satgey': '🐥',
  'Mesatpod': '🫛',
  'Satgeotto': '🦉',
  'Saterfree': '🦋',
  'Satgeot': '🦅',
  'Bulsatba': '🐸',
  'Satmander': '🔥',
  'Saturtle': '🐢',
  'Pisatchu': '⚡️',
};

// Cypherpunk descriptions
export const MONSTER_DESCRIPTIONS: Record<MonsterRarity, string[]> = {
  common: [
    'A humble creature of the mempool',
    'Born from spare satoshis',
    'Lurks in the digital shadows',
    'A friend to all node operators',
    'Lives on forgotten UTXOs'
  ],
  uncommon: [
    'Defender of the blockchain',
    'Guardian of private keys',
    'Messenger of the Lightning Network',
    'Keeper of hash power',
    'Wanderer of the decentralized realm'
  ],
  rare: [
    'Forged in the fires of consensus',
    'Ancient creature of the cypherpunks',
    'Wielder of cryptographic power',
    'Born from the genesis block',
    'Master of zero-knowledge'
  ],
  legendary: [
    'Avatar of financial freedom',
    'Champion of self-sovereignty',
    'Destroyer of central banks',
    'Herald of the hyperbitcoinization',
    'Liberator of the unbanked'
  ],
  mythic: [
    'The embodiment of Satoshi\'s vision',
    'Manifestation of pure freedom',
    'The ultimate cypherpunk deity',
    'Legendary creator of digital gold',
    'The sovereign being itself'
  ],
};
