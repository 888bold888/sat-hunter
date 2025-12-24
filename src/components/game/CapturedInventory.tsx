import { useGame } from '@/contexts/GameContext';
import { formatSats, getRarityColor, getRarityBgColor } from '@/lib/gameUtils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Zap, Package, Clock, Sparkles, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MONSTER_EMOJI_MAP } from '@/lib/gameTypes';

export function CapturedInventory() {
  const { state } = useGame();
  const { playerStats } = state;
  const { capturedMonsters, totalSatsEarned, totalCaptured } = playerStats;

  // Group by rarity for stats
  const rarityStats = capturedMonsters.reduce(
    (acc, monster) => {
      acc[monster.rarity] = (acc[monster.rarity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Card className="bg-card/80 backdrop-blur border-secondary/30 shadow-glow-green">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <Package className="w-6 h-6 text-secondary" />
          My Captures
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 text-center">
            <Zap className="w-8 h-8 mx-auto text-primary mb-2" />
            <p className="font-display font-bold text-2xl text-primary text-glow-orange">
              {formatSats(totalSatsEarned)}
            </p>
            <p className="text-xs text-muted-foreground">Total Sats Earned</p>
          </div>
          <div className="p-4 rounded-lg bg-accent/10 border border-accent/30 text-center">
            <Trophy className="w-8 h-8 mx-auto text-accent mb-2" />
            <p className="font-display font-bold text-2xl text-accent">{totalCaptured}</p>
            <p className="text-xs text-muted-foreground">Creatures Captured</p>
          </div>
        </div>

        {/* Rarity Breakdown */}
        {Object.keys(rarityStats).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(rarityStats).map(([rarity, count]) => (
              <Badge
                key={rarity}
                variant="outline"
                className={cn('border', getRarityColor(rarity as never))}
              >
                {rarity}: {count}
              </Badge>
            ))}
          </div>
        )}

        <Separator />

        {/* Captured List */}
        {capturedMonsters.length === 0 ? (
          <div className="py-8 text-center">
            <Sparkles className="w-16 h-16 mx-auto text-muted-foreground mb-4 animate-float" />
            <p className="text-muted-foreground">No captures yet!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Get out there and catch some creatures!
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {[...capturedMonsters].reverse().map((capture, index) => {
                const emoji = MONSTER_EMOJI_MAP[capture.monsterName] || '⚡';

                return (
                  <div
                    key={`${capture.monsterId}-${index}`}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border',
                      getRarityBgColor(capture.rarity)
                    )}
                  >
                    {/* Monster Emoji */}
                    <div
                      className={cn(
                        'w-10 h-10 rounded-full flex items-center justify-center text-xl',
                        'bg-gradient-to-br from-muted to-background border-2',
                        getRarityColor(capture.rarity).replace('text-', 'border-')
                      )}
                    >
                      {emoji}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={cn('font-medium truncate', getRarityColor(capture.rarity))}>
                        {capture.monsterName}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] py-0">
                          {capture.rarity}
                        </Badge>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(capture.capturedAt)}
                        </span>
                      </div>
                    </div>

                    {/* Sats */}
                    <div className="text-right">
                      <div className="flex items-center gap-1 font-display font-bold text-primary">
                        <Zap className="w-4 h-4" />
                        {formatSats(capture.satAmount)}
                      </div>
                      <p className="text-[10px] text-muted-foreground">sats</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
