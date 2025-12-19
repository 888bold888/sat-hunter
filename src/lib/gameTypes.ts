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

// Rarity weights for distribution
export const RARITY_WEIGHTS: Record<MonsterRarity, number> = {
  common: 50,
  uncommon: 30,
  rare: 13,
  legendary: 5,
  mythic: 2,
};

// Rarity multipliers for sat distribution
export const RARITY_MULTIPLIERS: Record<MonsterRarity, { min: number; max: number }> = {
  common: { min: 0.5, max: 1.0 },
  uncommon: { min: 1.0, max: 2.0 },
  rare: { min: 2.0, max: 5.0 },
  legendary: { min: 5.0, max: 15.0 },
  mythic: { min: 15.0, max: 50.0 },
};

// Pokémon-inspired monster names with cypherpunk theme
export const MONSTER_NAMES = {
  common: [
    'Ratasat', 'Saterpie', 'Satgey', 'Satdle', 'Bittle',
    'Pepechu', 'Satby', 'Nodeon', 'Hashrat', 'Blocklett'
  ],
  uncommon: [
    'Mesatpod', 'Satgeotto', 'Ratisate', 'Pepemon', 'Lightning Lemur',
    'Hashbug', 'Nodepup', 'Cyphercat', 'Blockbun', 'Chainling'
  ],
  rare: [
    'Saterfree', 'Satgeot', 'Freedom Fox', 'Hash Hawk', 'Lightning Lord',
    'Nakamoto Naga', 'Cypherpunk Chimera', 'Sovereign Serpent', 'Privacy Panther', 'Rebel Raven'
  ],
  legendary: [
    'Bulsatba', 'Satmander', 'Saturtle', 'Guy Fawkes Ghost', 'Pepe Prime',
    'Bitcoin Basilisk', 'Anon Alpha', 'Cipher Cerberus', 'Revolution Rex', 'Freedom Phoenix'
  ],
  mythic: [
    'Pisatchu', 'The Anonymous One', 'Genesis Ghost', 'Hal Finney Spirit',
    'The Orange Pill Dragon', 'Ultimate Pepe', 'Freedom Incarnate', 'The Sovereign', 'Lightning Emperor', 'Cypherpunk God'
  ],
};

// Monster emojis by rarity (Pokémon-inspired)
export const MONSTER_EMOJIS: Record<MonsterRarity, string[]> = {
  common: ['🐁', '🐛', '🐦', '🐢', '🐝', '🐸', '🦎', '🐌', '🦗', '🐣'],
  uncommon: ['🐛', '🐦', '🐁', '🐸', '🦊', '🐺', '🦝', '🐨', '🦘', '🦙'],
  rare: ['🐦', '🦅', '🦊', '🦅', '⚡', '🐉', '🐲', '🦈', '🦁', '🐯'],
  legendary: ['🐢', '🔥', '💧', '👻', '⚡', '💀', '🤖', '🎭', '🧙', '👁️'],
  mythic: ['⚡', '👑', '💎', '⭐', '🌟', '✨', '🔱', '🗡️', '🛡️', '💫'],
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
