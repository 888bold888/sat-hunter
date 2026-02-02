import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { LoginArea } from '@/components/auth/LoginArea';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGame } from '@/contexts/GameContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Zap,
  Target,
  MapPin,
  Shield,
  Play,
  Users,
  Clock,
  ChevronRight,
  Bitcoin,
  Radio,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const Index = () => {
  const { user } = useCurrentUser();
  const { state, isHost } = useGame();
  const { activeHunt } = state;

  // Check if current user is hosting an active hunt
  const hasActiveHostHunt = activeHunt && isHost() && activeHunt.status !== 'ended';

  useSeoMeta({
    title: 'Sat Hunter - Hunt Bitcoin IRL',
    description: 'A Bitcoin scavenger hunt.',
  });

  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 bg-cyber-grid pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-radial from-primary/5 via-transparent to-transparent pointer-events-none" />

      {/* Hero Section */}
      <section className="relative min-h-screen flex flex-col">
        {/* Header */}
        <header className="relative z-20 p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-orange-600 flex items-center justify-center shadow-glow-orange">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <span className="font-display font-bold text-xl hidden sm:inline">SAT HUNTER</span>
          </div>
          <LoginArea />
        </header>

        {/* Active Hunt Banner - Shows when host has an active hunt */}
        {hasActiveHostHunt && (
          <div className="relative z-20 px-4 pb-2">
            <Link to="/play">
              <Card className="bg-gradient-to-r from-primary/20 to-orange-600/20 border-primary/50 hover:border-primary transition-colors cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Radio className="w-5 h-5 text-primary animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold text-sm">Active Hunt</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            activeHunt.status === 'active' && "bg-green-500/20 text-green-400 border-green-500/30",
                            activeHunt.status === 'ready' && "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
                            activeHunt.status === 'pending_payment' && "bg-orange-500/20 text-orange-400 border-orange-500/30"
                          )}
                        >
                          {activeHunt.status === 'active' ? 'LIVE' : activeHunt.status === 'ready' ? 'READY' : 'PENDING'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {activeHunt.name}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" className="bg-primary hover:bg-primary/90">
                    <span className="hidden sm:inline mr-1">Go to</span> Dashboard
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </CardContent>
              </Card>
            </Link>
          </div>
        )}

        {/* Hero Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 pb-20 text-center">
          {/* Floating Creatures Animation */}
          <div className="relative mb-8">
            <div className="absolute -top-16 -left-20 text-5xl animate-float opacity-60">🐸</div>
            <div className="absolute -top-8 -right-16 text-4xl animate-float delay-300 opacity-60">⚡</div>
            <div className="absolute top-12 -left-24 text-3xl animate-float delay-500 opacity-40">🔥</div>
            <div className="absolute top-16 -right-20 text-4xl animate-float delay-700 opacity-50">🦊</div>

            {/* Main Logo */}
            <div className="relative">
              <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary via-orange-500 to-yellow-500 flex items-center justify-center shadow-glow-orange animate-glow-pulse">
                <Bitcoin className="w-16 h-16 text-white" />
              </div>
              {/* Radar rings */}
              <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-radar" />
              <div className="absolute -inset-4 rounded-full border border-primary/20 animate-radar delay-500" />
            </div>
          </div>

          {/* Title */}
          <h1 className="font-display text-5xl md:text-7xl font-black mb-4 tracking-tight">
            <span className="text-glow-orange bg-gradient-to-r from-primary via-orange-400 to-yellow-500 bg-clip-text text-transparent">
              SAT HUNTER
            </span>
          </h1>

          {/* Tagline */}
          <p className="text-xl md:text-2xl text-muted-foreground mb-2 max-w-md">
            Hunt <span className="text-primary font-bold">Bitcoin</span> in the Real World
          </p>
          <p className="text-sm text-muted-foreground mb-8 max-w-sm">
            Capture creatures. Stack sats.
          </p>

          {/* CTA Button */}
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md px-4">
            <Link to="/play" className="flex-1">
              <Button
                size="lg"
                className="w-full h-14 font-display text-lg bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange group"
              >
                <Play className="w-5 h-5 mr-2 group-hover:scale-110 transition-transform" />
                Start Hunting
                <ChevronRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>

          {/* Login Prompt */}
          {!user && (
            <p className="mt-6 text-sm text-muted-foreground">
              <Shield className="w-4 h-4 inline mr-1" />
              Login with Nostr to save progress and receive sats
            </p>
          )}
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
          <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex items-start justify-center p-2">
            <div className="w-1 h-2 bg-muted-foreground/50 rounded-full animate-pulse" />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="relative py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-center mb-8">
            How It <span className="text-primary">Works</span>
          </h2>

          <Tabs defaultValue="players" className="w-full">
            <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-8">
              <TabsTrigger value="players" className="font-display">
                <Play className="w-4 h-4 mr-2" />
                Players
              </TabsTrigger>
              <TabsTrigger value="hosts" className="font-display">
                <Users className="w-4 h-4 mr-2" />
                Hosts
              </TabsTrigger>
            </TabsList>

            {/* Players Tab */}
            <TabsContent value="players">
              <div className="grid md:grid-cols-3 gap-6">
                <Card className="bg-card/60 backdrop-blur border-primary/20 hover:border-primary/50 transition-colors group">
                  <CardContent className="p-6 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/30 group-hover:scale-110 transition-transform">
                      <Target className="w-8 h-8 text-primary" />
                    </div>
                    <Badge className="mb-3 bg-primary/20 text-primary border-primary/30">Step 1</Badge>
                    <h3 className="font-display font-bold text-lg mb-2">Join a Hunt</h3>
                    <p className="text-sm text-muted-foreground">
                      Scan a QR code or enter a share code to join a live hunt in your area
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-card/60 backdrop-blur border-secondary/20 hover:border-secondary/50 transition-colors group">
                  <CardContent className="p-6 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-secondary/20 to-secondary/5 flex items-center justify-center border border-secondary/30 group-hover:scale-110 transition-transform">
                      <MapPin className="w-8 h-8 text-secondary" />
                    </div>
                    <Badge className="mb-3 bg-secondary/20 text-secondary border-secondary/30">Step 2</Badge>
                    <h3 className="font-display font-bold text-lg mb-2">Find Creatures</h3>
                    <p className="text-sm text-muted-foreground">
                      Walk around the real world - creatures appear on your map when you get close
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-card/60 backdrop-blur border-accent/20 hover:border-accent/50 transition-colors group">
                  <CardContent className="p-6 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center border border-accent/30 group-hover:scale-110 transition-transform">
                      <Zap className="w-8 h-8 text-accent" />
                    </div>
                    <Badge className="mb-3 bg-accent/20 text-accent border-accent/30">Step 3</Badge>
                    <h3 className="font-display font-bold text-lg mb-2">Capture & Stack</h3>
                    <p className="text-sm text-muted-foreground">
                      Tap to capture and claim sats instantly to your Lightning wallet
                    </p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Hosts Tab */}
            <TabsContent value="hosts">
              <div className="grid md:grid-cols-3 gap-6">
                <Card className="bg-card/60 backdrop-blur border-primary/20 hover:border-primary/50 transition-colors group">
                  <CardContent className="p-6 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center border border-primary/30 group-hover:scale-110 transition-transform">
                      <MapPin className="w-8 h-8 text-primary" />
                    </div>
                    <Badge className="mb-3 bg-primary/20 text-primary border-primary/30">Step 1</Badge>
                    <h3 className="font-display font-bold text-lg mb-2">Set the Area</h3>
                    <p className="text-sm text-muted-foreground">
                      Draw a boundary on the map where creatures will spawn
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-card/60 backdrop-blur border-secondary/20 hover:border-secondary/50 transition-colors group">
                  <CardContent className="p-6 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-secondary/20 to-secondary/5 flex items-center justify-center border border-secondary/30 group-hover:scale-110 transition-transform">
                      <Bitcoin className="w-8 h-8 text-secondary" />
                    </div>
                    <Badge className="mb-3 bg-secondary/20 text-secondary border-secondary/30">Step 2</Badge>
                    <h3 className="font-display font-bold text-lg mb-2">Fund with Sats</h3>
                    <p className="text-sm text-muted-foreground">
                      Deposit sats via Lightning - they become the prizes players capture
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-card/60 backdrop-blur border-accent/20 hover:border-accent/50 transition-colors group">
                  <CardContent className="p-6 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center border border-accent/30 group-hover:scale-110 transition-transform">
                      <Users className="w-8 h-8 text-accent" />
                    </div>
                    <Badge className="mb-3 bg-accent/20 text-accent border-accent/30">Step 3</Badge>
                    <h3 className="font-display font-bold text-lg mb-2">Share & Watch</h3>
                    <p className="text-sm text-muted-foreground">
                      Share the join code and watch players hunt in real-time
                    </p>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      {/* Creature Showcase */}
      <section className="relative py-20 px-4 bg-gradient-to-b from-transparent via-muted/30 to-transparent">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold mb-4">
            Sat <span className="text-accent">Creatures</span>
          </h2>
          <p className="text-muted-foreground mb-12 max-w-md mx-auto">
            From common Ratasats to the mythic Pisatchu, each creature holds real Bitcoin value
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            {[
              { emoji: '🐁', name: 'Ratasat', rarity: 'Common', color: 'gray' },
              { emoji: '🐛', name: 'Mesatpod', rarity: 'Uncommon', color: 'green' },
              { emoji: '🦅', name: 'Satgeot', rarity: 'Rare', color: 'blue' },
              { emoji: '🔥', name: 'Satmander', rarity: 'Legendary', color: 'purple' },
              { emoji: '⚡', name: 'Pisatchu', rarity: 'Mythic', color: 'yellow' },
            ].map((creature) => (
              <Card
                key={creature.name}
                className={cn(
                  'w-28 bg-card/60 backdrop-blur border-2 hover:scale-105 transition-transform cursor-pointer',
                  creature.color === 'gray' && 'border-gray-500/30 hover:border-gray-500/60',
                  creature.color === 'green' && 'border-green-500/30 hover:border-green-500/60',
                  creature.color === 'blue' && 'border-blue-500/30 hover:border-blue-500/60',
                  creature.color === 'purple' && 'border-purple-500/30 hover:border-purple-500/60',
                  creature.color === 'yellow' &&
                    'border-yellow-500/30 hover:border-yellow-500/60 animate-glow-pulse'
                )}
              >
                <CardContent className="p-4 text-center">
                  <span className="text-4xl block mb-2">{creature.emoji}</span>
                  <p className="text-xs font-medium truncate">{creature.name}</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] mt-1',
                      creature.color === 'gray' && 'text-gray-400 border-gray-500/30',
                      creature.color === 'green' && 'text-green-400 border-green-500/30',
                      creature.color === 'blue' && 'text-blue-400 border-blue-500/30',
                      creature.color === 'purple' && 'text-purple-400 border-purple-500/30',
                      creature.color === 'yellow' && 'text-yellow-400 border-yellow-500/30'
                    )}
                  >
                    {creature.rarity}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="relative py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 gap-6 max-w-md mx-auto">
            {[
              { icon: Users, value: 'P2P', label: 'Decentralized', color: 'secondary' },
              { icon: Clock, value: '⚡', label: 'Instant Payouts', color: 'primary' },
            ].map((stat) => (
              <Card key={stat.label} className="bg-card/40 backdrop-blur border-border/50">
                <CardContent className="p-6 text-center">
                  <stat.icon
                    className={cn(
                      'w-8 h-8 mx-auto mb-2',
                      stat.color === 'primary' && 'text-primary',
                      stat.color === 'secondary' && 'text-secondary',
                      stat.color === 'accent' && 'text-accent'
                    )}
                  />
                  <p className="font-display font-black text-2xl md:text-3xl">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-12 px-4 border-t border-border/50">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-primary" />
            <span className="font-display font-bold">SAT HUNTER</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Capture sats. Own your data. Stay sovereign.
          </p>
          <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
            <span>Built on Nostr</span>
            <span>•</span>
            <span>Powered by Lightning</span>
          </div>
          <div className="mt-6 text-xl animate-float">🐸⚡🔥</div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
