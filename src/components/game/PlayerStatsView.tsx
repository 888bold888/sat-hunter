import { useState, useMemo } from 'react';
import { useGame } from '@/contexts/GameContext';
import { formatSats } from '@/lib/gameUtils';
import { MONSTER_EMOJI_MAP } from '@/lib/gameTypes';
import type { MonsterTypeStats, MonsterRarity } from '@/lib/gameTypes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Zap,
  Target,
  Trophy,
  Clock,
  Calendar,
  Skull,
  TrendingUp,
  History,
} from 'lucide-react';

const RARITY_COLORS: Record<MonsterRarity, string> = {
  common: 'text-gray-400',
  uncommon: 'text-green-400',
  rare: 'text-blue-400',
  legendary: 'text-purple-400',
  mythic: 'text-yellow-400',
};

const RARITY_BG: Record<MonsterRarity, string> = {
  common: 'bg-gray-500/10 border-gray-500/30',
  uncommon: 'bg-green-500/10 border-green-500/30',
  rare: 'bg-blue-500/10 border-blue-500/30',
  legendary: 'bg-purple-500/10 border-purple-500/30',
  mythic: 'bg-yellow-500/10 border-yellow-500/30',
};

interface PlayerStatsViewProps {
  showCurrentHunt?: boolean;
}

