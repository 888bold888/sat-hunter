import { useState, useEffect, useRef, useCallback } from 'react';
import { useGame } from '@/contexts/GameContext';
import type { Monster, SatStop } from '@/lib/gameTypes';
import { GameHUD } from '@/components/game/GameHUD';
import { GameMap } from '@/components/game/GameMap';
import { Leaderboard } from '@/components/game/Leaderboard';
import { CapturedInventory } from '@/components/game/CapturedInventory';
import { CreateHuntForm } from '@/components/game/CreateHuntForm';
import { CaptureSuccessDialog } from '@/components/game/CaptureSuccessDialog';
import { HuntEndedDialog } from '@/components/game/HuntEndedDialog';
import { HostDashboard } from '@/components/game/HostDashboard';
import { PaymentConfirmation } from '@/components/game/PaymentConfirmation';
import { PlayerStatsView } from '@/components/game/PlayerStatsView';
import { DevTools } from '@/components/game/DevTools';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePublishHuntEnd } from '@/hooks/usePublishHuntEnd';
import { useHuntSync } from '@/hooks/useHuntSync';
import { useMyHunts } from '@/hooks/useMyHunts';
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
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Target, ArrowLeft, LogOut, Sparkles, QrCode, BarChart3, Zap, Clock, RefreshCw, Radio, Loader2, X, Trash2 } from 'lucide-react';
import { formatSats, formatTimeRemaining } from '@/lib/gameUtils';
import { Link, useNavigate } from 'react-router-dom';

