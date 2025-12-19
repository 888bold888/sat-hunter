import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { useGame } from '@/contexts/GameContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { LoginArea } from '@/components/auth/LoginArea';
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
  Users,
  ArrowLeft,
  Loader2,
  AlertCircle,
  QrCode,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatSats, formatTimeRemaining } from '@/lib/gameUtils';

export default function JoinHuntPage() {
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const { state, joinHunt, addParticipant, startLocationTracking } = useGame();
  const { user } = useCurrentUser();
  
  const [inputCode, setInputCode] = useState(code?.toUpperCase() || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleJoin = async () => {
    if (!user) {
      setError('Please log in with Nostr to join a hunt');
      return;
    }

    if (!inputCode || inputCode.length < 6) {
      setError('Please enter a valid 6-character hunt code');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // In a real app, we would query the server for the hunt with this code
      // For now, check if we have a stored hunt with this code
      const storedHunt = localStorage.getItem('sathunter:active-hunt');
      
      if (storedHunt) {
        const hunt = JSON.parse(storedHunt);
        if (hunt.shareCode === inputCode.toUpperCase()) {
          // Found the hunt!
          joinHunt(hunt);
          addParticipant(user.pubkey);
          navigate('/play');
          return;
        }
      }

      // Hunt not found
      setError('Hunt not found. Please check the code and try again.');
    } catch (err) {
      setError('Failed to join hunt. Please try again.');
    } finally {
      setIsLoading(false);
    }
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
            {/* Code Input */}
            <div className="space-y-2">
              <Label htmlFor="code" className="font-display">Hunt Code</Label>
              <Input
                id="code"
                placeholder="ABC123"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase().slice(0, 6))}
                className="text-center font-mono text-2xl tracking-widest h-14 border-primary/30"
                maxLength={6}
              />
            </div>

            {/* Error */}
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
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
              disabled={isLoading || !inputCode || inputCode.length < 6}
              className="w-full h-12 font-display text-lg bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  <Target className="w-5 h-5 mr-2" />
                  Join Hunt
                </>
              )}
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
