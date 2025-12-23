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
import { NWC } from '@getalby/sdk/dist/nwc'; // Added for NWC payments
import QRCode from 'qrcode'; // Added for manual QR
import { NPool } from '@nostrify/nostrify'; // Added for publishing to Nostr

interface CreateHuntFormProps {
  onHuntCreated: () => void;
}

export function CreateHuntForm({ onHuntCreated }: CreateHuntFormProps) {
  const { createHunt, startLocationTracking, state } = useGame();
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
  const [showPaymentModal, setShowPaymentModal] = useState(false); // Added for modal control
  const [paymentMethod, setPaymentMethod] = useState<'nwc' | 'manual' | 'dev' | null>(null); // Added to track method
  const [qrUrl, setQrUrl] = useState<string | null>(null); // Added for manual QR
  const [invoice, setInvoice] = useState<string | null>(null); // Added for manual invoice

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
    const validation = validateHuntConfig(totalSats, monsterCount, durationMinutes);
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid configuration');
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      // Create hunt locally first
      const hunt = createHunt({
        name: name.trim(),
        description: description.trim(),
        totalSats,
        monsterCount,
        durationMinutes,
        center: playerLocation,
        radiusMeters,
      });
      // Split sats into creature invoices based on rarity (assume monsters array exists with rarity)
      const creatureInvoices = hunt.monsters.map(monster => {
        let sats = 10; // Default common
        if (monster.rarity === 'rare') sats = 100; // Example based on rarity - adjust as needed
        // Generate invoice for each (use your generateInvoice function or Alby)
        return { monsterId: monster.id, sats, invoice: 'lnbc...' }; // Placeholder - implement actual invoice gen
      });
      // Store in hunt or state
      // Then show payment
      setShowPaymentModal(true);
      setStep('payment');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create hunt');
    } finally {
      setIsCreating(false);
    }
  };

  // Payment handlers
  const nwc = new NWC({ nostrWalletConnectUrl: user?.nwcUrl || '' }); // Assume user has NWC URL

  async function handleNWC() {
    setPaymentMethod('nwc');
    try {
      const inv = await generateInvoice(totalSats); // Your function
      const result = await nwc.payInvoice({ invoice: inv });
      if (result.preimage) {
        await publishHuntToNostr(); // Publish after success
        setPaymentConfirmed(true);
        setShowPaymentModal(false);
      }
    } catch (err) {
      setError('NWC payment failed');
    }
  }

  async function handleManual() {
    setPaymentMethod('manual');
    try {
      const inv = await generateInvoice(totalSats); // Your function
      setInvoice(inv);
      QRCode.toDataURL(inv, (err, url) => {
        if (!err) setQrUrl(url);
      });
      // Poll for payment (use react-query or setInterval to check if paid)
      const interval = setInterval(async () => {
        if (await checkPayment(inv)) { // Your check function
          clearInterval(interval);
          await publishHuntToNostr();
          setPaymentConfirmed(true);
          setShowPaymentModal(false);
        }
      }, 5000);
    } catch (err) {
      setError('Manual payment failed');
    }
  }

  function handleDevSkip() {
    setPaymentMethod('dev');
    publishHuntToNostr();
    setPaymentConfirmed(true);
    setShowPaymentModal(false);
  }

  async function publishHuntToNostr() {
    const pool = new NPool(['wss://relay.nostr.net']);
    const event = {
      kind: 32959,
      content: JSON.stringify({ 
        name, 
        description, 
        totalSats, 
        monsters: activeHunt.monsters, // From state
        time: durationMinutes,
        invoices: creatureInvoices // From earlier
      }),
      tags: [['d', activeHunt.shareCode]], // Assume shareCode generated in createHunt
    };
    const signedEvent = await window.nostr.signEvent(event); // NIP-07
    await pool.publish(signedEvent);
    // Update status to 'active'
  }

  // When payment is confirmed AND hunt is published, close the form
  useEffect(() => {
    if (activeHunt?.paymentStatus === 'paid' && (activeHunt.status === 'ready' || activeHunt.status === 'active')) {
      const timer = setTimeout(() => {
        onHuntCreated();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [activeHunt?.paymentStatus, activeHunt?.status, onHuntCreated]);

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
              onClick={handleDeploySats} // Changed to new handler
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
        {/* Added Payment Modal */}
        {showPaymentModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg max-w-md w-full space-y-4">
              <h2 className="text-xl font-bold">Payment Confirmation</h2>
              <p>Total: {formatSats(totalSats)} Sats</p>
              <Button onClick={handleNWC} className="w-full">Pay with NWC (One-click)</Button>
              <Button onClick={handleManual} className="w-full">Manual Invoice (QR + Copy)</Button>
              {process.env.NODE_ENV === 'development' && (
                <Button onClick={handleDevSkip} className="w-full">Skip (Dev Mode)</Button>
              )}
              {paymentMethod === 'manual' && qrUrl && (
                <>
                  <img src={qrUrl} alt="QR Code" className="mx-auto" />
                  <Input value={invoice || ''} readOnly />
                  <Button onClick={() => navigator.clipboard.writeText(invoice || '')}>Copy Invoice</Button>
                </>
              )}
              <Button variant="ghost" onClick={() => setShowPaymentModal(false)}>Back to Config</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}