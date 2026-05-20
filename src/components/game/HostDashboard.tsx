import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useGame } from '@/contexts/GameContext';
import { formatSats, formatTimeRemaining, formatCountdown, calculateDistance } from '@/lib/gameUtils';
import { decodeGeohash, verifyCaptureProof } from '@/lib/antiCheat';
import { HuntMap } from './HuntMap';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Zap,
  Users,
  Clock,
  Target,
  Skull,
  Eye,
  QrCode,
  Copy,
  Check,
  RefreshCw,
  ShieldAlert,
  Wifi,
  CalendarClock,
  UserCheck,
  UserX,
  ShieldCheck,
  AlertTriangle,
  Activity,
  ChevronDown,
  ChevronUp,
  UserMinus,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useHuntSync } from '@/hooks/useHuntSync';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePayPlayer } from '@/hooks/usePayPlayer';
import { useToast } from '@/hooks/useToast';
import { ANTI_CHEAT_CONFIG } from '@/lib/antiCheat';
import { useHostConnection } from '@/hooks/useHostConnection';
import { useHostApprovals, usePlayerMetadata } from '@/hooks/useHostApprovals';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { usePublishKick } from '@/hooks/usePublishKick';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { genUserName } from '@/lib/genUserName';

// Anti-cheat data from capture events
interface CaptureAntiCheat {
  trustScore?: number;
  trustFlags?: string[];
  geohash?: string;
  captureProof?: string;
}

import { setSerializer, mapSerializer } from '@/lib/serializers';

