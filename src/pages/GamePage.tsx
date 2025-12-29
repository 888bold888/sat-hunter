import { useState, useEffect } from 'react';
import { useGame } from '@/contexts/GameContext';
import type { Monster, SatStop } from '@/lib/gameTypes';
import { GameHUD } from '@/components/game/GameHUD';
import { GameMap } from '@/components/game/GameMap';
import { Leaderboard } from '@/components/game/Leaderboard';
import { CapturedInventory } from '@/components/game/CapturedInventory';
import { CreateHuntForm } from '@/components/game/CreateHuntForm';
import { CaptureSuccessDialog } from '@/components/game/CaptureSuccessDialog';
import { HostDashboard } from '@/components/game/HostDashboard';
import { PaymentConfirmation } from '@/components/game/PaymentConfirmation';
import { PlayerStatsView } from '@/components/game/PlayerStatsView';
import { DevTools } from '@/components/game/DevTools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSeoMeta } from '@unhead/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Target, ArrowLeft, LogOut, Sparkles, QrCode, BarChart3 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export default function GamePage() {
  const { state, leaveHunt, startLocationTracking, stopLocationTracking, isHost } = useGame();
  const { activeHunt } = state;
  const { user } = useCurrentUser();
  const navigate = useNavigate();

  const [selectedMonster, setSelectedMonster] = useState<Monster | null>(null);
  const [selectedStop, setSelectedStop] = useState<SatStop | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showCreateHunt, setShowCreateHunt] = useState(false);
  const [capturedMonster, setCapturedMonster] = useState<Monster | null>(null);
  const [showCaptureSuccess, setShowCaptureSuccess] = useState(false);

  const userIsHost = isHost();

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

          {/* Join Hunt Option */}
          <Card
            className="bg-card/80 backdrop-blur border-secondary/30 hover:border-secondary/60 transition-colors cursor-pointer"
            onClick={() => navigate('/join')}
          >
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-secondary to-green-600 flex items-center justify-center">
                <QrCode className="w-8 h-8 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-display font-bold text-lg">Join a Hunt</h3>
                <p className="text-sm text-muted-foreground">
                  Enter a code to join an existing hunt
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Create Hunt Dialog */}
        <Dialog open={showCreateHunt} onOpenChange={setShowCreateHunt}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-card/95 backdrop-blur border-primary/30">
            <DialogHeader>
              <DialogTitle className="sr-only">Create a New Hunt</DialogTitle>
              <DialogDescription className="sr-only">Configure and deploy a new hunt</DialogDescription>
            </DialogHeader>
            <CreateHuntForm onHuntCreated={() => setShowCreateHunt(false)} />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Active hunt view - different for host vs player
  // Host sees payment confirmation first if not paid, then dashboard
  if (userIsHost) {
    const needsPayment = activeHunt.status === 'pending_payment' || activeHunt.paymentStatus !== 'paid';

    return (
      <div className="min-h-screen bg-background bg-cyber-grid">
        <div className="container max-w-lg mx-auto p-4 py-8 space-y-4">
          {/* Host Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link to="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="font-display text-xl font-bold text-primary">
                  {needsPayment ? 'Complete Payment' : 'Host Dashboard'}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {needsPayment ? 'Pay to activate your hunt' : 'Monitor your hunt'}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={leaveHunt}
            >
              <LogOut className="w-4 h-4 mr-1" />
              {needsPayment ? 'Cancel' : 'End'}
            </Button>
          </div>

          {/* Show PaymentConfirmation if not paid, otherwise HostDashboard */}
          {needsPayment ? <PaymentConfirmation /> : <HostDashboard />}

          {/* Dev Tools */}
          <DevTools />
        </div>
      </div>
    );
  }

  // Player view
  // Use isolation and proper stacking contexts to fix iOS Safari z-index issues with Leaflet
  return (
    <div className="fixed inset-0 bg-background" style={{ isolation: 'isolate' }}>
      {/* Map Layer - full screen, contained in its own stacking context */}
      <div className="absolute inset-0" style={{ zIndex: 0, isolation: 'isolate' }}>
        <GameMap
          selectedMonster={selectedMonster}
          selectedStop={selectedStop}
          onSelectMonster={setSelectedMonster}
          onSelectStop={setSelectedStop}
          onMonsterCaptured={(monster) => {
            setCapturedMonster(monster);
            setShowCaptureSuccess(true);
          }}
        />
      </div>

      {/* HUD Layer - fixed positioned elements with hardware acceleration for iOS */}
      <GameHUD
        onOpenLeaderboard={() => setShowLeaderboard(true)}
        onOpenInventory={() => setShowInventory(true)}
        onOpenStats={() => setShowStats(true)}
      />

      {/* Quick Exit Button */}
      <Button
        variant="outline"
        size="sm"
        className="fixed top-36 right-4 bg-card/80 backdrop-blur border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
        style={{ zIndex: 50, transform: 'translateZ(0)' }}
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
            <DialogDescription className="sr-only">View rankings and scores for this hunt</DialogDescription>
          </DialogHeader>
          <Leaderboard currentUserPubkey={user?.pubkey} />
        </DialogContent>
      </Dialog>

      {/* Inventory Dialog */}
      <Dialog open={showInventory} onOpenChange={setShowInventory}>
        <DialogContent className="max-w-md bg-card/95 backdrop-blur border-secondary/30">
          <DialogHeader>
            <DialogTitle className="sr-only">My Captured Creatures</DialogTitle>
            <DialogDescription className="sr-only">View all creatures you have captured</DialogDescription>
          </DialogHeader>
          <CapturedInventory />
        </DialogContent>
      </Dialog>

      {/* Stats Dialog */}
      <Dialog open={showStats} onOpenChange={setShowStats}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto bg-card/95 backdrop-blur border-accent/30">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-accent" />
              My Stats
            </DialogTitle>
            <DialogDescription className="sr-only">View your hunting statistics and achievements</DialogDescription>
          </DialogHeader>
          <PlayerStatsView />
        </DialogContent>
      </Dialog>

      {/* Capture Success Dialog */}
      <CaptureSuccessDialog
        monster={capturedMonster}
        open={showCaptureSuccess}
        onClose={() => {
          setShowCaptureSuccess(false);
          setCapturedMonster(null);
        }}
      />

      {/* Dev Tools (only in development) */}
      <DevTools />
    </div>
  );
}
