import { useState, useEffect } from 'react';
import { useGame } from '@/contexts/GameContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { validateHuntConfig, formatSats } from '@/lib/gameUtils';
import { LocationPermissionPrompt } from './LocationPermissionPrompt';
import { PolygonDrawMap } from './PolygonDrawMap';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/useToast';
import type { GeoLocation, BoundaryType, SpawnMode } from '@/lib/gameTypes';
import {
  Zap,
  Target,
  Clock,
  MapPin,
  Skull,
  Sparkles,
  AlertCircle,
  Navigation,
  Loader2,
  Circle,
  Pentagon,
  Layers,
  Shuffle,
  RefreshCw,
  Users,
} from 'lucide-react';

interface CreateHuntFormProps {
  onHuntCreated: () => void;
}

export function CreateHuntForm({ onHuntCreated }: CreateHuntFormProps) {
  const { createHunt, startLocationTracking, state } = useGame();
  const { user } = useCurrentUser();
  const { toast } = useToast();
  const { playerLocation, locationError } = state;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [totalSats, setTotalSats] = useState(10000); // 10k sats default
  const [monsterCount, setMonsterCount] = useState(50);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [radiusMeters, setRadiusMeters] = useState(500);
  const [boundaryType, setBoundaryType] = useState<BoundaryType>('circle');
  const [polygonPoints, setPolygonPoints] = useState<GeoLocation[] | null>(null);
  const [spawnMode, setSpawnMode] = useState<SpawnMode>('all_at_once');
  const [maxConcurrentMonsters, setMaxConcurrentMonsters] = useState(20);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startLocationTracking();
  }, [startLocationTracking]);

  const handleDeploySats = async () => {
    if (!user) {
      setError('You must be logged in to create a hunt');
      return;
    }
    if (!playerLocation) {
      setError('Location is required to create a hunt. Please enable GPS.');
      return;
    }
    if (!name.trim()) {
      setError('Please enter a hunt name');
      return;
    }
    // Validate polygon if using custom boundary
    if (boundaryType === 'polygon' && (!polygonPoints || polygonPoints.length < 3)) {
      setError('Please draw a hunt boundary with at least 3 points');
      return;
    }
    const validation = validateHuntConfig(totalSats, monsterCount, durationMinutes);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid configuration');
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      // Create hunt with pending_payment status (async - fetches streets for monsters and POIs for SatStops)
      const { monstersInfo, satStopsInfo } = await createHunt({
        name: name.trim(),
        description: description.trim(),
        totalSats,
        monsterCount,
        durationMinutes,
        center: playerLocation,
        radiusMeters,
        boundaryType,
        polygon: boundaryType === 'polygon' ? polygonPoints ?? undefined : undefined,
        spawnMode,
        maxConcurrentMonsters: spawnMode === 'scattered_replacement' ? maxConcurrentMonsters : undefined,
      });

      // Check for issues with creature placement
      if (monstersInfo.usedFallback) {
        toast({
          title: 'Some creatures placed randomly',
          description: monstersInfo.error
            ? `Couldn't fetch street data: ${monstersInfo.error}. Some creatures may be off public paths.`
            : `Only found ${monstersInfo.streetPointCount} street locations for ${monsterCount} creatures.`,
          variant: 'destructive',
          duration: 8000,
        });
      }

      // Check for issues with SatStop placement
      if (satStopsInfo.usedFallback) {
        toast({
          title: 'SatStops placed randomly',
          description: satStopsInfo.error
            ? `Couldn't fetch nearby locations: ${satStopsInfo.error}. SatStops were placed at random positions.`
            : 'No named places found in this area. SatStops were placed at random positions.',
          variant: 'destructive',
          duration: 8000,
        });
      }

      // Show success message if both placed correctly
      if (!monstersInfo.usedFallback && !satStopsInfo.usedFallback) {
        toast({
          title: 'Hunt created successfully!',
          description: `${monsterCount} creatures on streets, ${satStopsInfo.poiCount} SatStops at POIs.`,
          duration: 4000,
        });
      }

      // Close the form - GamePage will show PaymentConfirmation
      onHuntCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create hunt');
      setIsCreating(false);
    }
  };

  const avgSatsPerMonster = Math.floor(totalSats / monsterCount);

  return (
    <Card className="bg-card/80 backdrop-blur border-primary/30 shadow-glow-orange">
      <CardHeader>
        <CardTitle className="font-display text-2xl flex items-center gap-2">
          <Target className="w-6 h-6 text-primary" />
          Create Hunt
        </CardTitle>
        <CardDescription>
          Set up a new scavenger hunt with Bitcoin rewards
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Location Permission/Status - unchanged */}
        {locationError && !playerLocation ? (
          <LocationPermissionPrompt error={locationError} onRequestPermission={startLocationTracking} />
        ) : playerLocation ? (
          <div className="p-3 rounded-lg border flex items-center gap-3 bg-secondary/10 border-secondary/30">
            <Navigation className="w-5 h-5 text-secondary" />
            <div className="flex-1">
              <p className="text-sm font-medium text-secondary">Location Acquired</p>
              <p className="text-xs text-muted-foreground">
                {playerLocation.lat.toFixed(6)}, {playerLocation.lng.toFixed(6)}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-lg border flex items-center gap-3 bg-muted/20 border-border">
            <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            <p className="text-sm text-muted-foreground">Getting location...</p>
          </div>
        )}
        {/* Form - unchanged except button onClick to handleDeploySats */}
        {!locationError && (
          <>
            <div className="space-y-2">
              <Label htmlFor="name" className="font-display">Hunt Name</Label>
              <Input
                id="name"
                placeholder="Bitcoin Treasure Hunt 🏴‍☠️"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border-primary/30 focus:border-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description" className="font-display">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe your hunt... What makes it special?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="border-primary/30 focus:border-primary resize-none"
                rows={3}
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="font-display flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  Total Sats
                </Label>
                <span className="font-mono text-primary text-glow-orange">
                  {formatSats(totalSats)} sats
                </span>
              </div>
              <Slider
                value={[totalSats]}
                onValueChange={([value]) => setTotalSats(value)}
                min={100}
                max={10000000}
                step={100}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>100</span>
                <span>10M</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="font-display flex items-center gap-2">
                  <Skull className="w-4 h-4 text-accent" />
                  Number of Creatures
                </Label>
                <span className="font-mono text-accent">{monsterCount}</span>
              </div>
              <Slider
                value={[monsterCount]}
                onValueChange={([value]) => setMonsterCount(value)}
                min={10}
                max={500}
                step={5}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>10</span>
                <span>500</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="font-display flex items-center gap-2">
                  <Clock className="w-4 h-4 text-secondary" />
                  Duration
                </Label>
                <span className="font-mono text-secondary">
                  {durationMinutes >= 60
                    ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
                    : `${durationMinutes}m`}
                </span>
              </div>
              <Slider
                value={[durationMinutes]}
                onValueChange={([value]) => setDurationMinutes(value)}
                min={15}
                max={480}
                step={15}
                className="py-2"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>15min</span>
                <span>8 hours</span>
              </div>
            </div>

            {/* Spawn Mode Selection */}
            <div className="space-y-3">
              <Label className="font-display flex items-center gap-2">
                <Shuffle className="w-4 h-4 text-purple-400" />
                Spawn Mode
              </Label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant={spawnMode === 'all_at_once' ? 'default' : 'outline'}
                  className={`flex flex-col h-auto py-2 px-2 ${spawnMode === 'all_at_once' ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                  onClick={() => setSpawnMode('all_at_once')}
                >
                  <Layers className="w-4 h-4 mb-1" />
                  <span className="text-xs">All at Once</span>
                </Button>
                <Button
                  type="button"
                  variant={spawnMode === 'scattered' ? 'default' : 'outline'}
                  className={`flex flex-col h-auto py-2 px-2 ${spawnMode === 'scattered' ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                  onClick={() => setSpawnMode('scattered')}
                >
                  <Shuffle className="w-4 h-4 mb-1" />
                  <span className="text-xs">Scattered</span>
                </Button>
                <Button
                  type="button"
                  variant={spawnMode === 'scattered_replacement' ? 'default' : 'outline'}
                  className={`flex flex-col h-auto py-2 px-2 ${spawnMode === 'scattered_replacement' ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                  onClick={() => setSpawnMode('scattered_replacement')}
                >
                  <RefreshCw className="w-4 h-4 mb-1" />
                  <span className="text-xs">Replacement</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {spawnMode === 'all_at_once' && 'All creatures spawn at the start of the hunt.'}
                {spawnMode === 'scattered' && 'Creatures spawn gradually throughout the hunt duration.'}
                {spawnMode === 'scattered_replacement' && 'Keep a fixed number active. When one is caught, another spawns.'}
              </p>
            </div>

            {/* Max Concurrent Monsters (only for replacement mode) */}
            {spawnMode === 'scattered_replacement' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="font-display text-sm text-muted-foreground flex items-center gap-2">
                    <Users className="w-4 h-4 text-purple-400" />
                    Active Creatures
                  </Label>
                  <span className="font-mono text-purple-400">{maxConcurrentMonsters}</span>
                </div>
                <Slider
                  value={[maxConcurrentMonsters]}
                  onValueChange={([value]) => setMaxConcurrentMonsters(value)}
                  min={5}
                  max={Math.min(100, monsterCount)}
                  step={5}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>5</span>
                  <span>{Math.min(100, monsterCount)}</span>
                </div>
              </div>
            )}

            {/* Boundary Type Toggle */}
            <div className="space-y-3">
              <Label className="font-display flex items-center gap-2">
                <MapPin className="w-4 h-4 text-blue-400" />
                Hunt Boundary
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={boundaryType === 'circle' ? 'default' : 'outline'}
                  className={boundaryType === 'circle' ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  onClick={() => setBoundaryType('circle')}
                >
                  <Circle className="w-4 h-4 mr-2" />
                  Circle Radius
                </Button>
                <Button
                  type="button"
                  variant={boundaryType === 'polygon' ? 'default' : 'outline'}
                  className={boundaryType === 'polygon' ? 'bg-blue-600 hover:bg-blue-700' : ''}
                  onClick={() => setBoundaryType('polygon')}
                >
                  <Pentagon className="w-4 h-4 mr-2" />
                  Custom Area
                </Button>
              </div>
            </div>

            {/* Circle Radius Slider (shown when circle mode) */}
            {boundaryType === 'circle' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="font-display text-sm text-muted-foreground">
                    Hunt Radius
                  </Label>
                  <span className="font-mono text-blue-400">{radiusMeters}m</span>
                </div>
                <Slider
                  value={[radiusMeters]}
                  onValueChange={([value]) => setRadiusMeters(value)}
                  min={100}
                  max={2000}
                  step={50}
                  className="py-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>100m</span>
                  <span>2km</span>
                </div>
              </div>
            )}

            {/* Polygon Draw Map (shown when polygon mode) */}
            {boundaryType === 'polygon' && playerLocation && (
              <div className="space-y-2">
                <PolygonDrawMap
                  center={playerLocation}
                  polygon={polygonPoints ?? undefined}
                  onPolygonComplete={(points) => setPolygonPoints(points)}
                  onPolygonClear={() => setPolygonPoints(null)}
                  className="h-72 rounded-lg border border-primary/30"
                />
                {polygonPoints && polygonPoints.length >= 3 && (
                  <p className="text-xs text-green-500 text-center">
                    Boundary set. Use the edit/trash icons (top-right) to modify.
                  </p>
                )}
              </div>
            )}
            <Card className="bg-muted/50 border-dashed">
              <CardContent className="p-4 grid grid-cols-2 gap-4 text-center">
                <div>
                  <Sparkles className="w-5 h-5 mx-auto text-primary mb-1" />
                  <p className="text-xs text-muted-foreground">Avg per Creature</p>
                  <p className="font-display font-bold text-primary">{formatSats(avgSatsPerMonster)} sats</p>
                </div>
                <div>
                  <Target className="w-5 h-5 mx-auto text-accent mb-1" />
                  <p className="text-xs text-muted-foreground">Density</p>
                  <p className="font-display font-bold text-accent">
                    {(monsterCount / (Math.PI * (radiusMeters / 1000) ** 2)).toFixed(1)}/km²
                  </p>
                </div>
              </CardContent>
            </Card>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button
              onClick={handleDeploySats}
              disabled={isCreating || !playerLocation || !user}
              className="w-full h-12 font-display text-lg bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Creating Hunt...
                </>
              ) : !user ? (
                'Login to Create Hunt'
              ) : !playerLocation ? (
                'Waiting for Location...'
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" />
                  Deploy {formatSats(totalSats)} Sats!
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}