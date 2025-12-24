import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { useGame } from '@/contexts/GameContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useHuntByCode } from '@/hooks/useHuntByCode';
import { LoginArea } from '@/components/auth/LoginArea';
import { QRScanner } from '@/components/game/QRScanner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Zap,
  Target,
  Clock,
  MapPin,
  Skull,
  ArrowLeft,
  Loader2,
  AlertCircle,
  QrCode,
  CheckCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatSats, formatTimeRemaining } from '@/lib/gameUtils';
import { useToast } from '@/hooks/useToast';

export default function JoinHuntPage() {
  const { toast } = useToast();
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const { state, joinHunt, addParticipant, startLocationTracking } = useGame();
  const { user } = useCurrentUser();

  const [inputCode, setInputCode] = useState(code?.toUpperCase() || '');
  const [searchCode, setSearchCode] = useState(code?.toUpperCase() || '');

  // Query hunt from Nostr
  const { data: foundHunt, isLoading: isSearching, error: searchError, refetch, isFetching } = useHuntByCode(searchCode);

  useSeoMeta({
    title: 'Join Hunt | Sat Hunter',
    description: 'Join a Bitcoin scavenger hunt and start catching creatures!',
  });

  // Start location tracking on mount
  useEffect(() => {
    startLocationTracking();
  }, [startLocationTracking]);

  // Auto-join if code is in URL and we have a hunt matching it
  useEffect(() => {
    if (code && state.activeHunt?.shareCode === code.toUpperCase()) {
      // Already in this hunt
      navigate('/play');
    }
  }, [code, state.activeHunt, navigate]);

  const handleSearch = () => {
    if (!inputCode || inputCode.length < 6) return;
    setSearchCode(inputCode.toUpperCase());
  };

  const handleJoin = () => {
    if (!user) {
      toast({
        title: 'Login Required',
        description: 'Please log in with Nostr to join a hunt',
        variant: 'destructive',
      });
      return;
    }

    if (!foundHunt) {
      toast({
        title: 'No Hunt Found',
        description: 'Please search for a hunt first',
        variant: 'destructive',
      });
      return;
    }

    // Check if hunt is still active
    if (foundHunt.endTime < Date.now()) {
      toast({
        title: 'Hunt Ended',
        description: 'This hunt has already ended',
        variant: 'destructive',
      });
      return;
    }

    // Check payment status
    if (foundHunt.paymentStatus !== 'paid') {
      toast({
        title: 'Hunt Not Ready',
        description: 'This hunt is waiting for payment confirmation',
        variant: 'destructive',
      });
      return;
    }

    // Join the hunt
    joinHunt(foundHunt);
    addParticipant(user.pubkey);
    navigate('/play');
  };

  return (
    <div className="min-h-screen bg-background bg-cyber-grid">
      <div className="container max-w-lg mx-auto p-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="font-display text-2xl font-bold flex items-center gap-2">
                <QrCode className="w-6 h-6 text-primary" />
                Join Hunt
              </h1>
              <p className="text-sm text-muted-foreground">Enter a hunt code to join</p>
            </div>
          </div>
          <LoginArea className="max-w-32" />
        </div>

        {/* Join Form */}
        <Card className="bg-card/80 backdrop-blur border-primary/30 shadow-glow-orange">
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Target className="w-5 h-5 text-primary" />
              Enter Hunt Code
            </CardTitle>
            <CardDescription>
              Get the 6-character code from the hunt host
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* QR Scanner */}
            <QRScanner
              onCodeScanned={(code) => {
                setInputCode(code);
                setSearchCode(code);
              }}
            />

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or enter code manually</span>
              </div>
            </div>

            {/* Code Input */}
            <div className="space-y-2">
              <Label htmlFor="code" className="font-display">Hunt Code</Label>
              <div className="flex gap-2">
                <Input
                  id="code"
                  placeholder="ABC123"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase().slice(0, 6))}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                  className="text-center font-mono text-2xl tracking-widest h-14 border-primary/30"
                  maxLength={6}
                />
                <Button
                  onClick={handleSearch}
                  disabled={!inputCode || inputCode.length < 6 || isSearching}
                  variant="outline"
                  className="h-14"
                >
                  {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                </Button>
              </div>
            </div>

            {/* Search Error */}
            {searchError && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription className="flex flex-col gap-2">
                  <span>
                    {searchError instanceof Error && searchError.message === 'Hunt not found'
                      ? 'Hunt not found. The hunt may still be syncing across relays.'
                      : searchError instanceof Error
                        ? searchError.message
                        : 'Hunt not found. Please check the code.'}
                  </span>
                  {searchError instanceof Error && searchError.message === 'Hunt not found' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refetch()}
                      disabled={isFetching}
                      className="w-fit"
                    >
                      {isFetching ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Try Again
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/* Hunt Found - Show Preview */}
            {foundHunt && (
              <Card className="border-secondary/30 bg-secondary/5">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="w-4 h-4 text-secondary" />
                        <h3 className="font-display font-bold">{foundHunt.name}</h3>
                      </div>
                      <p className="text-xs text-muted-foreground">{foundHunt.description}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <Zap className="w-3 h-3 text-primary" />
                      <span>{formatSats(foundHunt.totalSats)} sats</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Skull className="w-3 h-3 text-accent" />
                      <span>{foundHunt.monsterCount} creatures</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-secondary" />
                      <span>{formatTimeRemaining(foundHunt.endTime)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-blue-400" />
                      <span>{foundHunt.geoFence.radiusMeters}m radius</span>
                    </div>
                  </div>
                  {foundHunt.paymentStatus !== 'paid' && (
                    <Badge variant="outline" className="border-yellow-500/50 text-yellow-500">
                      Waiting for payment
                    </Badge>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Login Prompt */}
            {!user && (
              <Alert className="border-primary/30 bg-primary/5">
                <Zap className="w-4 h-4 text-primary" />
                <AlertDescription>
                  You need to log in with Nostr to join a hunt and earn sats!
                </AlertDescription>
              </Alert>
            )}

            {/* Join Button */}
            <Button
              onClick={handleJoin}
              disabled={!foundHunt || !user || foundHunt.paymentStatus !== 'paid'}
              className="w-full h-12 font-display text-lg bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange"
            >
              <Target className="w-5 h-5 mr-2" />
              {!foundHunt ? 'Search for Hunt First' : !user ? 'Login to Join' : 'Join Hunt!'}
            </Button>
          </CardContent>
        </Card>

        {/* Info Cards */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-4 text-center">
              <MapPin className="w-8 h-8 mx-auto text-secondary mb-2" />
              <p className="text-xs text-muted-foreground">
                Make sure you're near the hunt location before joining
              </p>
            </CardContent>
          </Card>
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-4 text-center">
              <Zap className="w-8 h-8 mx-auto text-primary mb-2" />
              <p className="text-xs text-muted-foreground">
                Captured creatures reward you with real sats!
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Or Create */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">Don't have a code?</p>
          <Link to="/play">
            <Button variant="outline">Create Your Own Hunt</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
