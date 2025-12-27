import { useState } from 'react';
import type { Monster } from '@/lib/gameTypes';
import {
  getRarityColor,
  getRarityBgColor,
  getRarityGlow,
  formatSats,
  getMonsterSize,
} from '@/lib/gameUtils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Target, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MonsterCardProps {
  monster: Monster;
  totalSats: number;
  onCapture: (monster: Monster) => void;
  isInRange: boolean;
  hasBalls: boolean;
  isCapturing?: boolean;
  onClose?: () => void;
}

export function MonsterCard({
  monster,
  totalSats,
  onCapture,
  isInRange,
  hasBalls,
  isCapturing,
  onClose,
}: MonsterCardProps) {
  const [isCaptured, setIsCaptured] = useState(false);

  const handleCapture = () => {
    setIsCaptured(true);
    setTimeout(() => {
      onCapture(monster);
    }, 500);
  };

  const sizeClass = getMonsterSize(monster.satAmount, totalSats);

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-all duration-300 border-2',
        getRarityBgColor(monster.rarity),
        getRarityGlow(monster.rarity),
        isCaptured && 'animate-catch',
        !isCaptured && 'animate-float hover:scale-105'
      )}
    >
      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 p-1 rounded-full bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* Rarity sparkles for legendary and mythic */}
      {(monster.rarity === 'legendary' || monster.rarity === 'mythic') && (
        <div className="absolute inset-0 pointer-events-none">
          <Sparkles className="absolute top-2 right-8 w-4 h-4 text-yellow-400 animate-pulse" />
          <Sparkles className="absolute bottom-2 left-2 w-3 h-3 text-yellow-400 animate-pulse delay-150" />
        </div>
      )}

      <CardContent className="p-4 flex flex-col items-center gap-3">
        {/* Monster Visual */}
        <div
          className={cn(
            'rounded-full flex items-center justify-center bg-gradient-to-br from-muted to-background border-2',
            getRarityBgColor(monster.rarity),
            sizeClass
          )}
        >
          <span className="drop-shadow-lg">{monster.emoji}</span>
        </div>

        {/* Monster Info */}
        <div className="text-center space-y-1">
          <h3 className={cn('font-display font-bold text-sm', getRarityColor(monster.rarity))}>
            {monster.name}
          </h3>
          <Badge variant="outline" className={cn('text-xs', getRarityColor(monster.rarity))}>
            {monster.rarity.charAt(0).toUpperCase() + monster.rarity.slice(1)}
          </Badge>
        </div>

        {/* Sat Amount */}
        <div className="flex items-center gap-1 text-primary font-display font-bold">
          <Zap className="w-4 h-4" />
          <span>{formatSats(monster.satAmount)} sats</span>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground text-center italic">{monster.description}</p>

        {/* Capture Button */}
        <Button
          onClick={handleCapture}
          disabled={!isInRange || !hasBalls || isCapturing || isCaptured}
          className={cn(
            'w-full mt-2 font-display',
            isInRange && hasBalls
              ? 'bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange'
              : ''
          )}
          variant={isInRange ? 'default' : 'secondary'}
        >
          <Target className="w-4 h-4 mr-2" />
          {!hasBalls
            ? 'No SatBalls'
            : !isInRange
              ? 'Get Closer'
              : isCapturing
                ? 'Catching...'
                : 'Capture!'}
        </Button>
      </CardContent>
    </Card>
  );
}