// Component to display a player's join request with their profile
function PlayerRequestCard({
  pubkey,
  message,
  requestedAt,
  onApprove,
  onReject,
  isProcessing,
}: {
  pubkey: string;
  message?: string;
  requestedAt: number;
  onApprove: () => void;
  onReject: () => void;
  isProcessing: boolean;
}) {
  const metadata = usePlayerMetadata(pubkey);
  const displayName = metadata?.name || genUserName(pubkey);
  const timeAgo = Math.floor((Date.now() - requestedAt) / 60000);

  return (
    <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
      <Avatar className="w-10 h-10">
        <AvatarImage src={metadata?.picture} alt={displayName} />
        <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{displayName}</p>
        {message && <p className="text-xs text-muted-foreground truncate">{message}</p>}
        <p className="text-xs text-muted-foreground">{timeAgo < 1 ? 'Just now' : `${timeAgo}m ago`}</p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="border-green-500/50 text-green-500 hover:bg-green-500/10"
          onClick={onApprove}
          disabled={isProcessing}
        >
          <UserCheck className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-red-500/50 text-red-500 hover:bg-red-500/10"
          onClick={onReject}
          disabled={isProcessing}
        >
          <UserX className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// Activity status based on last capture time
type ActivityStatus = 'active' | 'idle' | 'inactive';

function getActivityStatus(lastCaptureTime: number | null): ActivityStatus {
  if (!lastCaptureTime) return 'inactive';
  const minutesAgo = (Date.now() - lastCaptureTime) / 60000;
  if (minutesAgo < 2) return 'active';
  if (minutesAgo < 10) return 'idle';
  return 'inactive';
}

function getActivityLabel(lastCaptureTime: number | null): string {
  if (!lastCaptureTime) return 'No activity';
  const minutesAgo = Math.floor((Date.now() - lastCaptureTime) / 60000);
  if (minutesAgo < 1) return 'Active now';
  if (minutesAgo < 60) return `${minutesAgo}m ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  return `${hoursAgo}h ago`;
}

// Aggregated player stats for monitoring
interface PlayerMonitorStats {
  pubkey: string;
  captureCount: number;
  totalSats: number;
  avgTrustScore: number | null;
  allFlags: string[];
  hasWarnings: boolean;
  rejectedCount: number;
  lastCaptureTime: number | null;
  isKicked: boolean;
  isLeft: boolean;
}

// Component to display a player with monitoring info
function PlayerMonitorCard({
  stats,
  onKick,
  isKicking,
}: {
  stats: PlayerMonitorStats;
  onKick: (pubkey: string) => void;
  isKicking: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingKick, setConfirmingKick] = useState(false);
  const metadata = usePlayerMetadata(stats.pubkey);
  const displayName = metadata?.name || genUserName(stats.pubkey);

  // Activity status
  const activityStatus = getActivityStatus(stats.lastCaptureTime);
  const activityLabel = getActivityLabel(stats.lastCaptureTime);

  // Activity indicator color
  const getActivityColor = () => {
    if (stats.isKicked) return 'bg-red-500';
    if (stats.isLeft) return 'bg-gray-400';
    switch (activityStatus) {
      case 'active': return 'bg-green-500';
      case 'idle': return 'bg-yellow-500';
      case 'inactive': return 'bg-gray-500';
    }
  };

  // Check if player is inactive (kicked or left)
  const isInactive = stats.isKicked || stats.isLeft;

  // Determine status color based on trust score and flags
  const getTrustColor = () => {
    if (isInactive) return 'text-gray-500';
    if (stats.rejectedCount > 0) return 'text-red-500';
    if (stats.hasWarnings) return 'text-yellow-500';
    if (stats.avgTrustScore !== null && stats.avgTrustScore < 80) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getStatusBg = () => {
    if (isInactive) return 'bg-gray-500/10 border-gray-500/30 opacity-60';
    if (stats.rejectedCount > 0) return 'bg-red-500/10 border-red-500/30';
    if (stats.hasWarnings) return 'bg-yellow-500/10 border-yellow-500/30';
    return 'bg-muted/30 border-border';
  };

  return (
    <div className={`rounded-lg border ${getStatusBg()}`}>
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Activity indicator dot */}
        <div className="relative">
          <Avatar className="w-8 h-8">
            <AvatarImage src={metadata?.picture} alt={displayName} />
            <AvatarFallback className="text-xs">{displayName.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${getActivityColor()}`}
            title={activityLabel}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm truncate">{displayName}</p>
            {stats.hasWarnings && (
              <AlertTriangle className="w-3 h-3 text-yellow-500 flex-shrink-0" />
            )}
            {stats.rejectedCount > 0 && (
              <ShieldAlert className="w-3 h-3 text-red-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {stats.captureCount} captured • {formatSats(stats.totalSats)} sats • <span className={stats.isKicked ? 'text-red-500 font-medium' : stats.isLeft ? 'text-gray-400 font-medium' : activityStatus === 'active' ? 'text-green-500' : activityStatus === 'idle' ? 'text-yellow-500' : 'text-gray-500'}>{stats.isKicked ? 'Kicked' : stats.isLeft ? 'Left' : activityLabel}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stats.avgTrustScore !== null && (
            <div className={`text-xs font-mono ${getTrustColor()}`}>
              <Activity className="w-3 h-3 inline mr-1" />
              {Math.round(stats.avgTrustScore)}
            </div>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-0">
          {stats.allFlags.length > 0 && (
            <div className="text-xs space-y-1 bg-background/50 rounded p-2 mb-2">
              <p className="text-muted-foreground font-medium mb-1">Activity Flags:</p>
              {stats.allFlags.map((flag, i) => (
                <div key={i} className="flex items-start gap-1 text-yellow-500">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="break-all">{flag}</span>
                </div>
              ))}
              {stats.rejectedCount > 0 && (
                <div className="flex items-center gap-1 text-red-500 mt-2 pt-2 border-t border-border">
                  <ShieldAlert className="w-3 h-3" />
                  <span>{stats.rejectedCount} capture{stats.rejectedCount !== 1 ? 's' : ''} blocked by anti-cheat</span>
                </div>
              )}
            </div>
          )}

          {/* Kick button - only show if player is still active */}
          {!stats.isKicked && !stats.isLeft && (
            <div className="flex justify-end">
              {confirmingKick ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Kick player?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onKick(stats.pubkey);
                      setConfirmingKick(false);
                    }}
                    disabled={isKicking}
                  >
                    {isKicking ? 'Kicking...' : 'Confirm'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmingKick(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-red-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingKick(true);
                  }}
                >
                  <UserMinus className="w-3 h-3 mr-1" />
                  Kick
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HostDashboard() {
  const { user } = useCurrentUser();
  const { state, isHost, addParticipant } = useGame();
  const { activeHunt, playerLocation } = state;
  const [timeRemaining, setTimeRemaining] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [syncedCaptures, setSyncedCaptures] = useState<Map<string, {
    playerPubkey: string;
    satAmount: number;
    capturedAt: number;
    antiCheat?: CaptureAntiCheat;
  }>>(new Map());
  const [syncedPlayers, setSyncedPlayers] = useState<Set<string>>(new Set());
  const [processingRequests, setProcessingRequests] = useState<Set<string>>(new Set());

  // Persist state to localStorage to prevent duplicate actions on refresh
  const huntId = activeHunt?.id ?? 'no-hunt';
  const paidCapturesKey = useMemo(() => `sathunter:paid-captures:${huntId}`, [huntId]);
  const rejectedCapturesKey = useMemo(() => `sathunter:rejected-captures:${huntId}`, [huntId]);
  const kickedPlayersKey = useMemo(() => `sathunter:kicked-players:${huntId}`, [huntId]);
  const leftPlayersKey = useMemo(() => `sathunter:left-players:${huntId}`, [huntId]);

  const [paidCaptures, setPaidCaptures] = useLocalStorage<Set<string>>(
    paidCapturesKey,
    new Set(),
    setSerializer
  );
  const [payingCaptures, setPayingCaptures] = useState<Set<string>>(new Set());
  const [pendingCaptures, setPendingCaptures] = useState<Set<string>>(new Set());
  const [rejectedCaptures, setRejectedCaptures] = useLocalStorage<Map<string, string>>(
    rejectedCapturesKey,
    new Map(),
    mapSerializer
  ); // monsterId -> reason

  const { payPlayer } = usePayPlayer();
  const { toast } = useToast();
  const { publishKick } = usePublishKick();
  const [kickingPlayer, setKickingPlayer] = useState<string | null>(null);
  const [kickedPlayers, setKickedPlayers] = useLocalStorage<Set<string>>(
    kickedPlayersKey,
    new Set(),
    setSerializer
  );
  const [leftPlayers, setLeftPlayers] = useLocalStorage<Set<string>>(
    leftPlayersKey,
    new Set(),
    setSerializer
  );

  // Rate limiting: track capture timestamps per player (max 3 per 10 seconds)
  const captureTimestampsRef = useRef<Map<string, number[]>>(new Map());

  // Handle kicking a player
  const handleKickPlayer = useCallback(async (playerPubkey: string) => {
    if (!activeHunt) return;

    setKickingPlayer(playerPubkey);
    try {
      const success = await publishKick({
        huntId: activeHunt.id,
        shareCode: activeHunt.shareCode,
        playerPubkey,
        reason: 'Removed by host',
      });

      if (success) {
        toast({
          title: 'Player kicked',
          description: 'The player has been removed from the hunt.',
        });
        // Mark player as kicked (keep them in the list with kicked status)
        setKickedPlayers(prev => new Set(prev).add(playerPubkey));
      } else {
        toast({
          title: 'Failed to kick player',
          description: 'Could not remove the player. Please try again.',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Error kicking player:', err);
      toast({
        title: 'Error',
        description: 'An error occurred while kicking the player.',
        variant: 'destructive',
      });
    } finally {
      setKickingPlayer(null);
    }
  }, [activeHunt, publishKick, toast, setKickedPlayers]);

  // P2P + Zero-Trust Relay hosting for secure location data transfer
  const {
    isActive: isHostingActive,
    connectedPlayers: _hostConnectedPlayers,
    sentDataTo: hostSentDataTo,
    error: hostError,
    zeroTrustHandshake: _zeroTrustHandshake,
    captureSecret,
    startHosting,
    stopHosting,
  } = useHostConnection(activeHunt);

  // Host approvals for join requests
  const {
    pendingRequests,
    approvedPlayers,
    approvePlayer,
    rejectPlayer,
    startListening: startApprovalListening,
    stopListening: stopApprovalListening,
  } = useHostApprovals();

  // Start listening for join requests when hunt requires approval
  useEffect(() => {
    if (activeHunt?.requiresApproval && activeHunt.id && activeHunt.shareCode) {
      startApprovalListening(activeHunt.id, activeHunt.shareCode);
    }
    return () => {
      stopApprovalListening();
    };
  }, [activeHunt?.id, activeHunt?.shareCode, activeHunt?.requiresApproval, startApprovalListening, stopApprovalListening]);

  // Pay player when a capture is detected (with anti-cheat validation)
  const processPayment = useCallback(async (
    monsterId: string,
    playerPubkey: string,
    satAmount: number,
    monsterName: string,
    antiCheat?: CaptureAntiCheat
  ) => {
    // Skip if already paid, paying, pending, or rejected
    if (paidCaptures.has(monsterId) || payingCaptures.has(monsterId) || pendingCaptures.has(monsterId) || rejectedCaptures.has(monsterId)) {
      return;
    }

    // Anti-cheat validation: check trust score
    if (antiCheat?.trustScore !== undefined) {
      if (antiCheat.trustScore < ANTI_CHEAT_CONFIG.MIN_TRUST_SCORE) {
        const reason = `Trust score ${antiCheat.trustScore} below threshold ${ANTI_CHEAT_CONFIG.MIN_TRUST_SCORE}`;
        console.warn(`[AntiCheat] Rejecting capture: ${reason}`, antiCheat.trustFlags);
        setRejectedCaptures(prev => new Map(prev).set(monsterId, reason));
        toast({
          title: 'Suspicious capture detected',
          description: `Payment blocked: ${reason}`,
          variant: 'destructive',
        });
        return;
      }

      // Log any flags for monitoring (payment still proceeds if score is OK)
      if (antiCheat.trustFlags && antiCheat.trustFlags.length > 0) {
        console.log(`[AntiCheat] Capture flags for ${monsterName}:`, antiCheat.trustFlags);
      }
    }

    setPayingCaptures(prev => new Set(prev).add(monsterId));

    const result = await payPlayer(playerPubkey, satAmount, monsterName);

    if (result.success) {
      setPaidCaptures(prev => new Set(prev).add(monsterId));
      toast({
        title: `Payment sent! ⚡`,
        description: `${satAmount} sats sent for capturing ${monsterName}`,
      });
    } else if (result.pending) {
      setPendingCaptures(prev => new Set(prev).add(monsterId));
      toast({
        title: 'Payment routing...',
        description: `${satAmount} sats for ${monsterName} is being routed. Check your wallet.`,
      });
    } else {
      toast({
        title: 'Payment failed',
        description: result.error || 'Could not pay player',
        variant: 'destructive',
      });
    }

    setPayingCaptures(prev => {
      const next = new Set(prev);
      next.delete(monsterId);
      return next;
    });
  }, [payPlayer, paidCaptures, payingCaptures, pendingCaptures, rejectedCaptures, toast, setPaidCaptures, setRejectedCaptures]);

  // Callbacks for hunt sync
  const onMonsterCaptured = useCallback((
    monsterId: string,
    playerPubkey: string,
    satAmount: number,
    capturedAt: number,
    antiCheat?: CaptureAntiCheat
  ) => {
    setSyncedCaptures(prev => {
      const next = new Map(prev);
      next.set(monsterId, { playerPubkey, satAmount, capturedAt, antiCheat });
      return next;
    });
    // Also track player if not already in participants
    setSyncedPlayers(prev => {
      const next = new Set(prev);
      next.add(playerPubkey);
      return next;
    });

    // Find the monster name and trigger payment (with anti-cheat validation)
    if (activeHunt) {
      const monster = activeHunt.monsters.find(m => m.id === monsterId);
      if (monster && !paidCaptures.has(monsterId)) {
        // Rate limit: max 3 captures per 10 seconds per player
        const now = Date.now();
        const timestamps = captureTimestampsRef.current.get(playerPubkey) ?? [];
        const recent = timestamps.filter(t => now - t < 10000);
        if (recent.length >= 3) {
          console.warn(`[AntiCheat] Rate limiting player ${playerPubkey.slice(0, 8)}...: ${recent.length} captures in 10s`);
          setRejectedCaptures(prev => new Map(prev).set(monsterId, 'Capture rate limit exceeded'));
          return;
        }
        recent.push(now);
        captureTimestampsRef.current.set(playerPubkey, recent);

        // Host-side distance check: reject captures from obviously wrong locations
        // Geohash precision 5 = ~5km cells, so use 5km threshold to catch remote attacks
        if (antiCheat?.geohash) {
          const playerLocation = decodeGeohash(antiCheat.geohash);
          const distance = calculateDistance(playerLocation, monster.location);
          if (distance > 5000) {
            console.warn(`[AntiCheat] Rejecting capture: player ${distance.toFixed(0)}m from monster`);
            setRejectedCaptures(prev => new Map(prev).set(monsterId, `Player location ${distance.toFixed(0)}m from monster`));
            return;
          }
        }
        // Verify HMAC capture proof (proves player received hunt data via authenticated channel)
        if (captureSecret) {
          if (!antiCheat?.captureProof) {
            console.warn(`[AntiCheat] Rejecting capture: missing capture proof from player ${playerPubkey.slice(0, 8)}...`);
            setRejectedCaptures(prev => new Map(prev).set(monsterId, 'Missing capture proof'));
            return;
          }
          if (!verifyCaptureProof(captureSecret, monsterId, playerPubkey, capturedAt, antiCheat.captureProof)) {
            console.warn(`[AntiCheat] Rejecting capture: invalid capture proof from player ${playerPubkey.slice(0, 8)}...`);
            setRejectedCaptures(prev => new Map(prev).set(monsterId, 'Invalid capture proof'));
            return;
          }
        }

        // Use host-side monster value, NOT player-reported satAmount
        processPayment(monsterId, playerPubkey, monster.satAmount, monster.name, antiCheat);
      }
    }
  }, [activeHunt, paidCaptures, processPayment, setRejectedCaptures, captureSecret]);

  const onPlayerJoined = useCallback((playerPubkey: string) => {
    setSyncedPlayers(prev => {
      const next = new Set(prev);
      next.add(playerPubkey);
      return next;
    });
    // Remove from leftPlayers if they're rejoining
    if (leftPlayers.has(playerPubkey)) {
      setLeftPlayers(prev => {
        const next = new Set(prev);
        next.delete(playerPubkey);
        return next;
      });
    }
    // Add to game context participants
    addParticipant(playerPubkey);
  }, [addParticipant, leftPlayers, setLeftPlayers]);

  const onPlayerLeft = useCallback((playerPubkey: string) => {
    // Skip if already tracked as left (prevents duplicate toasts on refresh)
    if (leftPlayers.has(playerPubkey)) return;

    // Mark player as left (don't remove from list, just track status)
    setLeftPlayers(prev => new Set(prev).add(playerPubkey));
    toast({
      title: 'Player left',
      description: `A player has left the hunt`,
    });
  }, [leftPlayers, setLeftPlayers, toast]);

  // Subscribe to hunt updates via Nostr (host signer decrypts encrypted capture events)
  const { refresh: refreshSync } = useHuntSync(activeHunt, {
    onMonsterCaptured,
    onPlayerJoined,
    onPlayerLeft,
  }, user?.signer);

  // Update time remaining
  useEffect(() => {
    if (!activeHunt) return;
    const updateTime = () => setTimeRemaining(formatTimeRemaining(activeHunt.endTime));
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [activeHunt]);

  // Generate QR code
  useEffect(() => {
    if (activeHunt?.shareUrl) {
      QRCode.toDataURL(activeHunt.shareUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#f97316', light: '#0d0f14' },
      }).then(setQrCodeUrl);
    }
  }, [activeHunt?.shareUrl]);

  // Auto-start hosting when hunt is ready/active (P2P + zero-trust relay)
  useEffect(() => {
    if (activeHunt && (activeHunt.status === 'ready' || activeHunt.status === 'active') && !isHostingActive) {
      console.log('[HostDashboard] Starting hosting for hunt', activeHunt.shareCode);
      startHosting();
    }
  }, [activeHunt, activeHunt?.status, isHostingActive, startHosting]);

  // Cleanup hosting on unmount
  useEffect(() => {
    return () => {
      stopHosting();
    };
  }, [stopHosting]);



  if (!activeHunt || !isHost()) return null;

  // Calculate stats combining local state and synced Nostr events
  // Use the higher of local or synced counts (they might overlap)
  const capturedMonsterIds = new Set([
    ...activeHunt.monsters.filter(m => m.captured).map(m => m.id),
    ...syncedCaptures.keys(),
  ]);
  const capturedCount = capturedMonsterIds.size;

  // Merge monsters with synced capture status for map display
  const monstersForMap = activeHunt.monsters.map(m => ({
    ...m,
    captured: m.captured || syncedCaptures.has(m.id),
  }));

  // Calculate sats - combine but avoid double counting using monster IDs
  const satsCollected = activeHunt.monsters
    .filter(m => capturedMonsterIds.has(m.id))
    .reduce((sum, m) => sum + m.satAmount, 0);

  const satsRemaining = activeHunt.totalSats - satsCollected;
  const progress = (capturedCount / activeHunt.monsterCount) * 100;
  const isEnded = Date.now() > activeHunt.endTime;

  // Combine participants from local state and synced events
  const allPlayerPubkeys = new Set([
    ...activeHunt.participants.map(p => p.pubkey),
    ...syncedPlayers,
  ]);
  // Active player count excludes kicked and left players
  const inactivePlayers = new Set([...kickedPlayers, ...leftPlayers]);
  const activePlayerCount = Array.from(allPlayerPubkeys).filter(p => !inactivePlayers.has(p)).length;

  const handleCopyLink = () => {
    if (activeHunt.shareUrl) {
      navigator.clipboard.writeText(activeHunt.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="bg-primary/10 border-primary/30">
          <CardContent className="p-3 text-center">
            <Zap className="w-5 h-5 mx-auto text-primary mb-1" />
            <p className="font-display text-xl font-bold text-primary">
              {formatSats(satsRemaining)}
            </p>
            <p className="text-xs text-muted-foreground">Remaining</p>
          </CardContent>
        </Card>
        <Card className="bg-secondary/10 border-secondary/30">
          <CardContent className="p-3 text-center">
            <Users className="w-5 h-5 mx-auto text-secondary mb-1" />
            <p className="font-display text-xl font-bold text-secondary">
              {activePlayerCount}
            </p>
            <p className="text-xs text-muted-foreground">Players</p>
          </CardContent>
        </Card>
        <Card className={`border-accent/30 ${payingCaptures.size > 0 ? 'bg-yellow-500/10' : pendingCaptures.size > 0 ? 'bg-amber-500/10' : paidCaptures.size > 0 ? 'bg-green-500/10' : 'bg-muted/30'}`}>
          <CardContent className="p-3 text-center">
            <Check className={`w-5 h-5 mx-auto mb-1 ${payingCaptures.size > 0 ? 'text-yellow-500 animate-pulse' : pendingCaptures.size > 0 ? 'text-amber-500' : 'text-green-500'}`} />
            <p className="font-display text-xl font-bold">
              {paidCaptures.size}/{capturedCount}
            </p>
            <p className="text-xs text-muted-foreground">
              {payingCaptures.size > 0 ? 'Paying...' : pendingCaptures.size > 0 ? `${pendingCaptures.size} routing...` : 'Paid'}
            </p>
          </CardContent>
        </Card>
        {/* Rejected captures indicator (anti-cheat) */}
        {rejectedCaptures.size > 0 && (
          <Card className="col-span-3 border-red-500/30 bg-red-500/10">
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-500" />
                <span className="text-sm text-red-400">
                  {rejectedCaptures.size} suspicious capture{rejectedCaptures.size !== 1 ? 's' : ''} blocked
                </span>
              </div>
              <Badge variant="destructive" className="text-xs">Anti-Cheat</Badge>
            </CardContent>
          </Card>
        )}
        {/* Connection Status - Privacy Mode (P2P + Relay Fallback) */}
        <Card className={`col-span-3 ${isHostingActive ? 'border-green-500/30 bg-green-500/10' : 'border-yellow-500/30 bg-yellow-500/10'}`}>
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi className={`w-5 h-5 ${isHostingActive ? 'text-green-500' : 'text-yellow-500'}`} />
              <span className={`text-sm ${isHostingActive ? 'text-green-400' : 'text-yellow-400'}`}>
                {isHostingActive
                  ? `Hosting Active - ${hostSentDataTo} player${hostSentDataTo !== 1 ? 's' : ''} received location data`
                  : 'Starting secure connection...'}
              </span>
            </div>
            <Badge variant="outline" className={`text-xs ${isHostingActive ? 'border-green-500/50 text-green-500' : 'border-yellow-500/50 text-yellow-500'}`}>
              🔒 Privacy Mode
            </Badge>
          </CardContent>
        </Card>
        {hostError && (
          <Card className="col-span-3 border-red-500/30 bg-red-500/10">
            <CardContent className="p-3 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-500" />
              <span className="text-sm text-red-400">Connection Error: {hostError}</span>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pending Join Requests */}
      {activeHunt.requiresApproval && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-500" />
                Join Requests
              </span>
              <Badge variant="outline" className="border-amber-500/50 text-amber-500">
                {pendingRequests.length} pending
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No pending requests. Players will appear here when they request to join.
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {pendingRequests.map((request) => (
                  <PlayerRequestCard
                    key={request.id}
                    pubkey={request.playerPubkey}
                    message={request.message}
                    requestedAt={request.requestedAt}
                    isProcessing={processingRequests.has(request.id)}
                    onApprove={async () => {
                      setProcessingRequests(prev => new Set(prev).add(request.id));
                      const success = await approvePlayer(request);
                      if (success) {
                        toast({
                          title: 'Player Approved',
                          description: 'They can now connect and join the hunt',
                        });
                      }
                      setProcessingRequests(prev => {
                        const next = new Set(prev);
                        next.delete(request.id);
                        return next;
                      });
                    }}
                    onReject={async () => {
                      setProcessingRequests(prev => new Set(prev).add(request.id));
                      const success = await rejectPlayer(request);
                      if (success) {
                        toast({
                          title: 'Request Declined',
                          description: 'Player will be notified',
                        });
                      }
                      setProcessingRequests(prev => {
                        const next = new Set(prev);
                        next.delete(request.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            )}
            {approvedPlayers.size > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  <UserCheck className="w-3 h-3 inline mr-1 text-green-500" />
                  {approvedPlayers.size} player{approvedPlayers.size !== 1 ? 's' : ''} approved
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Event Status */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              {activeHunt.name}
            </span>
            <Badge
              variant={isEnded ? 'destructive' : activeHunt.status === 'active' ? 'default' : 'outline'}
              className={activeHunt.status === 'active' ? 'bg-secondary' : activeHunt.status === 'ready' && activeHunt.startTime > Date.now() ? 'border-cyan-500/50 text-cyan-500' : ''}
            >
              {activeHunt.status === 'active' ? (
                <>
                  <Clock className="w-3 h-3 mr-1" />
                  {timeRemaining}
                </>
              ) : activeHunt.status === 'ready' && activeHunt.startTime > Date.now() ? (
                <>
                  <CalendarClock className="w-3 h-3 mr-1" />
                  Starts {formatCountdown(activeHunt.startTime)}
                </>
              ) : (
                activeHunt.status.toUpperCase()
              )}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Progress */}
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>
                <Skull className="w-3 h-3 inline mr-1" />
                {capturedCount}/{activeHunt.monsterCount}
              </span>
              <span>{Math.round(progress)}% captured</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

        </CardContent>
      </Card>

      {/* Live Map Overview */}
      <Card className="border-accent/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-accent" />
            Live Map Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-64 rounded-lg overflow-hidden">
            <HuntMap
              center={activeHunt.geoFence.center}
              radiusMeters={activeHunt.geoFence.radiusMeters}
              playerLocation={playerLocation}
              monsters={monstersForMap}
              satStops={activeHunt.satStops}
              showAllMonsters={true}
              boundaryType={activeHunt.geoFence.boundaryType}
              polygon={activeHunt.geoFence.polygon}
            />
          </div>
        </CardContent>
      </Card>

      {/* Share Section */}
      <Card className="border-accent/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <QrCode className="w-4 h-4 text-accent" />
            Share Hunt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* QR Code */}
          {qrCodeUrl && (
            <div className="flex justify-center">
              <img src={qrCodeUrl} alt="Hunt QR Code" className="w-32 h-32 rounded-lg" />
            </div>
          )}

          {/* Share Code */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Hunt Code</p>
            <p className="font-mono text-2xl font-bold tracking-widest text-primary">
              {activeHunt.shareCode}
            </p>
          </div>

          {/* Copy Link */}
          <Button variant="outline" onClick={handleCopyLink} className="w-full">
            {copied ? (
              <>
                <Check className="w-4 h-4 mr-2 text-secondary" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 mr-2" />
                Copy Invite Link
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Player Monitoring */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Player Monitor ({activePlayerCount} active)
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshSync}
              className="h-6 w-6 p-0"
              title="Refresh player data"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {allPlayerPubkeys.size === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No players have joined yet. Share the code above!
            </p>
          ) : (
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {Array.from(allPlayerPubkeys).map((pubkey) => {
                  // Get local participant data if available
                  const localParticipant = activeHunt.participants.find(p => p.pubkey === pubkey);

                  // Calculate synced stats for this player
                  const playerCaptures = Array.from(syncedCaptures.entries())
                    .filter(([, data]) => data.playerPubkey === pubkey);
                  const syncedCaptureCount = playerCaptures.length;
                  const syncedSats = playerCaptures.reduce((sum, [, data]) => sum + data.satAmount, 0);

                  // Aggregate trust scores and flags
                  const trustScores: number[] = [];
                  const allFlags: string[] = [];
                  playerCaptures.forEach(([, data]) => {
                    if (data.antiCheat?.trustScore !== undefined) {
                      trustScores.push(data.antiCheat.trustScore);
                    }
                    if (data.antiCheat?.trustFlags) {
                      allFlags.push(...data.antiCheat.trustFlags);
                    }
                  });

                  // Count rejected captures for this player
                  const rejectedForPlayer = Array.from(rejectedCaptures.entries())
                    .filter(([monsterId]) => {
                      // Check if this monster was attempted by this player
                      const capture = syncedCaptures.get(monsterId);
                      return capture?.playerPubkey === pubkey;
                    }).length;

                  // Calculate average trust score
                  const avgTrustScore = trustScores.length > 0
                    ? trustScores.reduce((a, b) => a + b, 0) / trustScores.length
                    : null;

                  // Calculate last capture time (most recent capture)
                  const lastCaptureTime = playerCaptures.length > 0
                    ? Math.max(...playerCaptures.map(([, data]) => data.capturedAt))
                    : null;

                  // Combine stats
                  const totalCaptured = Math.max(localParticipant?.totalCaptured || 0, syncedCaptureCount);
                  const totalSats = Math.max(localParticipant?.totalSatsEarned || 0, syncedSats);

                  const stats: PlayerMonitorStats = {
                    pubkey,
                    captureCount: totalCaptured,
                    totalSats,
                    avgTrustScore,
                    allFlags: [...new Set(allFlags)], // Dedupe flags
                    hasWarnings: allFlags.length > 0,
                    rejectedCount: rejectedForPlayer,
                    lastCaptureTime,
                    isKicked: kickedPlayers.has(pubkey),
                    isLeft: leftPlayers.has(pubkey),
                  };

                  return (
                    <PlayerMonitorCard
                      key={pubkey}
                      stats={stats}
                      onKick={handleKickPlayer}
                      isKicking={kickingPlayer === pubkey}
                    />
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
