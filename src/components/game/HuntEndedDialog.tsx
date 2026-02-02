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
import { Zap, Trophy, Target, Clock, Home } from 'lucide-react';
import confetti from 'canvas-confetti';

interface HuntEndedDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HuntEndedDialog({ open, onClose }: HuntEndedDialogProps) {
  const navigate = useNavigate();
  const { state, leaveHunt } = useGame();
  const { activeHunt, playerStats } = state;

  useEffect(() => {
    if (open) {
      // Celebration confetti
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#f97316', '#22c55e', '#a855f7'],
      });
    }
  }, [open]);

  const handleGoHome = () => {
    leaveHunt();
    onClose();
    navigate('/');
  };

  if (!activeHunt) return null;

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-sm bg-card/95 backdrop-blur border-primary/50 shadow-glow-orange"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideCloseButton
      >
        <DialogHeader>
          <DialogTitle className="sr-only">Hunt Ended</DialogTitle>
        </DialogHeader>

        <div className="text-center space-y-6 py-4">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              <Clock className="w-6 h-6 text-muted-foreground" />
              <h2 className="font-display text-2xl font-bold text-muted-foreground">
                TIME'S UP!
              </h2>
              <Clock className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-lg font-display text-primary">{activeHunt.name}</p>
            <p className="text-sm text-muted-foreground">
              The hunt has ended. Great job out there!
            </p>
          </div>

          {/* Stats Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-secondary/10 border border-secondary/30">
              <Target className="w-6 h-6 mx-auto text-secondary mb-2" />
              <p className="font-display text-3xl font-black text-secondary">
                {playerStats.currentHuntCaptured}
              </p>
              <p className="text-xs text-muted-foreground">Creatures Captured</p>
            </div>
            <div className="p-4 rounded-xl bg-primary/10 border border-primary/30">
              <Zap className="w-6 h-6 mx-auto text-primary mb-2" />
              <p className="font-display text-3xl font-black text-primary text-glow-orange">
                {formatSats(playerStats.currentHuntSatsEarned)}
              </p>
              <p className="text-xs text-muted-foreground">Sats Stacked</p>
            </div>
          </div>

          {/* Trophy message for good performance */}
          {playerStats.currentHuntCaptured > 0 && (
            <div className="flex items-center justify-center gap-2 text-yellow-400">
              <Trophy className="w-5 h-5" />
              <span className="text-sm font-medium">
                {playerStats.currentHuntCaptured >= 10
                  ? 'Amazing hunter!'
                  : playerStats.currentHuntCaptured >= 5
                  ? 'Great job!'
                  : 'Nice work!'}
              </span>
              <Trophy className="w-5 h-5" />
            </div>
          )}

          {/* Go Home Button */}
          <Button
            onClick={handleGoHome}
            className="w-full h-12 font-display text-lg bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange"
          >
            <Home className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
