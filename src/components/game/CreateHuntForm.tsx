import { useState, useEffect } from 'react';
import { useGame } from '@/contexts/GameContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { validateHuntConfig, formatSats } from '@/lib/gameUtils';
import type { GeoLocation } from '@/lib/gameTypes';
import { LocationPermissionPrompt } from './LocationPermissionPrompt';
import { PaymentConfirmation } from './PaymentConfirmation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreateHuntFormProps {
  onHuntCreated: () => void;
}

export function CreateHuntForm({ onHuntCreated }: CreateHuntFormProps) {
  const { createHunt, startLocationTracking, state, confirmPayment } = useGame();
  const { user } = useCurrentUser();
  const { playerLocation, locationError, activeHunt } = state;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [totalSats, setTotalSats] = useState(10000); // 10k sats default
  const [monsterCount, setMonsterCount] = useState(50);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [radiusMeters, setRadiusMeters] = useState(500);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'payment'>('form');

  // Start location tracking on mount
  useEffect(() => {
    startLocationTracking();
  }, [startLocationTracking]);

  const handleCreate = async () => {
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

    const validation = validateHuntConfig(totalSats, monsterCount, durationMinutes);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid configuration');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      createHunt({
        name: name.trim(),
        description: description.trim(),
        totalSats,
        monsterCount,
        durationMinutes,
        center: playerLocation,
        radiusMeters,
      });

      // Move to payment step
      setStep('payment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create hunt');
    } finally {
      setIsCreating(false);
    }
  };

  // When payment is confirmed AND hunt is published, close the form
  useEffect(() => {
    if (activeHunt?.paymentStatus === 'paid' && (activeHunt.status === 'ready' || activeHunt.status === 'active')) {
      // Small delay to show success state
      const timer = setTimeout(() => {
        onHuntCreated();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [activeHunt?.paymentStatus, activeHunt?.status, onHuntCreated]);

  const avgSatsPerMonster = Math.floor(totalSats / monsterCount);

  // Show payment step if hunt is created but not paid
  if (step === 'payment') {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={() => setStep('form')}
          className="mb-2"
        >
          ← Back to Configuration
        </Button>
        <PaymentConfirmation />
      </div>
    );
  }

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
        {/* Location Permission/Status */}
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

        {/* Only show form if location is available or being loaded */}
        {!locationError && (
          <>

        {/* Hunt Name */}
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

        {/* Description */}
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

        {/* Total Sats */}
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

        {/* Monster Count */}
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

        {/* Duration */}
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

        {/* Radius */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="font-display flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-400" />
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

        {/* Stats Summary */}
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

        {/* Error Message */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Create Button */}
        <Button
          onClick={handleCreate}
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