export function PlayerStatsView({ showCurrentHunt = true }: PlayerStatsViewProps) {
  const { state } = useGame();
  const { playerStats, activeHunt } = state;
  const [selectedHuntId, setSelectedHuntId] = useState<string | null>(null);

  // Calculate monster type stats from all captured monsters
  const monsterTypeStats = useMemo((): MonsterTypeStats[] => {
    const statsMap = new Map<string, MonsterTypeStats>();

    playerStats.capturedMonsters.forEach((monster) => {
      const type = monster.monsterType || monster.monsterName;
      const existing = statsMap.get(type);

      if (existing) {
        existing.totalCaptured += 1;
        existing.totalSatsEarned += monster.satAmount;
      } else {
        statsMap.set(type, {
          type,
          name: monster.monsterName,
          emoji: MONSTER_EMOJI_MAP[type] || MONSTER_EMOJI_MAP[monster.monsterName] || '?',
          rarity: monster.rarity,
          totalCaptured: 1,
          totalSatsEarned: monster.satAmount,
        });
      }
    });

    // Sort by total captured (descending), then by rarity
    const rarityOrder: MonsterRarity[] = ['mythic', 'legendary', 'rare', 'uncommon', 'common'];
    return Array.from(statsMap.values()).sort((a, b) => {
      if (b.totalCaptured !== a.totalCaptured) {
        return b.totalCaptured - a.totalCaptured;
      }
      return rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity);
    });
  }, [playerStats.capturedMonsters]);

  // Get selected hunt details
  const selectedHunt = selectedHuntId
    ? playerStats.huntHistory.find((h) => h.huntId === selectedHuntId)
    : null;

  // Format date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      {/* Header Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Current Hunt Stats (if in hunt) */}
        {showCurrentHunt && activeHunt && (
          <>
            <Card className="bg-secondary/10 border-secondary/30">
              <CardContent className="p-3 text-center">
                <Target className="w-5 h-5 mx-auto text-secondary mb-1" />
                <p className="font-display text-2xl font-bold text-secondary">
                  {playerStats.currentHuntCaptured}
                </p>
                <p className="text-xs text-muted-foreground">This Hunt</p>
              </CardContent>
            </Card>
            <Card className="bg-primary/10 border-primary/30">
              <CardContent className="p-3 text-center">
                <Zap className="w-5 h-5 mx-auto text-primary mb-1" />
                <p className="font-display text-2xl font-bold text-primary">
                  {formatSats(playerStats.currentHuntSatsEarned)}
                </p>
                <p className="text-xs text-muted-foreground">Sats This Hunt</p>
              </CardContent>
            </Card>
          </>
        )}

        {/* Lifetime Stats */}
        <Card className="bg-accent/10 border-accent/30">
          <CardContent className="p-3 text-center">
            <Trophy className="w-5 h-5 mx-auto text-accent mb-1" />
            <p className="font-display text-2xl font-bold">
              {playerStats.lifetimeCaptured}
            </p>
            <p className="text-xs text-muted-foreground">Lifetime Captures</p>
          </CardContent>
        </Card>
        <Card className="bg-yellow-500/10 border-yellow-500/30">
          <CardContent className="p-3 text-center">
            <TrendingUp className="w-5 h-5 mx-auto text-yellow-500 mb-1" />
            <p className="font-display text-2xl font-bold text-yellow-500">
              {formatSats(playerStats.lifetimeSatsEarned)}
            </p>
            <p className="text-xs text-muted-foreground">Lifetime Sats</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for detailed views */}
      <Tabs defaultValue="monsters" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="monsters" className="text-xs">
            <Skull className="w-3 h-3 mr-1" />
            Creatures
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            <History className="w-3 h-3 mr-1" />
            Hunt History
          </TabsTrigger>
        </TabsList>

        {/* Monsters by Type */}
        <TabsContent value="monsters" className="mt-3">
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Skull className="w-4 h-4" />
                Captured by Type ({monsterTypeStats.length} types)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {monsterTypeStats.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No creatures captured yet. Join a hunt to start capturing!
                </p>
              ) : (
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {monsterTypeStats.map((stats) => (
                      <div
                        key={stats.type}
                        className={`flex items-center justify-between p-2 rounded border ${RARITY_BG[stats.rarity]}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{stats.emoji}</span>
                          <div>
                            <p className={`font-medium text-sm ${RARITY_COLORS[stats.rarity]}`}>
                              {stats.name}
                            </p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {stats.rarity}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-display font-bold">{stats.totalCaptured}x</p>
                          <p className="text-xs text-primary">
                            {formatSats(stats.totalSatsEarned)} sats
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Hunt History */}
        <TabsContent value="history" className="mt-3">
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="w-4 h-4" />
                Past Hunts ({playerStats.huntHistory.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {playerStats.huntHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No hunt history yet. Complete a hunt to see it here!
                </p>
              ) : selectedHunt ? (
                // Detailed view of selected hunt
                <div className="space-y-3">
                  <button
                    onClick={() => setSelectedHuntId(null)}
                    className="text-xs text-primary hover:underline"
                  >
                    ← Back to all hunts
                  </button>
                  <div className="p-3 bg-muted/30 rounded-lg space-y-2">
                    <h4 className="font-display font-bold">{selectedHunt.huntName}</h4>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      {formatDate(selectedHunt.startTime)}
                      <Clock className="w-3 h-3 ml-2" />
                      {formatTime(selectedHunt.joinedAt)} - {formatTime(selectedHunt.leftAt || selectedHunt.endTime)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="text-center p-2 bg-secondary/10 rounded">
                        <p className="font-display font-bold text-secondary">
                          {selectedHunt.monstersCapt}
                        </p>
                        <p className="text-xs text-muted-foreground">Captured</p>
                      </div>
                      <div className="text-center p-2 bg-primary/10 rounded">
                        <p className="font-display font-bold text-primary">
                          {formatSats(selectedHunt.satsEarned)}
                        </p>
                        <p className="text-xs text-muted-foreground">Sats Stacked</p>
                      </div>
                    </div>
                    {selectedHunt.capturedMonsters.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-muted-foreground mb-2">Creatures Captured:</p>
                        <div className="flex flex-wrap gap-1">
                          {selectedHunt.capturedMonsters.map((m, i) => (
                            <Badge
                              key={i}
                              variant="outline"
                              className={`text-xs ${RARITY_BG[m.rarity]}`}
                            >
                              {MONSTER_EMOJI_MAP[m.monsterType] || MONSTER_EMOJI_MAP[m.monsterName] || '?'}{' '}
                              {m.monsterName}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                // List of all hunts
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {playerStats.huntHistory
                      .slice()
                      .sort((a, b) => b.startTime - a.startTime)
                      .map((hunt) => (
                        <button
                          key={hunt.huntId}
                          onClick={() => setSelectedHuntId(hunt.huntId)}
                          className="w-full flex items-center justify-between p-2 bg-muted/30 rounded hover:bg-muted/50 transition-colors text-left"
                        >
                          <div>
                            <p className="font-medium text-sm">{hunt.huntName}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatDate(hunt.startTime)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-display">
                              {hunt.monstersCapt} <Skull className="w-3 h-3 inline" />
                            </p>
                            <p className="text-xs text-primary">
                              {formatSats(hunt.satsEarned)} sats
                            </p>
                          </div>
                        </button>
                      ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
