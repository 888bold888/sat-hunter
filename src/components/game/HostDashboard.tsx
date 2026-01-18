import { useEffect, useState, useCallback } from 'react';
import { useGame } from '@/contexts/GameContext';
import { formatSats, formatTimeRemaining } from '@/lib/gameUtils';
import { HuntMap } from './HuntMap';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Zap,
  Users,
  Clock,
  Target,
  Skull,
  Eye,
  Play,
  QrCode,
  Copy,
  Check,
  Navigation,
  RefreshCw,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useHuntSync } from '@/hooks/useHuntSync';
import { usePayPlayer } from '@/hooks/usePayPlayer';
import { useToast } from '@/hooks/useToast';

export function HostDashboard() {
  const { state, startHunt, isHost, addParticipant } = useGame();
  const { activeHunt, playerLocation } = state;
  const [timeRemaining, setTimeRemaining] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [syncedCaptures, setSyncedCaptures] = useState<Map<string, { playerPubkey: string; satAmount: number }>>(new Map());
  const [syncedPlayers, setSyncedPlayers] = useState<Set<string>>(new Set());
  const [paidCaptures, setPaidCaptures] = useState<Set<string>>(new Set());
  const [payingCaptures, setPayingCaptures] = useState<Set<string>>(new Set());

  const { payPlayer } = usePayPlayer();
  const { toast } = useToast();

  // Pay player when a capture is detected
  const processPayment = useCallback(async (
    monsterId: string,
    playerPubkey: string,
    satAmount: number,
    monsterName: string
  ) => {
    // Skip if already paid or currently paying
    if (paidCaptures.has(monsterId) || payingCaptures.has(monsterId)) {
      return;
    }

    setPayingCaptures(prev => new Set(prev).add(monsterId));

    const result = await payPlayer(playerPubkey, satAmount, monsterName);

    if (result.success) {
      setPaidCaptures(prev => new Set(prev).add(monsterId));
      toast({
        title: `Payment sent! ⚡`,
        description: `${satAmount} sats sent for capturing ${monsterName}`,
      });
    } else {
      toast({
        title: 'Payment failed',
        description: result.error || 'Could not pay player',
        variant: 'destructive',
      });
    }

    setPayingCaptures(prev => {
      const next = new Set(prev);
      next.delete(monsterId);
      return next;
    });
  }, [payPlayer, paidCaptures, payingCaptures, toast]);

  // Callbacks for hunt sync
  const onMonsterCaptured = useCallback((monsterId: string, playerPubkey: string, satAmount: number) => {
    setSyncedCaptures(prev => {
      const next = new Map(prev);
      next.set(monsterId, { playerPubkey, satAmount });
      return next;
    });
    // Also track player if not already in participants
    setSyncedPlayers(prev => {
      const next = new Set(prev);
      next.add(playerPubkey);
      return next;
    });

    // Find the monster name and trigger payment
    if (activeHunt) {
      const monster = activeHunt.monsters.find(m => m.id === monsterId);
      if (monster && !paidCaptures.has(monsterId)) {
        processPayment(monsterId, playerPubkey, satAmount, monster.name);
      }
    }
  }, [activeHunt, paidCaptures, processPayment]);

  const onPlayerJoined = useCallback((playerPubkey: string) => {
    setSyncedPlayers(prev => {
      const next = new Set(prev);
      next.add(playerPubkey);
      return next;
    });
    // Add to game context participants
    addParticipant(playerPubkey);
  }, [addParticipant]);

  // Subscribe to hunt updates via Nostr
  const { refresh: refreshSync } = useHuntSync(activeHunt, {
    onMonsterCaptured,
    onPlayerJoined,
  });

  // Update time remaining
  useEffect(() => {
    if (!activeHunt) return;
    const updateTime = () => setTimeRemaining(formatTimeRemaining(activeHunt.endTime));
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [activeHunt]);

  // Generate QR code
  useEffect(() => {
    if (activeHunt?.shareUrl) {
      QRCode.toDataURL(activeHunt.shareUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#f97316', light: '#0d0f14' },
      }).then(setQrCodeUrl);
    }
  }, [activeHunt?.shareUrl]);



  if (!activeHunt || !isHost()) return null;

  // Calculate stats combining local state and synced Nostr events
  // Use the higher of local or synced counts (they might overlap)
  const capturedMonsterIds = new Set([
    ...activeHunt.monsters.filter(m => m.captured).map(m => m.id),
    ...syncedCaptures.keys(),
  ]);
  const capturedCount = capturedMonsterIds.size;

  // Calculate sats - combine but avoid double counting using monster IDs
  const satsCollected = activeHunt.monsters
    .filter(m => capturedMonsterIds.has(m.id))
    .reduce((sum, m) => sum + m.satAmount, 0);

  const satsRemaining = activeHunt.totalSats - satsCollected;
  const progress = (capturedCount / activeHunt.monsterCount) * 100;
  const isEnded = Date.now() > activeHunt.endTime;

  // Combine participants from local state and synced events
  const allPlayerPubkeys = new Set([
    ...activeHunt.participants.map(p => p.pubkey),
    ...syncedPlayers,
  ]);
  const playerCount = allPlayerPubkeys.size;

  const handleCopyLink = () => {
    if (activeHunt.shareUrl) {
      navigator.clipboard.writeText(activeHunt.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const canStart = activeHunt.status === 'ready' && activeHunt.paymentStatus === 'paid';

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-primary/10 border-primary/30">
          <CardContent className="p-3 text-center">
            <Zap className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="font-display text-xl font-bold text-primary">
              {formatSats(satsRemaining)}
            </p>
            <p className="text-xs text-muted-foreground">Remaining</p>
          </CardContent>
        </Card>
        <Card className="bg-secondary/10 border-secondary/30">
          <CardContent className="p-3 text-center">
            <Users className="w-5 h-5 mx-auto text-secondary mb-1" />
            <p className="font-display text-xl font-bold text-secondary">
              {playerCount}
            </p>
            <p className="text-xs text-muted-foreground">Players</p>
          </CardContent>
        </Card>
        <Card className={`border-accent/30 ${payingCaptures.size > 0 ? 'bg-yellow-500/10' : paidCaptures.size > 0 ? 'bg-green-500/10' : 'bg-muted/30'}`}>
          <CardContent className="p-3 text-center">
            <Check className={`w-5 h-5 mx-auto mb-1 ${payingCaptures.size > 0 ? 'text-yellow-500 animate-pulse' : 'text-green-500'}`} />
            <p className="font-display text-xl font-bold">
              {paidCaptures.size}/{capturedCount}
            </p>
            <p className="text-xs text-muted-foreground">
              {payingCaptures.size > 0 ? 'Paying...' : 'Paid'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Event Status */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              {activeHunt.name}
            </span>
            <Badge
              variant={isEnded ? 'destructive' : activeHunt.status === 'active' ? 'default' : 'outline'}
              className={activeHunt.status === 'active' ? 'bg-secondary' : ''}
            >
              {activeHunt.status === 'active' ? (
                <>
                  <Clock className="w-3 h-3 mr-1" />
                  {timeRemaining}
                </>
              ) : (
                activeHunt.status.toUpperCase()
              )}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Progress */}
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>
                <Skull className="w-3 h-3 inline mr-1" />
                {capturedCount}/{activeHunt.monsterCount}
              </span>
              <span>{Math.round(progress)}% captured</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Start Button (if ready) */}
          {canStart && (
            <Button
              onClick={startHunt}
              className="w-full bg-gradient-to-r from-secondary to-green-600 shadow-glow-green"
            >
              <Play className="w-4 h-4 mr-2" />
              Start Hunt Now
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Live Map Overview */}
      <Card className="border-accent/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-accent" />
            Live Map Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-64 rounded-lg overflow-hidden">
            <HuntMap
              center={activeHunt.geoFence.center}
              radiusMeters={activeHunt.geoFence.radiusMeters}
              playerLocation={playerLocation}
              monsters={activeHunt.monsters}
              satStops={activeHunt.satStops}
              showAllMonsters={true}
              boundaryType={activeHunt.geoFence.boundaryType}
              polygon={activeHunt.geoFence.polygon}
            />
          </div>
        </CardContent>
      </Card>

      {/* Share Section */}
      <Card className="border-accent/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <QrCode className="w-4 h-4 text-accent" />
            Share Hunt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* QR Code */}
          {qrCodeUrl && (
            <div className="flex justify-center">
              <img src={qrCodeUrl} alt="Hunt QR Code" className="w-32 h-32 rounded-lg" />
            </div>
          )}

          {/* Share Code */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Hunt Code</p>
            <p className="font-mono text-2xl font-bold tracking-widest text-primary">
              {activeHunt.shareCode}
            </p>
          </div>

          {/* Copy Link */}
          <Button variant="outline" onClick={handleCopyLink} className="w-full">
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-2 text-secondary" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                Copy Invite Link
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Player List */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Players ({playerCount})
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshSync}
              className="h-6 w-6 p-0"
              title="Refresh player data"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {playerCount === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No players have joined yet. Share the code above!
            </p>
          ) : (
            <ScrollArea className="h-32">
              <div className="space-y-2">
                {Array.from(allPlayerPubkeys).map((pubkey, i) => {
                  // Get local participant data if available
                  const localParticipant = activeHunt.participants.find(p => p.pubkey === pubkey);
                  // Calculate synced stats for this player
                  const playerCaptures = Array.from(syncedCaptures.entries())
                    .filter(([, data]) => data.playerPubkey === pubkey);
                  const syncedCaptureCount = playerCaptures.length;
                  const syncedSats = playerCaptures.reduce((sum, [, data]) => sum + data.satAmount, 0);
                  // Combine stats
                  const totalCaptured = Math.max(localParticipant?.totalCaptured || 0, syncedCaptureCount);
                  const totalSats = Math.max(localParticipant?.totalSatsEarned || 0, syncedSats);

                  return (
                    <div
                      key={pubkey}
                      className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded"
                    >
                      <span className="flex items-center gap-2">
                        <Navigation className="w-3 h-3 text-blue-500" />
                        Player {i + 1}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {totalCaptured} caught • {formatSats(totalSats)} sats
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
