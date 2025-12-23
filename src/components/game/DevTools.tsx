import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Code, MapPin, RefreshCw } from 'lucide-react';
import {
  isDevelopmentMode,
  isMockLocationEnabled,
  setMockLocationEnabled,
  getMockLocation,
  setMockLocation,
  DEFAULT_TEST_LOCATION,
} from '@/lib/devMode';

export function DevTools() {
  const mockLoc = getMockLocation() || DEFAULT_TEST_LOCATION;
  const [mockEnabled, setMockEnabled] = useState(isMockLocationEnabled());
  const [lat, setLat] = useState(mockLoc.lat.toString());
  const [lng, setLng] = useState(mockLoc.lng.toString());

  // Only render in development mode
  if (!isDevelopmentMode) return null;

  const handleToggleMock = (enabled: boolean) => {
    setMockLocationEnabled(enabled);
    setMockEnabled(enabled);
    if (enabled) {
      window.location.reload();
    }
  };

  const handleUpdateLocation = () => {
    const newLat = parseFloat(lat);
    const newLng = parseFloat(lng);
    
    if (!isNaN(newLat) && !isNaN(newLng)) {
      setMockLocation({ lat: newLat, lng: newLng });
      window.location.reload();
    }
  };

  const handleUseDefault = () => {
    setLat(DEFAULT_TEST_LOCATION.lat.toString());
    setLng(DEFAULT_TEST_LOCATION.lng.toString());
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="fixed bottom-4 right-4 z-50 bg-purple-500/20 border-purple-500/50 hover:bg-purple-500/30"
        >
          <Code className="w-4 h-4 mr-2" />
          Dev Tools
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md bg-card/95 backdrop-blur">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="w-5 h-5 text-purple-400" />
            Development Tools
            <Badge variant="outline" className="ml-auto text-purple-400 border-purple-500/50">
              DEV MODE
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <Card className="border-purple-500/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Mock Location
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="mock-enabled" className="text-sm">
                Use Mock Location
              </Label>
              <Switch
                id="mock-enabled"
                checked={mockEnabled}
                onCheckedChange={handleToggleMock}
              />
            </div>

            {mockEnabled && (
              <>
                {/* Latitude Input */}
                <div className="space-y-2">
                  <Label htmlFor="lat" className="text-xs">
                    Latitude
                  </Label>
                  <Input
                    id="lat"
                    type="number"
                    step="0.000001"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                {/* Longitude Input */}
                <div className="space-y-2">
                  <Label htmlFor="lng" className="text-xs">
                    Longitude
                  </Label>
                  <Input
                    id="lng"
                    type="number"
                    step="0.000001"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                {/* Buttons */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUseDefault}
                    className="flex-1"
                  >
                    Default (SF)
                  </Button>
                  <Button onClick={handleUpdateLocation} size="sm" className="flex-1">
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Update & Reload
                  </Button>
                </div>
              </>
            )}

            {/* Info */}
            <p className="text-xs text-muted-foreground">
              {mockEnabled
                ? 'Mock location is active. Page will reload when updated.'
                : 'Enable to test without GPS hardware. Useful for desktop development.'}
            </p>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
