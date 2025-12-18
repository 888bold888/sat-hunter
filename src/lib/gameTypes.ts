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
  status: 'upcoming' | 'active' | 'ended';
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

// Cypherpunk-themed monster names
export const MONSTER_NAMES = {
  common: [
    'Bit Blob', 'Hash Hopper', 'Node Nibbler', 'Chain Chick', 'Block Bunny',
    'Frog Fren', 'Sats Snail', 'Meme Mite', 'Cyber Cub', 'Digital Duckling'
  ],
  uncommon: [
    'Lightning Lemur', 'Protocol Panther', 'Merkle Monkey', 'Pepe Puppy', 'Satoshi Squirrel',
    'Anonymous Anteater', 'Decentralized Deer', 'P2P Penguin', 'Consensus Cat', 'Wallet Wolf'
  ],
  rare: [
    'Nakamoto Naga', 'Cypherpunk Chimera', 'Freedom Fox', 'Sovereign Serpent', 'Privacy Panther',
    'Lightning Lord', 'Hash Hawk', 'Blockchain Bear', 'Rebel Raven', 'Matrix Mantis'
  ],
  legendary: [
    'Guy Fawkes Ghost', 'Pepe Prime', 'Bitcoin Basilisk', 'Anon Alpha', 'Satoshi Spirit',
    'Cipher Cerberus', 'Revolution Rex', 'Freedom Phoenix', 'Decentralized Dragon', 'Liberty Lion'
  ],
  mythic: [
    'Satoshi Nakamoto', 'The Anonymous One', 'Genesis Ghost', 'Hal Finney Spirit', 'Cypherpunk God',
    'The Orange Pill Dragon', 'Ultimate Pepe', 'Freedom Incarnate', 'The Sovereign', 'Lightning Emperor'
  ],
};

// Monster emojis by rarity
export const MONSTER_EMOJIS: Record<MonsterRarity, string[]> = {
  common: ['🐸', '🦎', '🐛', '🦗', '🐌', '🐣', '🐥', '🦔', '🐹', '🐁'],
  uncommon: ['🦊', '🐺', '🦝', '🦨', '🦦', '🦥', '🐨', '🐼', '🦘', '🦙'],
  rare: ['🦅', '🦉', '🐉', '🐲', '🦖', '🦕', '🦈', '🐊', '🦁', '🐯'],
  legendary: ['🔥', '⚡', '💀', '👻', '🤖', '👽', '🦹', '🧙', '🎭', '👁️'],
  mythic: ['🏆', '💎', '⭐', '🌟', '✨', '🔱', '👑', '🗡️', '🛡️', '💫'],
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
