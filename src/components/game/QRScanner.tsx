import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { QrCode, X, Camera, AlertCircle } from 'lucide-react';

interface QRScannerProps {
  onCodeScanned: (code: string) => void;
}

export function QRScanner({ onCodeScanned }: QRScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const qrCodeRegionId = 'qr-reader';

  const startScanner = async () => {
    try {
      setError(null);
      setIsScanning(true);

      const html5QrCode = new Html5Qrcode(qrCodeRegionId);
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' }, // Use back camera
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText) => {
          // Extract code from URL if it's a full URL
          let code = decodedText;
          const urlMatch = decodedText.match(/\/join\/([A-Z0-9]{6})/i);
          if (urlMatch) {
            code = urlMatch[1];
          }
          
          // Validate code format (6 alphanumeric characters)
          if (/^[A-Z0-9]{6}$/i.test(code)) {
            onCodeScanned(code.toUpperCase());
            stopScanner();
            setIsOpen(false);
          }
        },
        (errorMessage) => {
          // Ignore scan errors (no QR code in frame)
        }
      );
    } catch (err) {
      console.error('QR Scanner error:', err);
      setError(
        err instanceof Error && err.message.includes('NotAllowedError')
          ? 'Camera permission denied. Please enable camera access in your browser settings.'
          : err instanceof Error && err.message.includes('NotFoundError')
            ? 'No camera found on your device.'
            : 'Failed to start camera. Please try again.'
      );
      setIsScanning(false);
    }
  };

  const stopScanner = () => {
    if (scannerRef.current) {
      scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current = null;
          setIsScanning(false);
        })
        .catch((err) => {
          console.error('Error stopping scanner:', err);
          setIsScanning(false);
        });
    }
  };

  // Cleanup on unmount or dialog close
  useEffect(() => {
    if (!isOpen) {
      stopScanner();
    }
  }, [isOpen]);

  // Start scanning when dialog opens
  useEffect(() => {
    if (isOpen && !isScanning && !scannerRef.current) {
      startScanner();
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full h-12 border-secondary/50 hover:bg-secondary/10 hover:border-secondary"
        >
          <Camera className="w-5 h-5 mr-2" />
          Scan QR Code
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm bg-card/95 backdrop-blur border-secondary/30">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <QrCode className="w-5 h-5 text-secondary" />
            Scan Hunt QR Code
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scanner Region */}
          <Card className="border-secondary/30 overflow-hidden">
            <CardContent className="p-0">
              <div id={qrCodeRegionId} className="w-full" />
              {!isScanning && !error && (
                <div className="p-8 text-center bg-muted/30">
                  <Camera className="w-12 h-12 mx-auto text-muted-foreground mb-2 animate-pulse" />
                  <p className="text-sm text-muted-foreground">Starting camera...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Instructions */}
          <Alert className="border-secondary/30 bg-secondary/5">
            <QrCode className="w-4 h-4 text-secondary" />
            <AlertDescription className="text-xs">
              Point your camera at a hunt QR code. The code will be detected automatically.
            </AlertDescription>
          </Alert>

          {/* Manual Entry Option */}
          <p className="text-xs text-center text-muted-foreground">
            Or manually enter the 6-character code below
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
