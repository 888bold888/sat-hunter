import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner, Html5QrcodeScanType } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { QrCode, Camera } from 'lucide-react';

interface QRScannerProps {
  onCodeScanned: (code: string) => void;
}

export function QRScanner({ onCodeScanned }: QRScannerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const qrCodeRegionId = 'qr-reader';
  const hasInitialized = useRef(false);

  // Extract hunt code from various QR formats
  const extractCode = (decodedText: string): string | null => {
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

    // Validate format
    if (/^[A-Z0-9]{6}$/i.test(code)) {
      return code.toUpperCase();
    }

    return null;
  };

  useEffect(() => {
    if (!isOpen) {
      // Cleanup when dialog closes
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
        scannerRef.current = null;
      }
      hasInitialized.current = false;
      return;
    }

    // Wait for DOM to be ready
    const initScanner = () => {
      const element = document.getElementById(qrCodeRegionId);
      if (!element || hasInitialized.current) {
        return;
      }

      hasInitialized.current = true;

      const scanner = new Html5QrcodeScanner(
        qrCodeRegionId,
        {
          fps: 10,
          qrbox: { width: 200, height: 200 },
          rememberLastUsedCamera: true,
          supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
          showTorchButtonIfSupported: true,
        },
        false // verbose
      );

      scannerRef.current = scanner;

      scanner.render(
        (decodedText) => {
          console.log('QR scanned:', decodedText);
          const code = extractCode(decodedText);
          if (code) {
            console.log('Valid code:', code);
            scanner.clear().then(() => {
              scannerRef.current = null;
              hasInitialized.current = false;
              setIsOpen(false);
              onCodeScanned(code);
            }).catch((err) => {
              console.error('Error clearing scanner:', err);
              setIsOpen(false);
              onCodeScanned(code);
            });
          }
        },
        (errorMessage) => {
          // Ignore scan errors - happens every frame without QR
          if (errorMessage.includes('No QR code found')) return;
          console.log('Scan error:', errorMessage);
        }
      );
    };

    // Small delay to ensure dialog content is rendered
    const timeoutId = setTimeout(initScanner, 100);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isOpen, onCodeScanned]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(console.error);
      }
    };
  }, []);

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
          {/* Scanner Region - html5-qrcode-scanner handles the UI */}
          <div
            id={qrCodeRegionId}
            className="w-full"
            style={{ minHeight: '300px' }}
          />

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
