import { useState } from 'react';
import { useGame, getCaptureRefusalReason } from '@/contexts/GameContext';
import type { Monster, SatStop } from '@/lib/gameTypes';
import { isInCaptureRange, isAtSatStop } from '@/lib/gameUtils';
import { MonsterCard } from './MonsterCard';
import { SatStopCard } from './SatStopCard';
import { HuntMap } from './HuntMap';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Compass, RefreshCw, Footprints, X } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { usePublishCapture } from '@/hooks/usePublishCapture';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface GameMapProps {
  selectedMonster: Monster | null;
  selectedStop: SatStop | null;
  onSelectMonster: (monster: Monster | null) => void;
  onSelectStop: (stop: SatStop | null) => void;
  onMonsterCaptured?: (monster: Monster) => void;
}

export function GameMap({ selectedMonster, selectedStop, onSelectMonster, onSelectStop, onMonsterCaptured }: GameMapProps) {
  const { state, getAvailableStops, captureMonster, collectBalls, startLocationTracking, setManualLocation } = useGame();
  const { activeHunt, playerLocation, locationError, playerStats, lastIntegrityCheck, manualMovement } = state;
  const { toast } = useToast();
  const { user } = useCurrentUser();
  const publishCapture = usePublishCapture();
  const [showWalkHint, setShowWalkHint] = useState(true);

  // Couch-mode demo: tap the map to move the player (tap-to-walk)
  const isCouchDemo = !!activeHunt?.isDemo && manualMovement;

  // Visible monsters come from GameContext's sticky-visibility state (hysteresis
  // survives map remounts there); stops have no visibility mechanic.
  const visibleMonsters = state.nearbyMonsters;
  const availableStops = getAvailableStops();

  // Handle monster capture
  const handleCapture = (monster: Monster) => {
    // Refusals get an honest reason instead of a silent no-op — in the field the
    // worst confusion was tapping a creature another hunter already caught and
    // seeing either nothing or a fake success (goal: shared-creature-state).
    const refusal = getCaptureRefusalReason(state, monster);
    if (refusal) {
      if (refusal === 'already-captured') {
        toast({
          title: 'Already captured!',
          description: `Another hunter got ${monster.name} first.`,
          variant: 'destructive',
        });
        onSelectMonster(null); // close the stale selection panel
      } else if (refusal === 'no-balls') {
        toast({
          title: 'Out of SatCubes',
          description: 'Visit a SatStop to collect more.',
          variant: 'destructive',
        });
      } else if (refusal === 'out-of-range') {
        toast({
          title: 'Too far away',
          description: `Walk closer to catch ${monster.name}.`,
        });
      }
      // 'no-location' / 'integrity' already surface through their own UI
      // (location banner, anti-cheat warnings) — no duplicate toast.
      return;
    }

    const success = captureMonster(monster);
    if (success) {
      onSelectMonster(null);

      // Publish capture event to Nostr for host to see (includes anti-cheat data).
      // Demo hunts are hostless and local-only — never publish.
      if (activeHunt && !activeHunt.isDemo && user?.pubkey) {
        publishCapture.mutate({
          huntId: activeHunt.id,
          huntShareCode: activeHunt.shareCode,
          monster,
          playerPubkey: user.pubkey,
          hostPubkey: activeHunt.hostPubkey,
          // Anti-cheat data
          playerLocation: playerLocation ?? undefined,
          trustScore: lastIntegrityCheck?.trustScore.composite,
          trustFlags: lastIntegrityCheck?.trustScore.flags,
          // HMAC capture proof (proves we received hunt data via authenticated channel)
          captureSecret: activeHunt.captureSecret,
        });
      }

      if (onMonsterCaptured) {
        onMonsterCaptured(monster);
      } else {
        toast({
          title: `${monster.name} Captured! ⚡`,
          description: `You stacked ${monster.satAmount.toLocaleString()} sats!`,
        });
      }
    }
  };

  // Handle ball collection
  const handleCollect = (stop: SatStop) => {
    const success = collectBalls(stop);
    if (success) {
      toast({
        title: 'SatCubes Collected! 🟢',
        description: `+${stop.ballsPerCollection} SatCubes added to your inventory!`,
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
    <div className="w-full h-full relative" style={{ isolation: 'isolate' }}>
      {/* Leaflet Map - fills container */}
      {playerLocation && !locationError ? (
        <HuntMap
          center={activeHunt.geoFence.center}
          radiusMeters={activeHunt.geoFence.radiusMeters}
          playerLocation={playerLocation}
          monsters={visibleMonsters}
          satStops={availableStops}
          onMonsterClick={onSelectMonster}
          onStopClick={onSelectStop}
          onMapClick={isCouchDemo ? setManualLocation : undefined}
          showAllMonsters={false}
          className="w-full h-full"
          boundaryType={activeHunt.geoFence.boundaryType}
          polygon={activeHunt.geoFence.polygon}
        />
      ) : (
        <div className="w-full h-full bg-cyber-grid bg-matrix flex items-center justify-center">
          {/* Location Error Overlay */}
          {locationError && (
            <Card className="p-6 max-w-xs text-center space-y-4 bg-card/90">
              <Compass className="w-16 h-16 mx-auto text-destructive animate-pulse" />
              <div>
                <h3 className="font-display font-bold text-destructive">Location Required</h3>
                <p className="text-sm text-muted-foreground mt-2">{locationError}</p>
              </div>
              {locationError.includes('Settings') ? (
                <Button onClick={() => window.location.reload()} className="shadow-glow-orange">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh After Enabling
                </Button>
              ) : (
                <Button onClick={handleRequestLocation} className="shadow-glow-orange">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Enable Location
                </Button>
              )}
            </Card>
          )}
        </div>
      )}

      {/* Couch-mode tap-to-walk hint - dismissable, sits below the monster/stop panels */}
      {isCouchDemo && showWalkHint && playerLocation && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-max max-w-[90%]" style={{ zIndex: 20 }}>
          <div className="flex items-center gap-2 rounded-full bg-card/80 backdrop-blur border border-border/60 px-3 py-1.5 shadow-lg">
            <Footprints className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="text-xs font-medium">Tap the map to walk</span>
            <button
              onClick={() => setShowWalkHint(false)}
              className="ml-1 text-muted-foreground hover:text-foreground"
              aria-label="Dismiss hint"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Selected Monster Panel - above map */}
      {selectedMonster && (
        <>
          {/* Backdrop - tap to dismiss */}
          <div
            className="absolute inset-0 bg-black/20"
            style={{ zIndex: 25 }}
            onClick={() => onSelectMonster(null)}
          />
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
              onClose={() => onSelectMonster(null)}
            />
          </div>
        </>
      )}

      {/* Selected Stop Panel - above map */}
      {selectedStop && !selectedMonster && (
        <>
          {/* Backdrop - tap to dismiss */}
          <div
            className="absolute inset-0 bg-black/20"
            style={{ zIndex: 25 }}
            onClick={() => onSelectStop(null)}
          />
          <div
            className="absolute bottom-24 left-4 right-4"
            style={{ zIndex: 30, transform: 'translateZ(0)' }}
          >
            <SatStopCard
              stop={selectedStop}
              onCollect={handleCollect}
              isInRange={playerLocation ? isAtSatStop(playerLocation, selectedStop.location) : false}
              onClose={() => onSelectStop(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}
