import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { useGame } from '@/contexts/GameContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useHuntByCode } from '@/hooks/useHuntByCode';
import { usePublishJoin } from '@/hooks/useHuntSync';
import { useAuthor } from '@/hooks/useAuthor';
import { useNWC } from '@/hooks/useNWCContext';
import { useJoinP2P } from '@/hooks/useJoinP2P';
import { useJoinRequest } from '@/hooks/useJoinRequest';
import { useAntiCheat } from '@/hooks/useAntiCheat';
import { LoginArea } from '@/components/auth/LoginArea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  Info,
  CalendarClock,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatSats, formatTimeRemaining, formatCountdown } from '@/lib/gameUtils';
import { useToast } from '@/hooks/useToast';

export default function JoinHuntPage() {
  const { toast } = useToast();
  const { code } = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const { state, joinHunt, addParticipant, startLocationTracking } = useGame();
  const { user } = useCurrentUser();
  const { publishJoin } = usePublishJoin();
  const { connections } = useNWC();

  const [inputCode, setInputCode] = useState(code?.toUpperCase() || '');
  const [searchCode, setSearchCode] = useState(code?.toUpperCase() || '');
  const [isJoining, setIsJoining] = useState(false);

  // Query hunt from Nostr
  const { data: foundHunt, isLoading: isSearching, error: searchError, refetch, isFetching } = useHuntByCode(searchCode);

  // P2P connection for receiving location data (privacy mode)
  const { state: p2pState, error: p2pError, connect: connectP2P, reset: _resetP2P } = useJoinP2P();

  // Join request for hunts requiring approval
  const {
    status: joinRequestStatus,
    rejectionReason,
    error: joinRequestError,
    requestJoin,
    reset: resetJoinRequest,
  } = useJoinRequest();

  // Anti-cheat with motion tracking (Phase 2C)
  const { initializeMotionTracking } = useAntiCheat();

  // Fetch user's profile to check for Lightning address
  const { data: userProfile, isLoading: isLoadingProfile } = useAuthor(user?.pubkey);

  // Check if user has a Lightning address configured (required to RECEIVE payments)
  const hasLightningAddress = !!(userProfile?.metadata?.lud06 || userProfile?.metadata?.lud16);
  const lightningAddress = userProfile?.metadata?.lud16 || userProfile?.metadata?.lud06;

  // Check if user has NWC connected (used to SEND payments, not receive)
  const hasNWC = connections.length > 0;

  useSeoMeta({
    title: 'Join Hunt | Sat Hunter',
    description: 'Join a Bitcoin scavenger hunt and start capturing creatures!',
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

  // Handle requesting to join (for approval-required hunts)
  const handleRequestJoin = async () => {
    if (!user || !foundHunt) return;

    const success = await requestJoin(
      foundHunt.id,
      foundHunt.shareCode,
      foundHunt.hostPubkey
    );

    if (success) {
      toast({
        title: 'Request Sent',
        description: 'Waiting for host to approve your request...',
      });
    } else {
      toast({
        title: 'Request Failed',
        description: joinRequestError || 'Could not send join request',
        variant: 'destructive',
      });
    }
  };

  // Effect: When approved, proceed to join
  useEffect(() => {
    if (joinRequestStatus === 'approved' && foundHunt && !isJoining) {
      handleJoin();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinRequestStatus]);

  const handleJoin = async () => {
    if (!user) {
      toast({
        title: 'Login Required',
        description: 'Please log in with Nostr to join a hunt',
        variant: 'destructive',
      });
      return;
    }

    // Warn if no Lightning address but allow joining
    if (!hasLightningAddress) {
      toast({
        title: 'Warning: No Lightning Address',
        description: 'You can play but won\'t receive sats without a Lightning address (lud16) in your Nostr profile.',
        variant: 'destructive',
        duration: 6000,
      });
      // Still allow joining - they can play but won't get paid
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

    // Check if hunt has started (scheduled hunts)
    if (foundHunt.startTime > Date.now()) {
      toast({
        title: 'Hunt Not Started Yet',
        description: `This hunt starts ${formatCountdown(foundHunt.startTime)}. Come back then!`,
        variant: 'destructive',
      });
      return;
    }

    // Check if approval is required but not yet approved
    if (foundHunt.requiresApproval && joinRequestStatus !== 'approved') {
      // Should request approval first
      handleRequestJoin();
      return;
    }

    setIsJoining(true);

    try {
      // Phase 2C: Initialize motion tracking for anti-cheat
      // Must be called from user gesture (button click) for iOS permission
      await initializeMotionTracking();

      let huntToJoin = foundHunt;

      // If hunt requires P2P, connect to host for location data
      if (foundHunt.requiresP2P) {
        toast({
          title: 'Connecting to host...',
          description: 'Receiving hunt location data securely',
        });

        const locationData = await connectP2P(foundHunt.id, foundHunt.shareCode, foundHunt.hostPubkey);

        if (!locationData) {
          toast({
            title: 'Connection Failed',
            description: p2pError || 'Could not connect to host. Make sure they have the hunt open.',
            variant: 'destructive',
          });
          setIsJoining(false);
          return;
        }

        // Merge P2P location data with hunt metadata
        huntToJoin = {
          ...foundHunt,
          geoFence: locationData.geoFence,
          monsters: locationData.monsters,
          satStops: locationData.satStops,
        };

        toast({
          title: 'Connected!',
          description: `Received ${locationData.monsters.length} creature locations`,
        });
      }

      // Join the hunt
      joinHunt(huntToJoin);
      addParticipant(user.pubkey);

      // Publish join event to Nostr for host to see
      publishJoin(foundHunt.id, foundHunt.shareCode);

      navigate('/play');
    } catch (err) {
      toast({
        title: 'Failed to join',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-background bg-cyber-grid">
      <div className="container max-w-lg mx-auto p-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <Link to="/" className="flex-shrink-0">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="font-display text-xl sm:text-2xl font-bold flex items-center gap-2">
                <QrCode className="w-5 h-5 sm:w-6 sm:h-6 text-primary flex-shrink-0" />
                <span className="truncate">Join Hunt</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">Enter a hunt code to join</p>
            </div>
          </div>
          <LoginArea />
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

            {/* Loading/Searching State */}
            {isSearching && searchCode && (
              <Alert className="border-blue-500/30 bg-blue-500/5">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <AlertDescription className="text-sm">
                  Searching for hunt across Nostr relays... This may take a few seconds.
                </AlertDescription>
              </Alert>
            )}

            {/* Search Error */}
            {searchError && !isSearching && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription className="flex flex-col gap-2">
                  <span>
                    {searchError instanceof Error && searchError.message === 'Hunt not found'
                      ? 'Hunt not found. The hunt may still be syncing across relays, or the code may be incorrect.'
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
                  {foundHunt.startTime > Date.now() && foundHunt.paymentStatus === 'paid' && (
                    <Badge variant="outline" className="border-cyan-500/50 text-cyan-500">
                      <CalendarClock className="w-3 h-3 mr-1" />
                      Starts {formatCountdown(foundHunt.startTime)}
                    </Badge>
                  )}
                  {foundHunt.requiresP2P && (
                    <Badge variant="outline" className="border-green-500/50 text-green-500">
                      🔒 Privacy Mode - Direct connection to host
                    </Badge>
                  )}
                  {foundHunt.requiresApproval && (
                    <Badge variant="outline" className="border-amber-500/50 text-amber-500">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      Requires host approval
                    </Badge>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Approval Request Status */}
            {foundHunt?.requiresApproval && joinRequestStatus === 'pending' && (
              <Alert className="border-amber-500/30 bg-amber-500/5">
                <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                <AlertTitle className="text-amber-500 text-sm">Waiting for approval</AlertTitle>
                <AlertDescription className="text-sm">
                  Your request has been sent to the host. They'll approve you shortly...
                </AlertDescription>
              </Alert>
            )}

            {foundHunt?.requiresApproval && joinRequestStatus === 'approved' && (
              <Alert className="border-green-500/30 bg-green-500/5">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <AlertTitle className="text-green-500 text-sm">Approved!</AlertTitle>
                <AlertDescription className="text-sm">
                  Host approved your request. Connecting now...
                </AlertDescription>
              </Alert>
            )}

            {foundHunt?.requiresApproval && joinRequestStatus === 'rejected' && (
              <Alert className="border-red-500/30 bg-red-500/5">
                <XCircle className="w-4 h-4 text-red-500" />
                <AlertTitle className="text-red-500 text-sm">Request Denied</AlertTitle>
                <AlertDescription className="text-sm">
                  {rejectionReason || 'The host declined your request to join.'}
                  <Button
                    variant="link"
                    size="sm"
                    className="text-red-400 p-0 h-auto ml-2"
                    onClick={() => resetJoinRequest()}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* P2P Connection Status */}
            {isJoining && foundHunt?.requiresP2P && (
              <Alert className="border-blue-500/30 bg-blue-500/5">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                <AlertDescription className="text-sm">
                  {p2pState === 'creating-offer' && 'Creating secure connection...'}
                  {p2pState === 'waiting-answer' && 'Waiting for host...'}
                  {p2pState === 'connecting' && 'Establishing connection...'}
                  {p2pState === 'waiting-data' && 'Receiving hunt data...'}
                  {p2pState === 'error' && (p2pError || 'Connection failed')}
                </AlertDescription>
              </Alert>
            )}

            {/* Login Prompt */}
            {!user && (
              <Alert className="border-primary/30 bg-primary/5">
                <Zap className="w-4 h-4 text-primary" />
                <AlertDescription>
                  You need to log in with Nostr to join a hunt and stack sats!
                </AlertDescription>
              </Alert>
            )}

            {/* Lightning Address Check - Warning only, not blocking */}
            {user && !isLoadingProfile && !hasLightningAddress && (
              <Alert className="border-yellow-500/50 bg-yellow-500/5">
                <Info className="w-4 h-4 text-yellow-500" />
                <AlertTitle className="text-yellow-500 text-sm">Lightning Address Recommended</AlertTitle>
                <AlertDescription className="space-y-2 text-xs">
                  <p>
                    To receive sats when capturing creatures, add a Lightning address to your Nostr profile.
                  </p>
                  <p className="text-muted-foreground">
                    {hasNWC ? (
                      <>
                        <strong>Note:</strong> Your NWC wallet is for <em>sending</em> payments (as a host).
                        To <em>receive</em> rewards as a player, add a <code className="bg-muted px-1 rounded">lud16</code> field
                        (e.g., <code className="bg-muted px-1 rounded">yourname@getalby.com</code>) to your Nostr profile.
                      </>
                    ) : (
                      <>
                        Add a <code className="bg-muted px-1 rounded">lud16</code> field
                        (e.g., <code className="bg-muted px-1 rounded">yourname@getalby.com</code>) to your Nostr profile.
                      </>
                    )}
                  </p>
                  <p className="text-muted-foreground italic">
                    You can still join and play, but won't receive sats until you add a Lightning address.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {/* Lightning Address Verified */}
            {user && hasLightningAddress && (
              <Alert className="border-green-500/30 bg-green-500/5">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <AlertDescription className="text-xs">
                  <span className="text-green-500 font-medium">Lightning ready!</span> Rewards will be sent to: <code className="bg-muted px-1 rounded text-xs">{lightningAddress}</code>
                </AlertDescription>
              </Alert>
            )}

            {/* Join Button */}
            <Button
              onClick={foundHunt?.requiresApproval && joinRequestStatus === 'idle' ? handleRequestJoin : handleJoin}
              disabled={
                !foundHunt ||
                !user ||
                foundHunt.paymentStatus !== 'paid' ||
                foundHunt.startTime > Date.now() ||
                isLoadingProfile ||
                isJoining ||
                joinRequestStatus === 'pending' ||
                joinRequestStatus === 'rejected'
              }
              className="w-full h-12 font-display text-lg bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange disabled:opacity-50"
            >
              {isJoining ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : joinRequestStatus === 'pending' ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Waiting for approval...
                </>
              ) : (
                <>
                  {foundHunt && foundHunt.startTime > Date.now() ? (
                    <>
                      <CalendarClock className="w-5 h-5 mr-2" />
                      Starts {formatCountdown(foundHunt.startTime)}
                    </>
                  ) : foundHunt?.requiresApproval && joinRequestStatus === 'idle' ? (
                    <>
                      <ShieldCheck className="w-5 h-5 mr-2" />
                      Request to Join
                    </>
                  ) : (
                    <>
                      <Target className="w-5 h-5 mr-2" />
                      {!foundHunt
                        ? 'Search for Hunt First'
                        : !user
                          ? 'Login to Join'
                          : isLoadingProfile
                            ? 'Checking profile...'
                            : foundHunt.requiresP2P
                              ? 'Connect & Join'
                              : 'Join Hunt!'}
                    </>
                  )}
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
