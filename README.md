# ⚡ SAT HUNTER

> Hunt Bitcoin in the Real World! A Pokémon GO-style scavenger hunt with Lightning rewards.

<div align="center">

🐸 🦊 🐉 👻 👑

**Catch cypherpunk creatures containing real satoshis.**

Built on [Nostr](https://nostr.com/) • Powered by [Lightning](https://lightning.network/) ⚡

</div>

---

## 🎮 What is Sat Hunter?

Sat Hunter is a geo-location-based scavenger hunt game where:

- 🎯 **Hosts** deploy Bitcoin satoshis into a geo-fenced area (e.g., a few city blocks)
- 🗺️ **Sats appear as creatures** scattered across the map with varying rarity and value
- 🏃 **Players explore** the real world to find and catch creatures using their phone
- ⚡ **Instant rewards** - captured creatures pay out sats via Lightning Network
- 🏆 **Compete on leaderboards** during timed hunt events

Think Pokémon GO meets Bitcoin treasure hunting with a cypherpunk aesthetic!

---

## ✨ Features

### For Players
- 🗺️ **Real-time map** showing nearby creatures and collection stops
- 🔮 **5 Rarity tiers** - Common to Mythic creatures with escalating rewards
- 🟢 **SatBalls** - Collect at designated stops to catch more creatures
- 📊 **Live stats** - Track your captures, earnings, and ranking
- 🎉 **Capture celebrations** - Confetti and animations for successful catches
- 🏆 **Leaderboards** - See top hunters in real-time

### For Hosts
- 🎯 **Easy hunt creation** - Set total sats, duration, and area radius
- 📍 **Geo-fencing** - Define hunt boundaries (100m - 2km radius)
- ⏱️ **Timed events** - 15 minutes to 8 hours
- 🎲 **Automatic distribution** - Sats randomly allocated to creatures by rarity
- 📍 **SatStops** - Auto-generated collection points for players
- 📊 **Real-time Dashboard** - Live map overview with player pins, monster locations, and stats
- 🔗 **Easy Sharing** - QR codes and 6-character codes for players to join
- 💰 **Payment confirmation** - Lightning invoice confirmation before hunt activation

### Technical
- 🔐 **Nostr authentication** - Login with your npub
- ⚡ **Lightning payments** - Instant sat payouts via NWC or WebLN
- 📱 **Mobile-first PWA** - Install as an app
- 🌍 **GPS tracking** - Real-time location with privacy controls
- 💾 **Local-first** - Progress saved in browser
- 🎨 **Cypherpunk theme** - Dark mode with neon accents

---

## 🎲 The 11 Creature Types

Sat Hunter features **exactly 11 unique creature types**, each with fixed rarity and spawn mechanics:

| Rarity | Type | Sat Value | Spawns Per Hunt |
|--------|------|-----------|-----------------|
| **Common** 🟢 | Ratasat | Low | ~50% of total |
| **Common** 🟢 | Saterpie | Low | ~50% of total |
| **Common** 🟢 | Satgey | Low | ~50% of total |
| **Uncommon** 🔵 | Mesatpod | Medium-Low | ~25% of total |
| **Uncommon** 🔵 | Satgeotto | Medium-Low | ~25% of total |
| **Rare** 💎 | Saterfree | Medium | ~15% of total |
| **Rare** 💎 | Satgeot | Medium | ~15% of total |
| **Legendary** 🟣 | Bulsatba | High | ~9% of total |
| **Legendary** 🟣 | Satmander | High | ~9% of total |
| **Legendary** 🟣 | Saturtle | High | ~9% of total |
| **Mythic** 👑 | Pisatchu | **Highest** | **Exactly 1** |

### Spawn Mechanics
- **Mythic (Pisatchu)**: Always spawns exactly **once per hunt** with the highest sat value
- **Legendary**: ~9% spawn rate, high sat rewards
- **Rare**: ~15% spawn rate, medium sat rewards
- **Uncommon**: ~25% spawn rate, medium-low sat rewards
- **Common**: ~50% spawn rate, lowest sat denominations (most abundant)

---

## 🚀 Quick Start

### Requirements

- **HTTPS Connection**: Geolocation API requires secure context (HTTPS or localhost)
- **GPS-enabled Device**: Mobile phone or laptop with location services
- **Modern Browser**: Chrome, Firefox, Safari, or Edge with geolocation support
- **Nostr Login**: Browser extension like Alby, nos2x, or similar

### Players

1. **Visit the app** - Navigate to the deployed URL (must be HTTPS)
2. **Enable location** - Grant GPS permissions when prompted
3. **Login with Nostr** - Use your favorite Nostr extension
4. **Join or create** - Join an existing hunt or create your own
5. **Start hunting** - Walk around and catch creatures!

### Creating a Hunt

1. Click "Create a Hunt" on the play page
2. Enter hunt details:
   - Name and description
   - Total sats to deploy (10k - 10M)
   - Number of creatures (10 - 500)
   - Duration (15 min - 8 hours)
   - Radius (100m - 2km)
3. Your current location becomes the hunt center
4. Creatures spawn with randomized locations and rarities
5. Share hunt link with players!

---

## 🎨 Design Philosophy

**Cypherpunk Aesthetic**
- Bitcoin orange (#f97316) as primary
- Cyber green (#22c55e) for energy/collection
- Neon purple (#a855f7) for legendary elements
- Dark base with glowing accents

**Inspiration**
- Pokémon GO mechanics
- Bitcoin maximalism
- Cypherpunk movement
- Meme culture (Pepe, Guy Fawkes)
- Lightning-fast gameplay

---

## 🛠️ Tech Stack

- **Frontend**: React 18 + TypeScript
- **Styling**: TailwindCSS 3 + Custom animations
- **UI Components**: shadcn/ui (Radix UI)
- **Nostr**: Nostrify + nostr-tools
- **Lightning**: NWC (Nostr Wallet Connect) + WebLN
- **Routing**: React Router 6
- **Build**: Vite
- **State**: React Context + TanStack Query

---

## 🎯 How It Works

### Game Loop

```
1. Host creates hunt → Deploys X sats
2. System generates Y creatures with rarities
3. Creatures spawn at random locations within geofence
4. Players join hunt → Start GPS tracking
5. Players walk to creature locations
6. Within range → Spend SatBall → Catch creature
7. Instant Lightning payout of creature's sats
8. Repeat until hunt ends or all creatures caught
```

### Sat Distribution Algorithm

1. **Rarity selection**: Weighted random (50% common, 30% uncommon, etc.)
2. **Sat allocation**: Proportional to rarity multipliers
3. **Randomization**: Each rarity has min/max multiplier range
4. **Remainder distribution**: Leftover sats randomly assigned

### Location Mechanics

- **Visibility range**: 3 meters (~10 feet) - creatures only appear on your map when you're this close
- **Capture range**: 3 meters from creature
- **SatStop range**: 10 meters from stop
- **Cooldown**: 5 minutes between collections at same stop
- **GPS accuracy**: High accuracy mode required
- **Geofence**: Clearly marked boundaries visible on player map
- **Discovery**: Players must physically explore to find creatures (no markers until in range)

---

## 🔒 Privacy & Security

- **No tracking**: Location data never leaves your device
- **Nostr-native**: Self-sovereign identity
- **Non-custodial**: Lightning payouts via your own wallet
- **Local storage**: Hunt progress stored in browser
- **Optional sharing**: Choose what data to share

---

## 📱 Mobile Support

Sat Hunter is a Progressive Web App (PWA):

- ✅ Install to home screen
- ✅ Offline-capable UI
- ✅ GPS background tracking
- ✅ Push notifications (coming soon)
- ✅ Touch-optimized controls

---

## 🎮 Future Features

- [ ] Multi-player co-op hunts
- [ ] Team battles and competitions
- [ ] Custom creature creation with AI
- [ ] NFT collectibles for rare catches
- [ ] Hunt templates and presets
- [ ] Social features and following
- [ ] Achievement badges
- [ ] Seasonal events
- [ ] Hunt marketplace

---

## 🛠️ Development

### Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Run dev server: `npm run dev`
4. Access at `http://localhost:5173`

### Testing Without GPS

For development/testing without GPS hardware:

1. Open the app in development mode
2. Click the "Dev Tools" button (bottom right)
3. Enable "Use Mock Location"
4. Set coordinates or use default (San Francisco)
5. Page will reload with mock location active

### Environment Variables

No environment variables required for basic functionality. The app works entirely client-side with browser storage.

---

## 🤝 Contributing

Sat Hunter is open source! Contributions welcome:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## 📄 License

MIT License - see LICENSE file

---

## 🙏 Acknowledgments

- Built with [Shakespeare](https://shakespeare.diy) - AI-powered website builder
- Inspired by Pokémon GO and the Bitcoin community
- Thanks to Nostr and Lightning Network developers
- Special shoutout to all Pepe enthusiasts 🐸

---

<div align="center">

**Hunt Bitcoin. Own Your Data. Stay Sovereign.**

🐸 ⚡ 🔥

[Vibed with Shakespeare](https://shakespeare.diy)

</div>
