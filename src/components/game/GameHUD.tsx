import { useState, useEffect } from 'react';
import { useGame } from '@/contexts/GameContext';
import { formatSats, formatTimeRemaining, calculateDistance } from '@/lib/gameUtils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Circle,
  Clock,
  MapPin,
  Trophy,
  Target,
  Skull,
  Navigation,
  Menu,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

interface GameHUDProps {
  onOpenLeaderboard: () => void;
  onOpenInventory: () => void;
  onOpenStats: () => void;
}

export function GameHUD({ onOpenLeaderboard, onOpenInventory, onOpenStats }: GameHUDProps) {
  const { state, getAvailableMonsters } = useGame();
  const { activeHunt, playerStats, playerLocation, locationError } = state;
  const [timeRemaining, setTimeRemaining] = useState('');

  // Update time remaining every second
  useEffect(() => {
    if (!activeHunt) return;

    const updateTime = () => {
      setTimeRemaining(formatTimeRemaining(activeHunt.endTime));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [activeHunt]);

  if (!activeHunt) return null;

  const availableMonsters = getAvailableMonsters();

  // Only show monsters within 6 meters (~20 feet) visibility range
  const VISIBILITY_RANGE_METERS = 6;
  const visibleMonsters = playerLocation
    ? availableMonsters.filter(m => calculateDistance(playerLocation, m.location) <= VISIBILITY_RANGE_METERS)
    : [];

  const capturedCount = activeHunt.monsters.filter((m) => m.captured).length;
  const _progress = (capturedCount / activeHunt.monsterCount) * 100;

  const isHuntEnded = Date.now() > activeHunt.endTime;

  return (
    <>
      {/* Top HUD Bar - uses transform for iOS Safari hardware acceleration */}
      <div
        className="fixed top-0 left-0 right-0 p-3 bg-gradient-to-b from-background via-background/95 to-transparent"
        style={{ zIndex: 50, transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
      >
        <Card className="bg-card/90 backdrop-blur-md border-primary/30 shadow-glow-orange">
          <div className="p-3 space-y-3">
            {/* Hunt Name and Timer */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                <span className="font-display font-bold text-sm truncate max-w-[150px]">
                  {activeHunt.name}
                </span>
              </div>
              <Badge
                variant={isHuntEnded ? 'destructive' : 'outline'}
                className={cn(
                  'font-mono text-xs',
                  !isHuntEnded && 'border-primary/50 text-primary animate-pulse'
                )}
              >
                <Clock className="w-3 h-3 mr-1" />
                {timeRemaining}
              </Badge>
            </div>

            {/* Progress Bar - shows current hunt progress */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Skull className="w-3 h-3" />
                  This hunt: {playerStats.currentHuntCaptured} captured
                </span>
                <span className="text-primary font-medium">
                  +{formatSats(playerStats.currentHuntSatsEarned)} sats
                </span>
              </div>
              <Progress value={(playerStats.currentHuntCaptured / activeHunt.monsterCount) * 100} className="h-2 bg-muted" />
            </div>

            {/* Quick Stats Row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-xs">
                {/* Location Status */}
                <div
                  className={cn(
                    'flex items-center gap-1',
                    locationError ? 'text-destructive' : playerLocation ? 'text-secondary' : 'text-muted-foreground'
                  )}
                >
                  <Navigation className="w-3 h-3" />
                  {locationError ? 'No GPS' : playerLocation ? 'Tracking' : 'Loading...'}
                </div>

                {/* Nearby Monsters - only within 10 feet */}
                <div className="flex items-center gap-1 text-primary">
                  <MapPin className="w-3 h-3" />
                  {visibleMonsters.length} nearby
                </div>
              </div>

              {/* Menu Button */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <Menu className="w-4 h-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72 bg-card/95 backdrop-blur-md">
                  <SheetHeader>
                    <SheetTitle className="font-display text-primary">Menu</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6 space-y-3">
                    <Button
                      onClick={onOpenStats}
                      variant="outline"
                      className="w-full justify-start border-accent/30"
                    >
                      <BarChart3 className="w-4 h-4 mr-2 text-accent" />
                      My Stats
                    </Button>
                    <Button
                      onClick={onOpenLeaderboard}
                      variant="outline"
                      className="w-full justify-start border-primary/30"
                    >
                      <Trophy className="w-4 h-4 mr-2 text-yellow-400" />
                      Leaderboard
                    </Button>
                    <Button
                      onClick={onOpenInventory}
                      variant="outline"
                      className="w-full justify-start border-secondary/30"
                    >
                      <Circle className="w-4 h-4 mr-2 text-secondary" />
                      My Captures
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </Card>
      </div>

      {/* Bottom Player Stats Bar - uses transform for iOS Safari hardware acceleration */}
      <div
        className="fixed bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-background via-background/95 to-transparent"
        style={{ zIndex: 50, transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}
      >
        <Card className="bg-card/90 backdrop-blur-md border-secondary/30 shadow-glow-green">
          <div className="p-3 flex items-center justify-between">
            {/* SatBalls Count */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-secondary to-green-600 flex items-center justify-center border-2 border-secondary/50">
                  <Circle className="w-5 h-5 text-black fill-white" />
                </div>
                <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-primary text-[10px] font-bold">
                  {playerStats.balls}
                </Badge>
              </div>
              <div className="text-xs">
                <p className="font-display font-bold text-secondary">SatBalls</p>
                <p className="text-muted-foreground">Tap stops to collect</p>
              </div>
            </div>

            {/* Player Stats - Lifetime totals */}
            <div className="flex items-center gap-3">
              <div className="text-center border-r border-border pr-3">
                <p className="font-display font-bold text-lg text-primary text-glow-orange">
                  {formatSats(playerStats.lifetimeSatsEarned)}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Lifetime</p>
              </div>
              <div className="text-center">
                <p className="font-display font-bold text-lg text-accent">
                  {playerStats.lifetimeCaptured}
                </p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
