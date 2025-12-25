import { useEffect, useRef, useState, useCallback } from 'react';
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
import { QrCode, Camera, AlertCircle, Loader2 } from 'lucide-react';

interface QRScannerProps {
  onCodeScanned: (code: string) => void;
}

export function QRScanner({ onCodeScanned }: QRScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const qrCodeRegionId = 'qr-reader';

  // Request camera permission explicitly (iOS Safari requires user gesture)
  const requestCameraPermission = useCallback(async () => {
    setIsRequesting(true);
    setError(null);

    try {
      // Request camera permission with a user gesture
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });

      // Stop the stream immediately - we just needed permission
      stream.getTracks().forEach(track => track.stop());

      setHasPermission(true);
      setIsRequesting(false);

      // Now start the scanner after a short delay to ensure DOM is ready
      setTimeout(() => {
        startScanner();
      }, 100);
    } catch (err) {
      console.error('Camera permission error:', err);
      setHasPermission(false);
      setIsRequesting(false);

      if (err instanceof Error) {
        if (err.name === 'NotAllowedError' || err.message.includes('Permission')) {
          setError('Camera permission denied. Please enable camera access in your browser settings and reload the page.');
        } else if (err.name === 'NotFoundError') {
          setError('No camera found on your device.');
        } else if (err.name === 'NotReadableError') {
          setError('Camera is already in use by another application.');
        } else if (err.name === 'OverconstrainedError') {
          setError('Could not find a suitable camera.');
        } else {
          setError(`Camera error: ${err.message}`);
        }
      } else {
        setError('Failed to access camera. Please try again.');
      }
    }
  }, []);

  const startScanner = async () => {
    // Ensure the DOM element exists
    const element = document.getElementById(qrCodeRegionId);
    if (!element) {
      console.error('QR reader element not found');
      setTimeout(startScanner, 100);
      return;
    }

    try {
      setError(null);
      setIsScanning(true);

      const html5QrCode = new Html5Qrcode(qrCodeRegionId);
      scannerRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          // iOS Safari specific settings
          aspectRatio: 1,
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
        () => {
          // Ignore scan errors (no QR code in frame)
        }
      );
    } catch (err) {
      console.error('QR Scanner error:', err);
      setIsScanning(false);

      if (err instanceof Error) {
        if (err.message.includes('NotAllowedError') || err.message.includes('Permission')) {
          setError('Camera permission denied. Please enable camera access in your browser settings.');
          setHasPermission(false);
        } else if (err.message.includes('NotFoundError')) {
          setError('No camera found on your device.');
        } else {
          setError('Failed to start camera. Please try again.');
        }
      }
    }
  };

  const stopScanner = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current = null;
          setIsScanning(false);
        })
        .catch((err) => {
          console.error('Error stopping scanner:', err);
          scannerRef.current = null;
          setIsScanning(false);
        });
    }
  }, []);

  // Cleanup on unmount or dialog close
  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      setHasPermission(null);
      setError(null);
    }
  }, [isOpen, stopScanner]);

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
              <div id={qrCodeRegionId} className="w-full min-h-[250px]" />

              {/* Show permission request button on iOS - requires user gesture */}
              {!isScanning && !error && hasPermission === null && (
                <div className="p-8 text-center bg-muted/30">
                  {isRequesting ? (
                    <>
                      <Loader2 className="w-12 h-12 mx-auto text-secondary mb-3 animate-spin" />
                      <p className="text-sm text-muted-foreground">Requesting camera access...</p>
                    </>
                  ) : (
                    <>
                      <Camera className="w-12 h-12 mx-auto text-secondary mb-3" />
                      <p className="text-sm text-muted-foreground mb-4">
                        Tap to enable camera access
                      </p>
                      <Button
                        onClick={requestCameraPermission}
                        className="bg-secondary hover:bg-secondary/90"
                      >
                        <Camera className="w-4 h-4 mr-2" />
                        Enable Camera
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Scanning indicator */}
              {isScanning && !error && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  {/* Scanner is active, html5-qrcode handles the video display */}
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

          {/* Retry button if permission was denied */}
          {hasPermission === false && (
            <Button
              onClick={requestCameraPermission}
              variant="outline"
              className="w-full"
            >
              <Camera className="w-4 h-4 mr-2" />
              Try Again
            </Button>
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
