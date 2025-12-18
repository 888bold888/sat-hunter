import { useEffect, useRef, useState } from 'react';
import { useGame } from '@/contexts/GameContext';
import type { Monster, SatStop, GeoLocation } from '@/lib/gameTypes';
import { calculateDistance, isInCaptureRange, isAtSatStop, getRarityColor } from '@/lib/gameUtils';
import { MonsterCard } from './MonsterCard';
import { SatStopCard } from './SatStopCard';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Navigation, Compass, RefreshCw, MapPin, Zap } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

interface GameMapProps {
  selectedMonster: Monster | null;
  selectedStop: SatStop | null;
  onSelectMonster: (monster: Monster | null) => void;
  onSelectStop: (stop: SatStop | null) => void;
  onMonsterCaptured?: (monster: Monster) => void;
}

export function GameMap({ selectedMonster, selectedStop, onSelectMonster, onSelectStop, onMonsterCaptured }: GameMapProps) {
  const { state, getAvailableMonsters, getAvailableStops, captureMonster, collectBalls, startLocationTracking } = useGame();
  const { activeHunt, playerLocation, locationError, playerStats } = state;
  const { toast } = useToast();
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapDimensions, setMapDimensions] = useState({ width: 0, height: 0 });

  // Get available entities
  const availableMonsters = getAvailableMonsters();
  const availableStops = getAvailableStops();

  // Update map dimensions on resize
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

  // Convert geo coordinates to map pixel position
  const geoToPixel = (location: GeoLocation): { x: number; y: number } | null => {
    if (!activeHunt || !mapDimensions.width) return null;

    const { bounds } = activeHunt.geoFence;
    const latRange = bounds.north - bounds.south;
    const lngRange = bounds.east - bounds.west;

    // Map lat/lng to pixel coordinates
    const x = ((location.lng - bounds.west) / lngRange) * mapDimensions.width;
    const y = ((bounds.north - location.lat) / latRange) * mapDimensions.height;

    return { x, y };
  };

  // Handle monster capture
  const handleCapture = (monster: Monster) => {
    const success = captureMonster(monster);
    if (success) {
      onSelectMonster(null);
      if (onMonsterCaptured) {
        onMonsterCaptured(monster);
      } else {
        toast({
          title: `${monster.name} Captured! ⚡`,
          description: `You earned ${monster.satAmount.toLocaleString()} sats!`,
        });
      }
    }
  };

  // Handle ball collection
  const handleCollect = (stop: SatStop) => {
    const success = collectBalls(stop);
    if (success) {
      toast({
        title: 'SatBalls Collected! 🟢',
        description: `+${stop.ballsPerCollection} SatBalls added to your inventory!`,
      });
      onSelectStop(null);
    }
  };

  // Request location if we have an error
  const handleRequestLocation = () => {
    startLocationTracking();
  };

  if (!activeHunt) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Card className="p-8 text-center bg-card/80 backdrop-blur">
          <MapPin className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No active hunt</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 relative">
      {/* Map Container */}
      <div
        ref={mapRef}
        className="absolute inset-0 bg-cyber-grid bg-matrix overflow-hidden"
        style={{
          backgroundImage: `
            radial-gradient(circle at center, hsl(var(--muted) / 0.1) 1px, transparent 1px),
            linear-gradient(hsl(var(--primary) / 0.03) 1px, transparent 1px),
            linear-gradient(90deg, hsl(var(--primary) / 0.03) 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px, 50px 50px, 50px 50px',
        }}
      >
        {/* Geofence boundary visualization */}
        <div className="absolute inset-4 border-2 border-dashed border-primary/30 rounded-lg pointer-events-none" />

        {/* Sat Stops */}
        {activeHunt.satStops.map((stop) => {
          const pos = geoToPixel(stop.location);
          if (!pos) return null;
          const isInRange = playerLocation ? isAtSatStop(playerLocation, stop.location) : false;
          const isAvailable = availableStops.some((s) => s.id === stop.id);

          return (
            <button
              key={stop.id}
              onClick={() => onSelectStop(stop)}
              className={cn(
                'absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300',
                'w-10 h-10 rounded-full flex items-center justify-center',
                'bg-gradient-to-br from-secondary/80 to-green-700/80 border-2',
                isAvailable ? 'border-secondary shadow-glow-green' : 'border-secondary/30 opacity-50',
                isInRange && isAvailable && 'animate-bounce scale-125'
              )}
              style={{
                left: pos.x,
                top: pos.y,
              }}
            >
              <MapPin className="w-5 h-5 text-white" />
            </button>
          );
        })}

        {/* Monsters */}
        {availableMonsters.map((monster) => {
          const pos = geoToPixel(monster.location);
          if (!pos) return null;
          const isInRange = playerLocation ? isInCaptureRange(playerLocation, monster.location) : false;
          const distance = playerLocation ? calculateDistance(playerLocation, monster.location) : Infinity;

          return (
            <button
              key={monster.id}
              onClick={() => onSelectMonster(monster)}
              className={cn(
                'absolute transform -translate-x-1/2 -translate-y-1/2 transition-all duration-300',
                'animate-spawn',
                isInRange && 'animate-bounce'
              )}
              style={{
                left: pos.x,
                top: pos.y,
              }}
            >
              <div
                className={cn(
                  'relative w-12 h-12 rounded-full flex items-center justify-center',
                  'bg-gradient-to-br from-card to-muted border-2 shadow-lg',
                  getRarityColor(monster.rarity).replace('text-', 'border-'),
                  monster.rarity === 'mythic' && 'animate-glow-pulse',
                  monster.rarity === 'legendary' && 'shadow-glow-purple'
                )}
              >
                <span className="text-2xl drop-shadow-lg">{monster.emoji}</span>
                {/* Sats indicator */}
                <div className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground text-[8px] font-bold px-1 rounded-full flex items-center">
                  <Zap className="w-2 h-2" />
                  {monster.satAmount > 1000 ? `${(monster.satAmount / 1000).toFixed(0)}k` : monster.satAmount}
                </div>
                {/* Distance indicator */}
                {distance < 200 && (
                  <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 text-[8px] text-muted-foreground whitespace-nowrap bg-card/80 px-1 rounded">
                    {Math.round(distance)}m
                  </div>
                )}
              </div>
            </button>
          );
        })}

        {/* Player Position */}
        {playerLocation && (
          <div
            className="absolute transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10"
            style={{
              left: geoToPixel(playerLocation)?.x ?? '50%',
              top: geoToPixel(playerLocation)?.y ?? '50%',
            }}
          >
            {/* Capture range indicator */}
            <div className="absolute w-32 h-32 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2 rounded-full border border-primary/30 bg-primary/5 animate-radar" />

            {/* Player marker */}
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-orange-600 border-4 border-white shadow-glow-orange flex items-center justify-center">
                <Navigation className="w-4 h-4 text-white" />
              </div>
              {/* Pulsing ring */}
              <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping" />
            </div>
          </div>
        )}

        {/* Location Error Overlay */}
        {locationError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <Card className="p-6 max-w-xs text-center space-y-4 bg-card/90">
              <Compass className="w-16 h-16 mx-auto text-destructive animate-pulse" />
              <div>
                <h3 className="font-display font-bold text-destructive">Location Required</h3>
                <p className="text-sm text-muted-foreground mt-2">{locationError}</p>
              </div>
              <Button onClick={handleRequestLocation} className="shadow-glow-orange">
                <RefreshCw className="w-4 h-4 mr-2" />
                Enable Location
              </Button>
            </Card>
          </div>
        )}
      </div>

      {/* Selected Monster Panel */}
      {selectedMonster && (
        <div className="absolute bottom-24 left-4 right-4 z-20">
          <MonsterCard
            monster={selectedMonster}
            totalSats={activeHunt.totalSats}
            onCapture={handleCapture}
            isInRange={playerLocation ? isInCaptureRange(playerLocation, selectedMonster.location) : false}
            hasBalls={playerStats.balls > 0}
          />
        </div>
      )}

      {/* Selected Stop Panel */}
      {selectedStop && !selectedMonster && (
        <div className="absolute bottom-24 left-4 right-4 z-20">
          <SatStopCard
            stop={selectedStop}
            onCollect={handleCollect}
            isInRange={playerLocation ? isAtSatStop(playerLocation, selectedStop.location) : false}
          />
        </div>
      )}
    </div>
  );
}
