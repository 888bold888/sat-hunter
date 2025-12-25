import { useGame } from '@/contexts/GameContext';
import type { Monster, SatStop } from '@/lib/gameTypes';
import { isInCaptureRange, isAtSatStop } from '@/lib/gameUtils';
import { MonsterCard } from './MonsterCard';
import { SatStopCard } from './SatStopCard';
import { HuntMap } from './HuntMap';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Compass, RefreshCw } from 'lucide-react';
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

  // Get available entities
  const availableMonsters = getAvailableMonsters();
  const availableStops = getAvailableStops();

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
    <div className="flex-1 relative" style={{ isolation: 'isolate' }}>
      {/* Leaflet Map - contained in stacking context */}
      {playerLocation && !locationError ? (
        <HuntMap
          center={activeHunt.geoFence.center}
          radiusMeters={activeHunt.geoFence.radiusMeters}
          playerLocation={playerLocation}
          monsters={availableMonsters}
          satStops={availableStops}
          onMonsterClick={onSelectMonster}
          onStopClick={onSelectStop}
          showAllMonsters={false}
          className="absolute inset-0"
        />
      ) : (
        <div className="absolute inset-0 bg-cyber-grid bg-matrix flex items-center justify-center">
          {/* Location Error Overlay */}
          {locationError && (
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
          )}
        </div>
      )}

      {/* Selected Monster Panel - above map */}
      {selectedMonster && (
        <div
          className="absolute bottom-24 left-4 right-4"
          style={{ zIndex: 30, transform: 'translateZ(0)' }}
        >
          <MonsterCard
            monster={selectedMonster}
            totalSats={activeHunt.totalSats}
            onCapture={handleCapture}
            isInRange={playerLocation ? isInCaptureRange(playerLocation, selectedMonster.location) : false}
            hasBalls={playerStats.balls > 0}
          />
        </div>
      )}

      {/* Selected Stop Panel - above map */}
      {selectedStop && !selectedMonster && (
        <div
          className="absolute bottom-24 left-4 right-4"
          style={{ zIndex: 30, transform: 'translateZ(0)' }}
        >
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
