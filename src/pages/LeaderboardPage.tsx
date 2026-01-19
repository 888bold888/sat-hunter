import { useSeoMeta } from '@unhead/react';
import { Link } from 'react-router-dom';
import { Leaderboard } from '@/components/game/Leaderboard';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { LoginArea } from '@/components/auth/LoginArea';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Trophy, Zap, Play } from 'lucide-react';

export default function LeaderboardPage() {
  const { user } = useCurrentUser();

  useSeoMeta({
    title: 'Leaderboard | Sat Hunter',
    description: 'See the top hunters and their Bitcoin earnings',
  });

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
                <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-400 flex-shrink-0" />
                <span className="truncate">Leaderboard</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">Top hunters this session</p>
            </div>
          </div>
          <LoginArea />
        </div>

        {/* Leaderboard Component */}
        <Leaderboard currentUserPubkey={user?.pubkey} />

        {/* CTA to Play */}
        <Card className="bg-card/60 backdrop-blur border-primary/30">
          <CardContent className="p-6 text-center space-y-4">
            <Zap className="w-12 h-12 mx-auto text-primary animate-pulse" />
            <div>
              <h3 className="font-display font-bold text-lg">Ready to Hunt?</h3>
              <p className="text-sm text-muted-foreground">
                Join a hunt and start catching creatures to earn sats!
              </p>
            </div>
            <Link to="/play">
              <Button className="w-full bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange">
                <Play className="w-4 h-4 mr-2" />
                Start Hunting
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
