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
  DialogDescription,
} from '@/components/ui/dialog';
import { QrCode, Camera, AlertCircle, Loader2 } from 'lucide-react';

interface QRScannerProps {
  onCodeScanned: (code: string) => void;
}

export function QRScanner({ onCodeScanned }: QRScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const qrCodeRegionId = 'qr-reader-region';

  // Extract hunt code from various QR formats
  const extractCode = useCallback((decodedText: string): string | null => {
    let code = decodedText.trim();

    // Try to extract from URL patterns
    const urlPatterns = [
      /\/join\/([A-Z0-9]{6})/i,
      /[?&]code=([A-Z0-9]{6})/i,
      /#([A-Z0-9]{6})$/i,
      /\/([A-Z0-9]{6})$/i,
    ];

    for (const pattern of urlPatterns) {
      const match = decodedText.match(pattern);
      if (match) {
        code = match[1];
        break;
      }
    }

    // Clean up - remove non-alphanumeric
    code = code.replace(/[^A-Z0-9]/gi, '');

    // If longer than 6, take last 6
    if (code.length > 6) {
      code = code.slice(-6);
    }

    // Validate format (6 alphanumeric characters)
    if (/^[A-Z0-9]{6}$/i.test(code)) {
      return code.toUpperCase();
    }

    return null;
  }, []);

  // Stop and cleanup scanner
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === 2) { // Html5QrcodeScannerState.SCANNING
          await scannerRef.current.stop();
        }
      } catch (err) {
        console.error('Error stopping scanner:', err);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
    setIsStarting(false);
  }, []);

  // Start the scanner
  const startScanner = useCallback(async () => {
    // Ensure DOM element exists
    const element = document.getElementById(qrCodeRegionId);
    if (!element) {
      console.error('QR reader element not found');
      setError('Scanner initialization failed. Please try again.');
      return;
    }

    // Don't start if already running
    if (scannerRef.current) {
      return;
    }

    setIsStarting(true);
    setError(null);

    try {
      const html5Qrcode = new Html5Qrcode(qrCodeRegionId);
      scannerRef.current = html5Qrcode;

      // Calculate qrbox size based on container
      const containerWidth = element.clientWidth || 280;
      const qrboxSize = Math.min(containerWidth - 40, 250);

      await html5Qrcode.start(
        { facingMode: 'environment' }, // Back camera only
        {
          fps: 10,
          qrbox: { width: qrboxSize, height: qrboxSize },
        },
        (decodedText) => {
          console.log('QR Code detected:', decodedText);
          const code = extractCode(decodedText);

          if (code) {
            console.log('Valid hunt code found:', code);
            // Stop scanner and close dialog
            html5Qrcode.stop().then(() => {
              scannerRef.current = null;
              setIsScanning(false);
              setIsOpen(false);
              onCodeScanned(code);
            }).catch((err) => {
              console.error('Error stopping after scan:', err);
              scannerRef.current = null;
              setIsScanning(false);
              setIsOpen(false);
              onCodeScanned(code);
            });
          }
        },
        // Error callback - called on every frame without a QR code
        () => {
          // Silently ignore - this is normal behavior
        }
      );

      setIsScanning(true);
      setIsStarting(false);
      console.log('Scanner started successfully');
    } catch (err) {
      console.error('Failed to start scanner:', err);
      scannerRef.current = null;
      setIsStarting(false);

      if (err instanceof Error) {
        if (err.message.includes('Permission') || err.name === 'NotAllowedError') {
          setError('Camera permission denied. Please allow camera access and try again.');
        } else if (err.message.includes('NotFound') || err.name === 'NotFoundError') {
          setError('No camera found on your device.');
        } else if (err.message.includes('NotReadable') || err.name === 'NotReadableError') {
          setError('Camera is in use by another app. Please close other apps using the camera.');
        } else {
          setError(`Camera error: ${err.message}`);
        }
      } else {
        setError('Failed to start camera. Please try again.');
      }
    }
  }, [extractCode, onCodeScanned]);

  // Handle dialog open/close
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
      const timeoutId = setTimeout(() => {
        startScanner();
      }, 200);
      return () => clearTimeout(timeoutId);
    } else {
      stopScanner();
      setError(null);
    }
  }, [isOpen, startScanner, stopScanner]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

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
          <DialogDescription className="text-xs text-muted-foreground">
            Point your camera at the QR code to join the hunt
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Scanner Region */}
          <Card className="border-secondary/30 overflow-hidden">
            <CardContent className="p-0 relative" ref={containerRef}>
              {/* Camera preview container */}
              <div
                id={qrCodeRegionId}
                className="w-full bg-black"
                style={{ minHeight: '280px' }}
              />

              {/* Loading overlay */}
              {isStarting && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted/80">
                  <Loader2 className="w-10 h-10 text-secondary animate-spin mb-2" />
                  <p className="text-sm text-muted-foreground">Starting camera...</p>
                </div>
              )}

              {/* Scanning indicator */}
              {isScanning && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-secondary/90 text-secondary-foreground px-3 py-1 rounded-full text-xs font-medium">
                  Scanning...
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error Message */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription className="text-sm">{error}</AlertDescription>
            </Alert>
          )}

          {/* Retry button if error */}
          {error && (
            <Button
              onClick={() => {
                setError(null);
                startScanner();
              }}
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
              Position the QR code within the frame. It will be detected automatically.
            </AlertDescription>
          </Alert>

          {/* Manual Entry Option */}
          <p className="text-xs text-center text-muted-foreground">
            Or close this and manually enter the 6-character code
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