export default function GamePage() {
  const { state, leaveHunt, joinHunt, startLocationTracking, stopLocationTracking, isHost } = useGame();
  const { activeHunt } = state;
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { data: myHunts, isLoading: isLoadingMyHunts, refetch: refetchMyHunts } = useMyHunts();

  const [selectedMonster, setSelectedMonster] = useState<Monster | null>(null);
  const [selectedStop, setSelectedStop] = useState<SatStop | null>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showCreateHunt, setShowCreateHunt] = useState(false);
  const [capturedMonster, setCapturedMonster] = useState<Monster | null>(null);
  const [showCaptureSuccess, setShowCaptureSuccess] = useState(false);
  const [showHuntEnded, setShowHuntEnded] = useState(false);
  const huntEndedShownRef = useRef(false);

  // Dismissed past hunts (stored in localStorage)
  const [dismissedHuntIds, setDismissedHuntIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('dismissedHuntIds');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const dismissHunt = useCallback((huntId: string) => {
    setDismissedHuntIds(prev => {
      const updated = [...prev, huntId];
      localStorage.setItem('dismissedHuntIds', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearAllPastHunts = useCallback(() => {
    if (!myHunts) return;
    const pastHuntIds = myHunts.filter(h => !h.isActive).map(h => h.id);
    setDismissedHuntIds(prev => {
      const updated = [...new Set([...prev, ...pastHuntIds])];
      localStorage.setItem('dismissedHuntIds', JSON.stringify(updated));
      return updated;
    });
  }, [myHunts]);

  const userIsHost = isHost();
  const { mutateAsync: publishHuntEnd } = usePublishHuntEnd();

  // Handle hunt ended callback from sync (for players)
  const handleHuntEndedFromSync = useCallback(() => {
    if (!huntEndedShownRef.current) {
      huntEndedShownRef.current = true;
      setShowHuntEnded(true);
    }
  }, []);

  // Sync hook for players to detect when host ends the hunt
  useHuntSync(
    !userIsHost ? activeHunt : null, // Only use for players
    {
      onMonsterCaptured: () => {}, // Players don't need to handle this
      onPlayerJoined: () => {}, // Players don't need to handle this
      onHuntEnded: handleHuntEndedFromSync,
    }
  );

  // Handle host ending the hunt
  const handleEndHunt = useCallback(async () => {
    if (activeHunt && activeHunt.paymentStatus === 'paid') {
      // Dismiss this hunt from "My Hunts" list immediately to prevent re-joining
      dismissHunt(activeHunt.id);

      // Publish end event to Nostr so players get notified
      try {
        await publishHuntEnd(activeHunt);
      } catch (err) {
        console.error('Failed to publish hunt end:', err);
        // Continue with leaving even if publish fails
      }

      // Refetch my hunts to get updated status from Nostr
      refetchMyHunts();
    }
    leaveHunt();
  }, [activeHunt, publishHuntEnd, leaveHunt, dismissHunt, refetchMyHunts]);

  useSeoMeta({
    title: activeHunt ? `${activeHunt.name} | Sat Hunter` : 'Sat Hunter',
    description: 'Hunt for Bitcoin in the real world!',
  });

  // Start location tracking when entering game
  useEffect(() => {
    startLocationTracking();
    return () => stopLocationTracking();
  }, [startLocationTracking, stopLocationTracking]);

  // Detect hunt end for players and show notification
  useEffect(() => {
    if (!activeHunt || userIsHost) return;

    // Check if hunt has ended (either by status or by time)
    const huntEnded = activeHunt.status === 'ended' || Date.now() > activeHunt.endTime;

    if (huntEnded && !huntEndedShownRef.current) {
      huntEndedShownRef.current = true;
      setShowHuntEnded(true);
    }
  }, [activeHunt, userIsHost]);

  // Reset the hunt ended ref when hunt changes
  useEffect(() => {
    if (!activeHunt) {
      huntEndedShownRef.current = false;
    }
  }, [activeHunt]);

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

          {/* My Hunts - Recovery Section */}
          {user && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold flex items-center gap-2">
                  <Radio className="w-5 h-5 text-primary" />
                  My Hunts
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetchMyHunts()}
                  disabled={isLoadingMyHunts}
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingMyHunts ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              {isLoadingMyHunts && (
                <Alert className="border-blue-500/30 bg-blue-500/5">
                  <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                  <AlertDescription>
                    Searching for your hunts on Nostr...
                  </AlertDescription>
                </Alert>
              )}

              {!isLoadingMyHunts && myHunts && myHunts.length > 0 && (
                <div className="space-y-2">
                  {myHunts.filter(h => h.isActive).length > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground">Active hunts you're hosting:</p>
                      {myHunts.filter(h => h.isActive).map((hunt) => (
                        <Card
                          key={hunt.id}
                          className="bg-card/80 backdrop-blur border-primary/30 hover:border-primary/60 transition-colors cursor-pointer"
                          onClick={() => joinHunt(hunt.fullHunt)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <h3 className="font-display font-bold">{hunt.name}</h3>
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                                  ACTIVE
                                </Badge>
                              </div>
                              <Badge variant="outline" className="font-mono">
                                {hunt.shareCode}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Zap className="w-3 h-3 text-primary" />
                                <span>{formatSats(hunt.totalSats)}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Target className="w-3 h-3 text-accent" />
                                <span>{hunt.monsterCount} creatures</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-secondary" />
                                <span>{formatTimeRemaining(hunt.endTime)}</span>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </>
                  )}

                  {myHunts.filter(h => !h.isActive && !dismissedHuntIds.includes(h.id)).length > 0 && (
                    <>
                      <div className="flex items-center justify-between mt-4">
                        <p className="text-xs text-muted-foreground">Past hunts:</p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearAllPastHunts}
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Clear all
                        </Button>
                      </div>
                      {myHunts.filter(h => !h.isActive && !dismissedHuntIds.includes(h.id)).slice(0, 5).map((hunt) => (
                        <Card
                          key={hunt.id}
                          className="bg-card/50 backdrop-blur border-border/50 opacity-60"
                        >
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-display text-sm truncate flex-1">{hunt.name}</span>
                              <Badge variant="outline" className="text-xs flex-shrink-0">
                                {hunt.status === 'ended' ? 'Ended' : hunt.paymentStatus !== 'paid' ? 'Unpaid' : 'Expired'}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => dismissHunt(hunt.id)}
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </>
                  )}
                </div>
              )}

              {!isLoadingMyHunts && (!myHunts || myHunts.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  No hunts found. Create your first hunt above!
                </p>
              )}
            </div>
          )}
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
              onClick={needsPayment ? leaveHunt : handleEndHunt}
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

      {/* Hunt Ended Dialog */}
      <HuntEndedDialog
        open={showHuntEnded}
        onClose={() => setShowHuntEnded(false)}
      />

      {/* Dev Tools (only in development) */}
      <DevTools />
    </div>
  );
}
