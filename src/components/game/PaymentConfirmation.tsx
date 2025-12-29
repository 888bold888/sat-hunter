import { useState, useEffect } from 'react';
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
import { Input } from '@/components/ui/input';
import {
  Zap,
  Wallet,
  Loader2,
  AlertCircle,
  QrCode,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import QRCode from 'qrcode';

// Demo invoice prefix - in production this would come from a real Lightning service
const DEMO_INVOICE_PREFIX = 'lnbc';

export function PaymentConfirmation() {
  const { state, confirmPayment, updateHuntId } = useGame();
  const { activeHunt } = state;
  const { mutateAsync: publishHunt } = usePublishHunt();
  const wallet = useWallet();
  const { getActiveConnection } = useNWC();
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);

  // Generate demo invoice when requested
  useEffect(() => {
    if (!showInvoice || !activeHunt) return;

    const generateDemoInvoice = async () => {
      setIsGeneratingInvoice(true);

      // Create a demo invoice string (in production, this would come from a Lightning service)
      // Format: lnbc[amount][multiplier]...
      const amountInSats = activeHunt.totalSats;
      const timestamp = Math.floor(Date.now() / 1000);
      const randomSuffix = Math.random().toString(36).substring(2, 15);

      // This is a demo invoice format - not a real BOLT11 invoice
      // In production, you'd call your Lightning service API to get a real invoice
      const demoInvoice = `${DEMO_INVOICE_PREFIX}${amountInSats}n1p${timestamp}${randomSuffix}`;

      setInvoice(demoInvoice);

      // Generate QR code
      try {
        const url = await QRCode.toDataURL(demoInvoice.toUpperCase(), {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        setQrCodeUrl(url);
      } catch (err) {
        console.error('Failed to generate QR code:', err);
      }

      setIsGeneratingInvoice(false);
    };

    generateDemoInvoice();
  }, [showInvoice, activeHunt]);

  if (!activeHunt || activeHunt.paymentStatus === 'paid') return null;

  // Copy invoice to clipboard
  const handleCopy = async () => {
    if (invoice) {
      await navigator.clipboard.writeText(invoice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Open in external Lightning wallet
  const openInWallet = () => {
    if (invoice) {
      window.open(`lightning:${invoice}`, '_blank');
    }
  };

  // Handle "I've Paid" confirmation for invoice payment
  const handleInvoicePaid = async () => {
    setIsPaying(true);
    setPaymentError(null);

    try {
      confirmPayment();

      const paidHunt = {
        ...activeHunt,
        status: 'ready' as const,
        paymentStatus: 'paid' as const,
      };
      const signedEvent = await publishHunt(paidHunt) as NostrEvent;
      // Critical: Update local hunt ID to match Nostr event ID for sync
      if (signedEvent?.id) {
        updateHuntId(signedEvent.id);
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Failed to activate hunt');
      setIsPaying(false);
    }
  };

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
      // For now, just activate the hunt since there's no payment backend
      // In production, this would send sats to an escrow/custodian
      await new Promise(resolve => setTimeout(resolve, 500));

      // Update hunt status first, then publish with updated status
      confirmPayment();

      // Get the updated hunt with paid status for publishing
      const paidHunt = {
        ...activeHunt,
        status: 'ready' as const,
        paymentStatus: 'paid' as const,
      };
      const signedEvent = await publishHunt(paidHunt) as NostrEvent;
      // Critical: Update local hunt ID to match Nostr event ID for sync
      if (signedEvent?.id) {
        updateHuntId(signedEvent.id);
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
      const paidHunt = {
        ...activeHunt,
        status: 'ready' as const,
        paymentStatus: 'paid' as const,
      };
      const signedEvent = await publishHunt(paidHunt) as NostrEvent;
      // Critical: Update local hunt ID to match Nostr event ID for sync
      if (signedEvent?.id) {
        updateHuntId(signedEvent.id);
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
          Confirm Payment
        </CardTitle>
        <CardDescription>
          Pay {formatSats(activeHunt.totalSats)} sats to activate your hunt. Sats will be split into creature invoices based on rarity.
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

          {/* Lightning Invoice QR Code */}
          {showInvoice ? (
            <div className="space-y-4">
              {/* QR Code Display */}
              <div className="flex justify-center">
                <Card className="p-3 bg-white">
                  <CardContent className="p-0">
                    {isGeneratingInvoice ? (
                      <div className="w-[200px] h-[200px] flex items-center justify-center">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    ) : qrCodeUrl ? (
                      <img
                        src={qrCodeUrl}
                        alt="Lightning Invoice QR Code"
                        className="w-[200px] h-[200px]"
                      />
                    ) : (
                      <div className="w-[200px] h-[200px] bg-muted animate-pulse rounded" />
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Invoice String */}
              {invoice && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={invoice}
                      readOnly
                      className="font-mono text-xs"
                      onClick={(e) => e.currentTarget.select()}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopy}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {/* Open in Wallet */}
                  <Button
                    variant="outline"
                    onClick={openInWallet}
                    className="w-full"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Open in Lightning Wallet
                  </Button>

                  {/* Confirm Payment */}
                  <Button
                    onClick={handleInvoicePaid}
                    disabled={isPaying}
                    className="w-full h-12 bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange"
                  >
                    {isPaying ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Activating Hunt...
                      </>
                    ) : (
                      <>
                        <Check className="w-5 h-5 mr-2" />
                        I've Paid - Activate Hunt
                      </>
                    )}
                  </Button>

                  {/* Back button */}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowInvoice(false);
                      setInvoice(null);
                      setQrCodeUrl('');
                    }}
                    className="w-full"
                  >
                    ← Back to payment options
                  </Button>
                </div>
              )}

              <Alert className="border-yellow-500/30 bg-yellow-500/5">
                <AlertCircle className="w-4 h-4 text-yellow-500" />
                <AlertDescription className="text-xs">
                  Demo Mode: This is a simulated invoice. In production, this would be a real Lightning invoice from the escrow service.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <>
              {/* Lightning Invoice Option */}
              <Button
                onClick={() => setShowInvoice(true)}
                variant="outline"
                className="w-full h-12 border-primary/50 hover:bg-primary/10"
              >
                <QrCode className="w-5 h-5 mr-2" />
                Pay with Lightning Invoice (QR Code)
              </Button>

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
                      Processing Payment...
                    </>
                  ) : (
                    <>
                      <Wallet className="w-5 h-5 mr-2" />
                      Pay with Connected Wallet (NWC)
                    </>
                  )}
                </Button>
              ) : (
                <Alert className="border-blue-500/30 bg-blue-500/5">
                  <Wallet className="w-4 h-4 text-blue-500" />
                  <AlertDescription className="text-xs">
                    Connect NWC in settings for one-click wallet payments.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </div>

        {/* Error */}
        {paymentError && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{paymentError}</AlertDescription>
          </Alert>
        )}

        {/* Demo/Skip Payment - always available for now */}
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
              Activate Hunt (Demo Mode)
            </>
          )}
        </Button>

        {/* Info */}
        <Alert className="border-primary/30 bg-primary/5">
          <Zap className="w-4 h-4 text-primary" />
          <AlertDescription className="text-xs">
            Your hunt will be published to Nostr and activated only after payment confirmation. Unclaimed creature sats refund to you at end.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
