import { useEffect, useState, useRef } from 'react';
import { useGame } from '@/contexts/GameContext';
import { formatSats, formatTimeRemaining, calculateDistance } from '@/lib/gameUtils';
import type { GeoLocation } from '@/lib/gameTypes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Zap,
  Users,
  MapPin,
  Clock,
  Target,
  Skull,
  Eye,
  Play,
  QrCode,
  Copy,
  Check,
  Navigation,
  Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import QRCode from 'qrcode';

export function HostDashboard() {
  const { state, startHunt, isHost } = useGame();
  const { activeHunt, playerLocation } = state;
  const [timeRemaining, setTimeRemaining] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapDimensions, setMapDimensions] = useState({ width: 0, height: 0 });

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

  // Update map dimensions
  useEffect(() => {
    const updateDimensions = () => {
      if (mapRef.current) {
        setMapDimensions({
          width: mapRef.current.offsetWidth,
          height: mapRef.current.offsetHeight,
        });
      }
    };
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  if (!activeHunt || !isHost()) return null;

  const capturedCount = activeHunt.monsters.filter((m) => m.captured).length;
  const satsCollected = activeHunt.monsters
    .filter((m) => m.captured)
    .reduce((sum, m) => sum + m.satAmount, 0);
  const satsRemaining = activeHunt.totalSats - satsCollected;
  const progress = (capturedCount / activeHunt.monsterCount) * 100;
  const isEnded = Date.now() > activeHunt.endTime;

  // Convert geo to pixel for mini-map
  const geoToPixel = (loc: GeoLocation): { x: number; y: number } | null => {
    if (!mapDimensions.width) return null;
    const { bounds } = activeHunt.geoFence;
    const x = ((loc.lng - bounds.west) / (bounds.east - bounds.west)) * mapDimensions.width;
    const y = ((bounds.north - loc.lat) / (bounds.north - bounds.south)) * mapDimensions.height;
    return { x, y };
  };

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
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-primary/10 border-primary/30">
          <CardContent className="p-4 text-center">
            <Zap className="w-6 h-6 mx-auto text-primary mb-1" />
            <p className="font-display text-2xl font-bold text-primary">
              {formatSats(satsRemaining)}
            </p>
            <p className="text-xs text-muted-foreground">Sats Remaining</p>
          </CardContent>
        </Card>
        <Card className="bg-secondary/10 border-secondary/30">
          <CardContent className="p-4 text-center">
            <Users className="w-6 h-6 mx-auto text-secondary mb-1" />
            <p className="font-display text-2xl font-bold text-secondary">
              {activeHunt.participants.length}
            </p>
            <p className="text-xs text-muted-foreground">Players</p>
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

      {/* Mini Map Overview */}
      <Card className="border-accent/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-accent" />
            Live Map Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={mapRef}
            className="relative h-48 bg-muted/30 rounded-lg border border-border overflow-hidden"
            style={{
              backgroundImage: `
                linear-gradient(hsl(var(--primary) / 0.05) 1px, transparent 1px),
                linear-gradient(90deg, hsl(var(--primary) / 0.05) 1px, transparent 1px)
              `,
              backgroundSize: '20px 20px',
            }}
          >
            {/* Geofence boundary */}
            <div className="absolute inset-2 border-2 border-dashed border-primary/40 rounded-lg" />

            {/* Monsters */}
            {activeHunt.monsters.map((monster) => {
              const pos = geoToPixel(monster.location);
              if (!pos) return null;
              return (
                <div
                  key={monster.id}
                  className={cn(
                    'absolute w-2 h-2 rounded-full transform -translate-x-1/2 -translate-y-1/2',
                    monster.captured ? 'bg-gray-500/50' : 'bg-primary animate-pulse'
                  )}
                  style={{ left: pos.x, top: pos.y }}
                  title={`${monster.name} (${monster.captured ? 'Captured' : formatSats(monster.satAmount) + ' sats'})`}
                />
              );
            })}

            {/* SatStops */}
            {activeHunt.satStops.map((stop) => {
              const pos = geoToPixel(stop.location);
              if (!pos) return null;
              return (
                <div
                  key={stop.id}
                  className="absolute w-3 h-3 rounded-full bg-secondary border border-white transform -translate-x-1/2 -translate-y-1/2"
                  style={{ left: pos.x, top: pos.y }}
                  title={stop.name}
                />
              );
            })}

            {/* Players */}
            {activeHunt.participants.map((participant) => {
              if (!participant.lastLocation) return null;
              const pos = geoToPixel(participant.lastLocation);
              if (!pos) return null;
              return (
                <div
                  key={participant.pubkey}
                  className="absolute transform -translate-x-1/2 -translate-y-1/2"
                  style={{ left: pos.x, top: pos.y }}
                  title={`Player (${participant.totalCaptured} captured)`}
                >
                  <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white animate-pulse" />
                </div>
              );
            })}

            {/* Legend */}
            <div className="absolute bottom-1 left-1 flex gap-2 text-[8px] text-muted-foreground bg-background/80 px-1 rounded">
              <span className="flex items-center gap-1">
                <Circle className="w-2 h-2 fill-primary text-primary" /> Monster
              </span>
              <span className="flex items-center gap-1">
                <Circle className="w-2 h-2 fill-secondary text-secondary" /> Stop
              </span>
              <span className="flex items-center gap-1">
                <Circle className="w-2 h-2 fill-blue-500 text-blue-500" /> Player
              </span>
            </div>
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
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" />
            Players ({activeHunt.participants.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeHunt.participants.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No players have joined yet. Share the code above!
            </p>
          ) : (
            <ScrollArea className="h-32">
              <div className="space-y-2">
                {activeHunt.participants.map((p, i) => (
                  <div
                    key={p.pubkey}
                    className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded"
                  >
                    <span className="flex items-center gap-2">
                      <Navigation className="w-3 h-3 text-blue-500" />
                      Player {i + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.totalCaptured} caught • {formatSats(p.totalSatsEarned)} sats
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
