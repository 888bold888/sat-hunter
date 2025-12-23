import { useEffect, useState } from 'react';
import type { Monster } from '@/lib/gameTypes';
import { formatSats, getRarityColor, getRarityBgColor } from '@/lib/gameUtils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Sparkles, PartyPopper, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import confetti from 'canvas-confetti';

interface CaptureSuccessDialogProps {
  monster: Monster | null;
  open: boolean;
  onClose: () => void;
}

export function CaptureSuccessDialog({ monster, open, onClose }: CaptureSuccessDialogProps) {
  const [, setShowConfetti] = useState(false);

  useEffect(() => {
    if (open && monster) {
      setShowConfetti(true);

      // Trigger confetti for legendary+ captures
      if (monster.rarity === 'legendary' || monster.rarity === 'mythic') {
        const duration = 3000;
        const end = Date.now() + duration;

        const frame = () => {
          confetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#f97316', '#22c55e', '#a855f7', '#facc15'],
          });
          confetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#f97316', '#22c55e', '#a855f7', '#facc15'],
          });

          if (Date.now() < end) {
            requestAnimationFrame(frame);
          }
        };

        frame();
      } else {
        // Simple confetti for regular captures
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#f97316', '#22c55e'],
        });
      }
    }
  }, [open, monster]);

  if (!monster) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-card/95 backdrop-blur border-primary/50 shadow-glow-orange">
        <DialogHeader>
          <DialogTitle className="sr-only">Creature Captured!</DialogTitle>
        </DialogHeader>

        <div className="text-center space-y-6 py-4">
          {/* Success Header */}
          <div className="flex items-center justify-center gap-2 text-primary">
            <PartyPopper className="w-6 h-6" />
            <h2 className="font-display text-2xl font-bold">CAUGHT!</h2>
            <PartyPopper className="w-6 h-6 scale-x-[-1]" />
          </div>

          {/* Monster Visual */}
          <div className="relative">
            <div
              className={cn(
                'w-32 h-32 mx-auto rounded-full flex items-center justify-center',
                'bg-gradient-to-br from-card to-muted border-4',
                getRarityBgColor(monster.rarity),
                monster.rarity === 'mythic' && 'animate-glow-pulse',
                monster.rarity === 'legendary' && 'shadow-glow-purple'
              )}
            >
              <span className="text-6xl animate-bounce">{monster.emoji}</span>
            </div>

            {/* Sparkles for rare+ */}
            {['rare', 'legendary', 'mythic'].includes(monster.rarity) && (
              <>
                <Sparkles className="absolute top-0 right-8 w-6 h-6 text-yellow-400 animate-pulse" />
                <Sparkles className="absolute bottom-0 left-8 w-5 h-5 text-yellow-400 animate-pulse delay-300" />
              </>
            )}

            {/* Checkmark */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-secondary flex items-center justify-center border-2 border-background">
              <Check className="w-5 h-5 text-white" />
            </div>
          </div>

          {/* Monster Info */}
          <div className="space-y-2">
            <h3 className={cn('font-display text-xl font-bold', getRarityColor(monster.rarity))}>
              {monster.name}
            </h3>
            <Badge variant="outline" className={cn(getRarityColor(monster.rarity))}>
              {monster.rarity.charAt(0).toUpperCase() + monster.rarity.slice(1)}
            </Badge>
            <p className="text-sm text-muted-foreground italic">{monster.description}</p>
          </div>

          {/* Sats Earned */}
          <div className="p-4 rounded-xl bg-primary/10 border border-primary/30">
            <div className="flex items-center justify-center gap-2">
              <Zap className="w-8 h-8 text-primary" />
              <span className="font-display text-4xl font-black text-primary text-glow-orange">
                +{formatSats(monster.satAmount)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">satoshis earned!</p>
          </div>

          {/* Continue Button */}
          <Button
            onClick={onClose}
            className="w-full h-12 font-display text-lg bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange"
          >
            Keep Hunting!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
