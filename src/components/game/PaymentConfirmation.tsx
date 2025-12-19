import { useState, useEffect } from 'react';
import { useGame } from '@/contexts/GameContext';
import { usePublishHunt } from '@/hooks/usePublishHunt';
import { useWallet } from '@/hooks/useWallet';
import { useNWC } from '@/hooks/useNWCContext';
import { formatSats } from '@/lib/gameUtils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Zap,
  Wallet,
  CheckCircle,
  Loader2,
  AlertCircle,
  ExternalLink,
  QrCode,
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import QRCodeLib from 'qrcode';

export function PaymentConfirmation() {
  const { state, confirmPayment } = useGame();
  const { activeHunt } = state;
  const { mutate: publishHunt, isPending: isPublishing } = usePublishHunt();
  const wallet = useWallet();
  const { sendPayment, getActiveConnection } = useNWC();

  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'paying' | 'paid' | 'failed'>('idle');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [invoiceQR, setInvoiceQR] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Generate mock invoice for demo (in production, this would come from a Lightning service)
  const mockInvoice = activeHunt
    ? `lnbc${activeHunt.totalSats}n1p...` // Truncated for display
    : '';

  // Generate QR code for invoice
  useEffect(() => {
    if (mockInvoice) {
      QRCodeLib.toDataURL(mockInvoice, {
        width: 256,
        margin: 2,
        color: { dark: '#f97316', light: '#ffffff' },
      }).then(setInvoiceQR);
    }
  }, [mockInvoice]);

  if (!activeHunt || activeHunt.paymentStatus === 'paid') return null;

  const handlePayWithNWC = async () => {
    const connection = getActiveConnection();
    if (!connection) {
      setPaymentError('No wallet connected. Please connect NWC in settings.');
      return;
    }

    setPaymentStatus('paying');
    setPaymentError(null);

    try {
      // In production, use the actual invoice
      // await sendPayment(connection, activeHunt.lightningInvoice!);
      
      // For demo, simulate payment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setPaymentStatus('paid');
      
      // Confirm payment in game state
      confirmPayment();
      
      // Publish hunt to Nostr
      publishHunt(activeHunt);
    } catch (error) {
      setPaymentStatus('failed');
      setPaymentError(error instanceof Error ? error.message : 'Payment failed');
    }
  };

  const handleSkipPayment = () => {
    // For development/testing - skip payment
    setPaymentStatus('paid');
    confirmPayment();
    publishHunt(activeHunt);
  };

  const handleCopyInvoice = () => {
    navigator.clipboard.writeText(mockInvoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (paymentStatus === 'paid') {
    return (
      <Card className="border-secondary/30 bg-secondary/10">
        <CardContent className="p-6 text-center space-y-4">
          <CheckCircle className="w-16 h-16 mx-auto text-secondary" />
          <div>
            <h3 className="font-display font-bold text-lg text-secondary">Payment Confirmed!</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Your hunt has been published to Nostr
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 shadow-glow-orange">
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <Wallet className="w-5 h-5 text-primary" />
          Confirm Payment
        </CardTitle>
        <CardDescription>
          Pay {formatSats(activeHunt.totalSats)} sats to activate your hunt
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
          <h4 className="font-display font-semibold text-sm">Payment Method</h4>

          {/* NWC Payment */}
          {wallet.hasNWC && (
            <Button
              onClick={handlePayWithNWC}
              disabled={paymentStatus === 'paying'}
              className="w-full h-12 bg-gradient-to-r from-secondary to-green-600 hover:from-green-600 hover:to-secondary shadow-glow-green"
            >
              {paymentStatus === 'paying' ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Processing Payment...
                </>
              ) : (
                <>
                  <Wallet className="w-5 h-5 mr-2" />
                  Pay with Connected Wallet
                </>
              )}
            </Button>
          )}

          {/* Manual Payment */}
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-4 space-y-3">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-2">Lightning Invoice</p>
                {invoiceQR && (
                  <img src={invoiceQR} alt="Payment Invoice" className="w-48 h-48 mx-auto rounded-lg bg-white p-2" />
                )}
              </div>
              
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-background/50 px-2 py-1 rounded font-mono truncate">
                  {mockInvoice}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyInvoice}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              
              <p className="text-xs text-muted-foreground text-center">
                Scan QR or copy invoice to pay from any Lightning wallet
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Error */}
        {paymentError && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{paymentError}</AlertDescription>
          </Alert>
        )}

        {/* Dev: Skip Payment */}
        {import.meta.env.DEV && (
          <>
            <Separator />
            <Button
              onClick={handleSkipPayment}
              variant="outline"
              className="w-full border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
            >
              [DEV] Skip Payment
            </Button>
          </>
        )}

        {/* Info */}
        <Alert className="border-primary/30 bg-primary/5">
          <Zap className="w-4 h-4 text-primary" />
          <AlertDescription className="text-xs">
            Your hunt will be published to Nostr and activated once payment is confirmed.
            Players can join using your share code.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
