import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MapPin, Navigation, AlertCircle, Info } from 'lucide-react';

interface LocationPermissionPromptProps {
  error: string | null;
  onRequestPermission: () => void;
}

export function LocationPermissionPrompt({ error, onRequestPermission }: LocationPermissionPromptProps) {
  const isPermissionDenied = error?.toLowerCase().includes('permission');
  const isHTTPSIssue = error?.toLowerCase().includes('https');

  return (
    <div className="space-y-4">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive" className="border-destructive/50">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Permission Card */}
      <Card className="bg-card/80 backdrop-blur border-primary/30">
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Navigation className="w-8 h-8 text-primary animate-pulse" />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg mb-1">Location Required</h3>
              <p className="text-sm text-muted-foreground">
                Sat Hunter needs your location to show nearby creatures and track your movement
              </p>
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
              <p className="text-muted-foreground">
                Your location is only used locally on your device to calculate distances
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 text-secondary flex-shrink-0" />
              <p className="text-muted-foreground">
                We never send your exact coordinates to any server
              </p>
            </div>
          </div>

          {/* HTTPS Issue */}
          {isHTTPSIssue && (
            <Alert className="border-yellow-500/50 bg-yellow-500/10">
              <AlertCircle className="w-4 h-4 text-yellow-500" />
              <AlertDescription className="text-yellow-500">
                Your browser requires a secure HTTPS connection for location services. Please access
                this site via HTTPS or use localhost for development.
              </AlertDescription>
            </Alert>
          )}

          {/* Permission Denied Instructions */}
          {isPermissionDenied && (
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <h4 className="font-medium text-sm">To enable location:</h4>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Click the lock icon (🔒) in your browser's address bar</li>
                <li>Find "Location" permissions</li>
                <li>Select "Allow" or "Ask"</li>
                <li>Refresh the page and try again</li>
              </ol>
            </div>
          )}

          {/* Request Button */}
          <Button
            onClick={onRequestPermission}
            className="w-full bg-gradient-to-r from-primary to-orange-600 hover:from-orange-600 hover:to-primary shadow-glow-orange"
          >
            <Navigation className="w-4 h-4 mr-2" />
            {isPermissionDenied ? 'Retry Location Access' : 'Enable Location'}
          </Button>

          {/* Fallback for development */}
          {!window.isSecureContext && window.location.hostname !== 'localhost' && (
            <p className="text-xs text-center text-muted-foreground">
              Development tip: Access via localhost or HTTPS to enable location services
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
