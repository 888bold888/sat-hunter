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

  // Define stopScanner FIRST since startScanner depends on it
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

  const startScanner = useCallback(async () => {
    // Ensure the DOM element exists
    const element = document.getElementById(qrCodeRegionId);
    if (!element) {
      console.error('QR reader element not found, retrying...');
      setTimeout(startScanner, 100);
      return;
    }

    // If scanner is already running, don't start again
    if (scannerRef.current) {
      console.log('Scanner already running');
      return;
    }

    try {
      setError(null);
      setIsScanning(true);

      const html5QrCode = new Html5Qrcode(qrCodeRegionId, { verbose: false });
      scannerRef.current = html5QrCode;

      // Try to get cameras, but don't fail if we can't
      let cameraConfig: { facingMode: string } | { deviceId: string } = { facingMode: 'environment' };

      try {
        const cameras = await Html5Qrcode.getCameras();
        console.log('Available cameras:', cameras);

        if (cameras.length > 0) {
          // Prefer back/rear camera
          const backCamera = cameras.find(c =>
            c.label.toLowerCase().includes('back') ||
            c.label.toLowerCase().includes('rear') ||
            c.label.toLowerCase().includes('environment')
          );
          if (backCamera) {
            cameraConfig = { deviceId: backCamera.id };
          } else {
            cameraConfig = { deviceId: cameras[0].id };
          }
        }
      } catch (camErr) {
        console.log('Could not enumerate cameras, using facingMode:', camErr);
      }

      console.log('Starting scanner with config:', cameraConfig);

      await html5QrCode.start(
        cameraConfig,
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          console.log('QR Code scanned:', decodedText);

          // Extract code from various formats
          let code = decodedText.trim();

          // Try to extract from URL patterns
          // Matches: /join/CODE, ?code=CODE, #CODE, or just CODE at end of URL
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

          // Clean up the code - remove any non-alphanumeric characters
          code = code.replace(/[^A-Z0-9]/gi, '');

          // If code is longer than 6 chars, try to find a 6-char sequence
          if (code.length > 6) {
            // Take the last 6 characters (most likely to be the code)
            code = code.slice(-6);
          }

          console.log('Extracted code:', code);

          // Validate code format (6 alphanumeric characters)
          if (/^[A-Z0-9]{6}$/i.test(code)) {
            console.log('Valid code found, closing scanner');
            // Stop scanner first, then close dialog, then notify parent
            html5QrCode.stop().then(() => {
              scannerRef.current = null;
              setIsScanning(false);
              setIsOpen(false);
              onCodeScanned(code.toUpperCase());
            }).catch((err) => {
              console.error('Error stopping scanner:', err);
              scannerRef.current = null;
              setIsScanning(false);
              setIsOpen(false);
              onCodeScanned(code.toUpperCase());
            });
          } else {
            console.log('Invalid code format:', code);
          }
        },
        () => {
          // Silently ignore scan errors - this happens every frame without a QR
        }
      );

      console.log('Scanner started successfully');
    } catch (err) {
      console.error('QR Scanner error:', err);
      setIsScanning(false);
      scannerRef.current = null;

      if (err instanceof Error) {
        if (err.message.includes('NotAllowedError') || err.message.includes('Permission')) {
          setError('Camera permission denied. Please enable camera access in your browser settings.');
          setHasPermission(false);
        } else if (err.message.includes('NotFoundError')) {
          setError('No camera found on your device.');
        } else {
          setError(`Failed to start camera: ${err.message}`);
        }
      }
    }
  }, [onCodeScanned]);

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
  }, [startScanner]);

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
