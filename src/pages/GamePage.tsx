import { useState, useEffect } from 'react';
import { useGame } from '@/contexts/GameContext';
import type { Monster, SatStop } from '@/lib/gameTypes';
import { GameHUD } from '@/components/game/GameHUD';
import { GameMap } from '@/components/game/GameMap';
import { Leaderboard } from '@/components/game/Leaderboard';
import { CapturedInventory } from '@/components/game/CapturedInventory';
import { CreateHuntForm } from '@/components/game/CreateHuntForm';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSeoMeta } from '@unhead/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Target, ArrowLeft, LogOut, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function GamePage() {
  const { state, leaveHunt, startLocationTracking, stopLocationTracking } = useGame();
  const { activeHunt } = state;
  const { user } = useCurrentUser();

  const [selectedMonster, setSelectedMonster] = useState<Monster | null>(null);
  const [selectedStop, setSelectedStop] = useState<SatStop | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showCreateHunt, setShowCreateHunt] = useState(false);

  useSeoMeta({
    title: activeHunt ? `${activeHunt.name} | Sat Hunter` : 'Sat Hunter',
    description: 'Hunt for Bitcoin in the real world!',
  });

  // Start location tracking when entering game
  useEffect(() => {
    startLocationTracking();
    return () => stopLocationTracking();
  }, [startLocationTracking, stopLocationTracking]);

  // If no active hunt, show create/join options
  if (!activeHunt) {
    return (
      <div className="min-h-screen bg-background bg-cyber-grid">
        <div className="container max-w-lg mx-auto p-4 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="font-display text-2xl font-bold text-primary text-glow-orange">
                Sat Hunter
              </h1>
              <p className="text-sm text-muted-foreground">Start or join a hunt</p>
            </div>
          </div>

          {/* Create Hunt Option */}
          <Card
            className="bg-card/80 backdrop-blur border-primary/30 hover:border-primary/60 transition-colors cursor-pointer shadow-glow-orange"
            onClick={() => setShowCreateHunt(true)}
          >
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-orange-600 flex items-center justify-center">
                <Target className="w-8 h-8 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-lg">Create a Hunt</h3>
                <p className="text-sm text-muted-foreground">
                  Deploy sats as creatures for others to catch
                </p>
              </div>
              <Sparkles className="w-5 h-5 text-primary animate-pulse" />
            </CardContent>
          </Card>

          {/* Join Hunt Info */}
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">
                To join a hunt, scan a hunt QR code or receive an invite link from a host.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Create Hunt Dialog */}
        <Dialog open={showCreateHunt} onOpenChange={setShowCreateHunt}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card/95 backdrop-blur border-primary/30">
            <DialogHeader>
              <DialogTitle className="sr-only">Create a New Hunt</DialogTitle>
            </DialogHeader>
            <CreateHuntForm onHuntCreated={() => setShowCreateHunt(false)} />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Active hunt view
  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* HUD */}
      <GameHUD
        onOpenLeaderboard={() => setShowLeaderboard(true)}
        onOpenInventory={() => setShowInventory(true)}
      />

      {/* Map */}
      <GameMap
        selectedMonster={selectedMonster}
        selectedStop={selectedStop}
        onSelectMonster={setSelectedMonster}
        onSelectStop={setSelectedStop}
      />

      {/* Quick Exit Button */}
      <Button
        variant="outline"
        size="sm"
        className="absolute top-36 right-4 z-30 bg-card/80 backdrop-blur border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
        onClick={leaveHunt}
      >
        <LogOut className="w-4 h-4 mr-1" />
        Leave Hunt
      </Button>

      {/* Leaderboard Dialog */}
      <Dialog open={showLeaderboard} onOpenChange={setShowLeaderboard}>
        <DialogContent className="max-w-md bg-card/95 backdrop-blur border-primary/30">
          <DialogHeader>
            <DialogTitle className="sr-only">Hunt Leaderboard</DialogTitle>
          </DialogHeader>
          <Leaderboard currentUserPubkey={user?.pubkey} />
        </DialogContent>
      </Dialog>

      {/* Inventory Dialog */}
      <Dialog open={showInventory} onOpenChange={setShowInventory}>
        <DialogContent className="max-w-md bg-card/95 backdrop-blur border-secondary/30">
          <DialogHeader>
            <DialogTitle className="sr-only">My Captured Creatures</DialogTitle>
          </DialogHeader>
          <CapturedInventory />
        </DialogContent>
      </Dialog>
    </div>
  );
}
