import { useState, useEffect } from 'react';
import type { SatStop } from '@/lib/gameTypes';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Circle, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SatStopCardProps {
  stop: SatStop;
  onCollect: (stop: SatStop) => void;
  isInRange: boolean;
}

export function SatStopCard({ stop, onCollect, isInRange }: SatStopCardProps) {
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [isCollecting, setIsCollecting] = useState(false);

  useEffect(() => {
    const updateCooldown = () => {
      if (stop.lastCollected) {
        const remaining = Math.max(0, stop.cooldownMs - (Date.now() - stop.lastCollected));
        setCooldownRemaining(remaining);
      } else {
        setCooldownRemaining(0);
      }
    };

    updateCooldown();
    const interval = setInterval(updateCooldown, 1000);
    return () => clearInterval(interval);
  }, [stop.lastCollected, stop.cooldownMs]);

  const isOnCooldown = cooldownRemaining > 0;
  const canCollect = isInRange && !isOnCooldown;

  const formatCooldown = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleCollect = () => {
    setIsCollecting(true);
    setTimeout(() => {
      onCollect(stop);
      setIsCollecting(false);
    }, 500);
  };

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-all duration-300 border-2',
        'bg-secondary/20 border-secondary/50',
        canCollect && 'shadow-glow-green animate-pulse',
        isOnCooldown && 'opacity-60'
      )}
    >
      <CardContent className="p-4 flex flex-col items-center gap-3">
        {/* Stop Icon */}
        <div className="relative">
          <div
            className={cn(
              'w-16 h-16 rounded-full flex items-center justify-center',
              'bg-gradient-to-br from-secondary to-green-600 border-4 border-secondary/50',
              canCollect && 'animate-radar'
            )}
          >
            <MapPin className="w-8 h-8 text-black" />
          </div>
          {/* Radar effect */}
          {canCollect && (
            <div className="absolute inset-0 rounded-full border-2 border-secondary animate-radar" />
          )}
        </div>

        {/* Stop Info */}
        <div className="text-center space-y-1">
          <h3 className="font-display font-bold text-sm text-secondary">{stop.name}</h3>
          <Badge variant="outline" className="text-xs border-secondary/50 text-secondary">
            <Circle className="w-3 h-3 mr-1 fill-secondary" />
            {stop.ballsPerCollection} SatBalls
          </Badge>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground text-center">{stop.description}</p>

        {/* Cooldown or Collect Button */}
        {isOnCooldown ? (
          <div className="flex items-center gap-2 text-muted-foreground font-mono text-sm">
            <Timer className="w-4 h-4" />
            <span>Cooldown: {formatCooldown(cooldownRemaining)}</span>
          </div>
        ) : (
          <Button
            onClick={handleCollect}
            disabled={!canCollect || isCollecting}
            className={cn(
              'w-full mt-2 font-display',
              canCollect && 'bg-gradient-to-r from-secondary to-green-600 hover:from-green-600 hover:to-secondary shadow-glow-green'
            )}
            variant={canCollect ? 'default' : 'secondary'}
          >
            <Circle className="w-4 h-4 mr-2" />
            {!isInRange ? 'Get Closer' : isCollecting ? 'Collecting...' : 'Collect SatBalls!'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
