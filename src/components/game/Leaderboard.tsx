import { useMemo } from 'react';
import { useGame } from '@/contexts/GameContext';
import { useAuthor } from '@/hooks/useAuthor';
import { formatSats } from '@/lib/gameUtils';
import { genUserName } from '@/lib/genUserName';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trophy, Medal, Zap, Crown, Skull } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeaderboardEntryProps {
  rank: number;
  pubkey: string;
  sats: number;
  captures: number;
  isCurrentUser: boolean;
}

function LeaderboardEntry({ rank, pubkey, sats, captures, isCurrentUser }: LeaderboardEntryProps) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name ?? genUserName(pubkey);
  const avatar = metadata?.picture;

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-yellow-400" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-300" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />;
      default:
        return <span className="font-mono text-muted-foreground">#{rank}</span>;
    }
  };

  const getRankBg = (rank: number) => {
    switch (rank) {
      case 1:
        return 'bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border-yellow-500/50';
      case 2:
        return 'bg-gradient-to-r from-gray-400/20 to-gray-300/20 border-gray-400/50';
      case 3:
        return 'bg-gradient-to-r from-amber-700/20 to-amber-600/20 border-amber-700/50';
      default:
        return 'bg-muted/30 border-border';
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border transition-all',
        getRankBg(rank),
        isCurrentUser && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {/* Rank */}
      <div className="w-8 flex items-center justify-center">{getRankIcon(rank)}</div>

      {/* Avatar */}
      <Avatar className="w-10 h-10 border-2 border-primary/30">
        <AvatarImage src={avatar} />
        <AvatarFallback className="bg-primary/10 text-primary font-display">
          {displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <p className={cn('font-medium truncate', isCurrentUser && 'text-primary')}>
          {displayName}
          {isCurrentUser && (
            <Badge variant="outline" className="ml-2 text-xs border-primary/50 text-primary">
              You
            </Badge>
          )}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Skull className="w-3 h-3" />
          <span>{captures} captured</span>
        </div>
      </div>

      {/* Sats */}
      <div className="text-right">
        <div className="flex items-center gap-1 font-display font-bold text-primary text-glow-orange">
          <Zap className="w-4 h-4" />
          {formatSats(sats)}
        </div>
        <p className="text-xs text-muted-foreground">sats</p>
      </div>
    </div>
  );
}

interface LeaderboardProps {
  currentUserPubkey?: string;
}

export function Leaderboard({ currentUserPubkey }: LeaderboardProps) {
  const { state } = useGame();
  const { activeHunt } = state;

  // Build leaderboard from captured monsters
  const leaderboard = useMemo(() => {
    if (!activeHunt) return [];

    const statsMap = new Map<string, { sats: number; captures: number }>();

    // Aggregate stats from captured monsters
    activeHunt.monsters
      .filter((m) => m.captured && m.capturedBy)
      .forEach((m) => {
        const existing = statsMap.get(m.capturedBy!) ?? { sats: 0, captures: 0 };
        statsMap.set(m.capturedBy!, {
          sats: existing.sats + m.satAmount,
          captures: existing.captures + 1,
        });
      });

    // Sort by sats (descending)
    return Array.from(statsMap.entries())
      .map(([pubkey, stats]) => ({
        pubkey,
        ...stats,
      }))
      .sort((a, b) => b.sats - a.sats);
  }, [activeHunt]);

  if (!activeHunt) {
    return (
      <Card className="bg-card/80 backdrop-blur border-primary/30">
        <CardContent className="p-8 text-center">
          <Trophy className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No active hunt</p>
        </CardContent>
      </Card>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <Card className="bg-card/80 backdrop-blur border-primary/30">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-400" />
            Leaderboard
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-8 text-center">
          <div className="py-8">
            <Skull className="w-16 h-16 mx-auto text-muted-foreground mb-4 animate-float" />
            <p className="text-muted-foreground">No captures yet!</p>
            <p className="text-sm text-muted-foreground mt-1">Be the first to catch a creature</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/80 backdrop-blur border-primary/30 shadow-glow-orange">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <Trophy className="w-6 h-6 text-yellow-400" />
          Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px] px-4 pb-4">
          <div className="space-y-2">
            {leaderboard.map((entry, index) => (
              <LeaderboardEntry
                key={entry.pubkey}
                rank={index + 1}
                pubkey={entry.pubkey}
                sats={entry.sats}
                captures={entry.captures}
                isCurrentUser={entry.pubkey === currentUserPubkey}
              />
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
