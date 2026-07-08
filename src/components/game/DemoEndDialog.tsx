import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGame } from '@/contexts/GameContext';
import { formatSats } from '@/lib/gameUtils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Zap, Target, Sparkles, QrCode, Compass } from 'lucide-react';
import confetti from 'canvas-confetti';

interface DemoEndDialogProps {
  open: boolean;
  onClose: () => void;
}

export function DemoEndDialog({ open, onClose }: DemoEndDialogProps) {
  const navigate = useNavigate();
  const { state, leaveHunt } = useGame();
  const { activeHunt, playerStats } = state;

  useEffect(() => {
    if (open) {
      confetti({
        particleCount: 120,
        spread: 75,
        origin: { y: 0.6 },
        colors: ['#f97316', '#22c55e', '#a855f7', '#facc15'],
      });
    }
  }, [open]);

  if (!activeHunt) return null;

  // "Keep exploring" only makes sense while there's demo left to play — once the
  // field is cleared or the timer's up, the demo is genuinely over.
  const allCaptured =
    activeHunt.monsters.length > 0 && activeHunt.monsters.every((m) => m.captured);
  const timeExpired = Date.now() > activeHunt.endTime;
  const canKeepExploring = !allCaptured && !timeExpired;

  // Navigation CTAs must clear demo state first — leaveHunt() runs the demo cleanup
  // (no publish, no history, no NWC) before we route into the real login/join flow.
  const handleJoin = () => {
    leaveHunt();
    onClose();
    navigate('/join');
  };

  const handleHost = () => {
    leaveHunt();
    onClose();
    navigate('/play');
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm bg-card/95 backdrop-blur border-purple-500/50 shadow-glow-purple"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideCloseButton
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Demo Complete</DialogTitle>
        </DialogHeader>

        <div className="text-center space-y-6 py-4">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="w-6 h-6 text-purple-400" />
              <h2 className="font-display text-2xl font-bold text-purple-300">
                DEMO COMPLETE!
              </h2>
              <Sparkles className="w-6 h-6 text-purple-400" />
            </div>
            <p className="text-sm text-muted-foreground">
              You just felt the loop: walk, catch, stack. 🐾
            </p>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-secondary/10 border border-secondary/30">
              <Target className="w-6 h-6 mx-auto text-secondary mb-2" />
              <p className="font-display text-3xl font-black text-secondary">
                {playerStats.currentHuntCaptured}
              </p>
              <p className="text-xs text-muted-foreground">Creatures Caught</p>
            </div>
            <div className="p-4 rounded-xl bg-primary/10 border border-primary/30">
              <Zap className="w-6 h-6 mx-auto text-primary mb-2" />
              <p className="font-display text-3xl font-black text-primary text-glow-orange">
                {formatSats(playerStats.currentHuntSatsEarned)}
              </p>
              <p className="text-xs text-muted-foreground">Demo Sats</p>
            </div>
          </div>

          {/* The hook */}
          <p className="text-sm text-muted-foreground">
            In a <span className="text-primary font-medium">real hunt</span> these sats
            land in your Lightning wallet <span className="text-primary font-medium">instantly</span>.
          </p>

          {/* CTAs */}
          <div className="space-y-2">
            <Button
              onClick={handleJoin}
              className="w-full h-12 font-display text-lg bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange"
            >
              <QrCode className="w-5 h-5 mr-2" />
              Join a real hunt
            </Button>
            <Button
              onClick={handleHost}
              variant="outline"
              className="w-full h-11 font-display border-secondary/40 text-secondary hover:bg-secondary hover:text-secondary-foreground"
            >
              <Target className="w-5 h-5 mr-2" />
              Host your own hunt
            </Button>
            {canKeepExploring && (
              <Button
                onClick={onClose}
                variant="ghost"
                className="w-full h-10 text-muted-foreground"
              >
                <Compass className="w-4 h-4 mr-2" />
                Keep exploring
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
