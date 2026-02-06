import { useState } from 'react';
import { useGame } from '@/contexts/GameContext';
import { usePublishHunt } from '@/hooks/usePublishHunt';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { formatSats } from '@/lib/gameUtils';
import type { NostrEvent } from '@nostrify/nostrify';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Zap,
  Wallet,
  Loader2,
  AlertCircle,
} from 'lucide-react';

export function PaymentConfirmation() {
  const { state, confirmPayment, updateHuntId } = useGame();
  const { activeHunt } = state;
  const { mutateAsync: publishHunt } = usePublishHunt();
  const wallet = useWallet();
  const { getActiveConnection } = useNWC();
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  if (!activeHunt || activeHunt.paymentStatus === 'paid') return null;

  // Activate hunt with connected wallet (verifies wallet connection)
  const handleActivateWithWallet = async () => {
    const connection = getActiveConnection();
    if (!connection) {
      setPaymentError('No wallet connected. Please connect NWC in settings.');
      return;
    }
    setIsPaying(true);
    setPaymentError(null);

    try {
      // Update hunt status first, then publish with updated status
      confirmPayment();

      // Get the updated hunt with paid status for publishing
      // Check if hunt is scheduled for the future
      const isScheduled = activeHunt.startTime > Date.now();
      const huntStatus = isScheduled ? 'ready' : 'active';

      const paidHunt = {
        ...activeHunt,
        status: huntStatus as 'ready' | 'active',
        paymentStatus: 'paid' as const,
      };
      const signedEvent = await publishHunt(paidHunt) as NostrEvent;
      // Critical: Update local hunt ID to match Nostr event ID for sync
      // Pass status to avoid race condition with confirmPayment
      if (signedEvent?.id) {
        updateHuntId(signedEvent.id, { status: huntStatus, paymentStatus: 'paid' });
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Payment failed');
      setIsPaying(false);
    }
  };

  // Demo mode: skip payment and activate hunt
  const handleSkipPayment = async () => {
    setIsPaying(true);
    setPaymentError(null);

    try {
      // Update hunt status first
      confirmPayment();

      // Publish with updated status
      // Check if hunt is scheduled for the future
      const isScheduled = activeHunt.startTime > Date.now();
      const huntStatus = isScheduled ? 'ready' : 'active';

      const paidHunt = {
        ...activeHunt,
        status: huntStatus as 'ready' | 'active',
        paymentStatus: 'paid' as const,
      };
      const signedEvent = await publishHunt(paidHunt) as NostrEvent;
      // Critical: Update local hunt ID to match Nostr event ID for sync
      // Pass status to avoid race condition with confirmPayment
      if (signedEvent?.id) {
        updateHuntId(signedEvent.id, { status: huntStatus, paymentStatus: 'paid' });
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Failed to activate hunt');
      setIsPaying(false);
    }
  };

  return (
    <Card className="border-primary/30 shadow-glow-orange">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <Wallet className="w-5 h-5 text-primary" />
          Activate Hunt
        </CardTitle>
        <CardDescription>
          Connect your NWC wallet to pay players when they capture creatures.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Payment Amount */}
        <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Zap className="w-8 h-8 text-primary" />
            <span className="font-display text-4xl font-black text-primary text-glow-orange">
              {formatSats(activeHunt.totalSats)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">satoshis to deploy</p>
        </div>
        <Separator />

        {/* Payment Options */}
        <div className="space-y-3">
          {/* NWC Payment */}
          {wallet.hasNWC ? (
            <Button
              onClick={handleActivateWithWallet}
              disabled={isPaying}
              className="w-full h-12 bg-gradient-to-r from-secondary to-green-600 hover:from-green-600 hover:to-secondary shadow-glow-green"
            >
              {isPaying ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Activating Hunt...
                </>
              ) : (
                <>
                  <Wallet className="w-5 h-5 mr-2" />
                  Activate with Connected Wallet
                </>
              )}
            </Button>
          ) : (
            <Alert className="border-blue-500/30 bg-blue-500/5">
              <Wallet className="w-4 h-4 text-blue-500" />
              <AlertDescription className="text-sm">
                <strong>NWC wallet required.</strong> Connect your Nostr Wallet Connect (NWC) in settings to pay players automatically when they capture creatures.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Error */}
        {paymentError && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{paymentError}</AlertDescription>
          </Alert>
        )}

        {/* Demo/Skip Payment - Only visible in development */}
        {import.meta.env.DEV && (
          <>
            <Separator />
            <Button
              onClick={handleSkipPayment}
              variant="outline"
              className="w-full border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
              disabled={isPaying}
            >
              {isPaying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Activating...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Activate Hunt (Demo Mode - No Payments)
                </>
              )}
            </Button>
          </>
        )}

        {/* Info */}
        <Alert className="border-primary/30 bg-primary/5">
          <Zap className="w-4 h-4 text-primary" />
          <AlertDescription className="text-xs">
            When players capture creatures, your connected wallet will automatically pay them the reward sats via their Lightning address.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
