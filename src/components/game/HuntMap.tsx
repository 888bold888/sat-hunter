import { useEffect, useRef, useCallback } from 'react';
import type { Monster, SatStop, GeoLocation, BoundaryType } from '@/lib/gameTypes';
import { calculateDistance, formatSats } from '@/lib/gameUtils';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';

// Helper to safely check if map is ready for operations
function isMapReady(map: L.Map | null): map is L.Map {
  if (!map) return false;
  try {
    // Check if map container exists and map is initialized
    return !!(map.getContainer() && map.getSize().x > 0);
  } catch {
    return false;
  }
}

// Fix Leaflet default marker icons - uses delete on prototype which requires type assertion
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

interface HuntMapProps {
  center: GeoLocation;
  radiusMeters: number;
  playerLocation: GeoLocation | null;
  monsters: Monster[];
  satStops: SatStop[];
  onMonsterClick?: (monster: Monster) => void;
  onStopClick?: (stop: SatStop) => void;
  showAllMonsters?: boolean;
  className?: string;
  boundaryType?: BoundaryType;
  polygon?: GeoLocation[];
}

export function HuntMap({
  center,
  radiusMeters,
  playerLocation,
  monsters,
  satStops,
  onMonsterClick,
  onStopClick,
  showAllMonsters = false,
  className,
  boundaryType = 'circle',
  polygon,
}: HuntMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const circlesRef = useRef<L.Circle[]>([]);
  const polygonsRef = useRef<L.Polygon[]>([]);
  const isMountedRef = useRef(true);
  const initialCenterRef = useRef(center);
  const updateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track currently visible monster IDs for hysteresis (prevent GPS jitter flickering)
  const visibleMonsterIdsRef = useRef<Set<string>>(new Set());

  // Cleanup function for markers, circles, and polygons
  const clearMapLayers = useCallback(() => {
    markersRef.current.forEach(marker => {
      try { marker.remove(); } catch { /* ignore */ }
    });
    circlesRef.current.forEach(circle => {
      try { circle.remove(); } catch { /* ignore */ }
    });
    polygonsRef.current.forEach(poly => {
      try { poly.remove(); } catch { /* ignore */ }
    });
    markersRef.current = [];
    circlesRef.current = [];
    polygonsRef.current = [];
  }, []);

  // Memoize stable references for callbacks to prevent unnecessary re-renders
  const onMonsterClickRef = useRef(onMonsterClick);
  const onStopClickRef = useRef(onStopClick);
  onMonsterClickRef.current = onMonsterClick;
  onStopClickRef.current = onStopClick;

  // Initialize map once on mount
  useEffect(() => {
    if (!mapRef.current) return;

    // Already initialized
    if (mapInstanceRef.current) return;

    isMountedRef.current = true;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
    }).setView([initialCenterRef.current.lat, initialCenterRef.current.lng], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      isMountedRef.current = false;
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
      clearMapLayers();
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch { /* ignore cleanup errors */ }
        mapInstanceRef.current = null;
      }
    };
  }, [clearMapLayers]);

  // Update markers with debouncing to prevent race conditions during zoom
  useEffect(() => {
    // Cancel any pending updates
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }

    // Debounce the update to avoid conflicts during rapid changes
    updateTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;

      const map = mapInstanceRef.current;
      if (!isMapReady(map)) return;

      try {
        // Clear existing markers safely
        clearMapLayers();

        // Add geofence boundary (circle or polygon)
        if (boundaryType === 'polygon' && polygon && polygon.length >= 3) {
          const latLngs = polygon.map(p => L.latLng(p.lat, p.lng));
          const geofencePolygon = L.polygon(latLngs, {
            color: '#f97316',
            fillColor: '#f97316',
            fillOpacity: 0.1,
            weight: 3,
            dashArray: '10, 10',
          }).addTo(map);
          polygonsRef.current.push(geofencePolygon);
        } else {
          // Default to circle
          const geofenceCircle = L.circle([center.lat, center.lng], {
            radius: radiusMeters,
            color: '#f97316',
            fillColor: '#f97316',
            fillOpacity: 0.1,
            weight: 3,
            dashArray: '10, 10',
          }).addTo(map);
          circlesRef.current.push(geofenceCircle);
        }

        // Filter visible monsters with hysteresis to prevent GPS jitter flickering.
        // Creatures appear at 15m but only disappear at 25m — the 10m buffer
        // absorbs typical GPS accuracy fluctuations (5-10m).
        const APPEAR_RANGE = 15;
        const DISAPPEAR_RANGE = 25;
        const visibleMonsters = showAllMonsters
          ? monsters
          : playerLocation
            ? monsters.filter(m => {
                const dist = calculateDistance(playerLocation, m.location);
                const wasVisible = visibleMonsterIdsRef.current.has(m.id);
                const isVisible = wasVisible ? dist <= DISAPPEAR_RANGE : dist <= APPEAR_RANGE;
                return isVisible;
              })
            : [];

        // Update tracking set
        const newVisibleIds = new Set(visibleMonsters.map(m => m.id));
        visibleMonsterIdsRef.current = newVisibleIds;

        // Add monster markers
        visibleMonsters.forEach(monster => {
          if (!isMountedRef.current || !isMapReady(mapInstanceRef.current)) return;
          if (monster.captured && !showAllMonsters) return;

          const icon = L.divIcon({
            html: `
              <div class="monster-marker ${monster.rarity} ${monster.captured ? 'captured' : ''}">
                <span>${monster.emoji}</span>
              </div>
            `,
            className: '',
            iconSize: [40, 40],
            iconAnchor: [20, 20],
          });

          const marker = L.marker([monster.location.lat, monster.location.lng], { icon })
            .bindPopup(`
              <div style="text-align: center;">
                <p style="font-size: 24px; margin: 0;">${monster.emoji}</p>
                <p style="font-weight: bold; margin: 4px 0;">${monster.name}</p>
                <p style="font-size: 12px; color: #666; text-transform: capitalize;">${monster.rarity}</p>
                <p style="font-weight: bold; color: #f97316;">⚡ ${formatSats(monster.satAmount)} sats</p>
                ${monster.captured ? '<p style="color: #888; font-size: 12px;">Captured</p>' : ''}
              </div>
            `)
            .addTo(map);

          if (onMonsterClickRef.current) {
            marker.on('click', () => onMonsterClickRef.current?.(monster));
          }

          markersRef.current.push(marker);
        });

        // Add sat stop markers
        satStops.forEach(stop => {
          if (!isMountedRef.current || !isMapReady(mapInstanceRef.current)) return;

          const icon = L.divIcon({
            html: `
              <div class="stop-marker">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" fill="#22c55e" stroke="#fff" stroke-width="2"/>
                  <circle cx="12" cy="12" r="4" fill="#fff"/>
                </svg>
              </div>
            `,
            className: '',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          });

          const marker = L.marker([stop.location.lat, stop.location.lng], { icon })
            .bindPopup(`
              <div style="text-align: center;">
                <p style="font-weight: bold; color: #22c55e;">${stop.name}</p>
                <p style="font-size: 12px; color: #666;">${stop.description}</p>
                <p style="font-weight: bold;">🟢 ${stop.ballsPerCollection} SatCubes</p>
              </div>
            `)
            .addTo(map);

          if (onStopClickRef.current) {
            marker.on('click', () => onStopClickRef.current?.(stop));
          }

          markersRef.current.push(marker);
        });

        // Add player marker
        if (playerLocation && isMountedRef.current && isMapReady(mapInstanceRef.current)) {
          const playerIcon = L.divIcon({
            html: `
              <div class="player-marker">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="8" fill="#f97316" stroke="#fff" stroke-width="3"/>
                  <circle cx="12" cy="12" r="4" fill="#fff"/>
                </svg>
              </div>
            `,
            className: '',
            iconSize: [40, 40],
            iconAnchor: [20, 20],
          });

          const playerMarker = L.marker([playerLocation.lat, playerLocation.lng], { icon: playerIcon })
            .bindPopup('<div style="text-align: center; font-weight: bold;">Your Location</div>')
            .addTo(map);

          markersRef.current.push(playerMarker);

          // Add capture/visibility range circle (15m - orange)
          if (!showAllMonsters) {
            const CAPTURE_RANGE = 15;
            const captureCircle = L.circle([playerLocation.lat, playerLocation.lng], {
              radius: CAPTURE_RANGE,
              color: '#f97316',
              fillColor: '#f97316',
              fillOpacity: 0.15,
              weight: 2,
            }).addTo(map);
            circlesRef.current.push(captureCircle);
          }

          // Center map on player (with safety check)
          if (isMountedRef.current && isMapReady(mapInstanceRef.current)) {
            map.setView([playerLocation.lat, playerLocation.lng], map.getZoom());
          }
        }
      } catch {
        // Ignore errors during map updates - map may have been destroyed
      }
    }, 50); // 50ms debounce

    return () => {
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
    };
  }, [center, radiusMeters, playerLocation, monsters, satStops, showAllMonsters, clearMapLayers, boundaryType, polygon]);

  return (
    <>
      <style>{`
        .monster-marker {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.7) 100%);
          border: 3px solid #f97316;
          box-shadow: 0 0 15px rgba(249, 115, 22, 0.6);
          animation: float 3s ease-in-out infinite;
          font-size: 20px;
          cursor: pointer;
        }
        .monster-marker.mythic {
          border-color: #facc15;
          box-shadow: 0 0 25px rgba(250, 204, 21, 0.9);
          animation: float 3s ease-in-out infinite, glow-pulse 2s ease-in-out infinite;
        }
        .monster-marker.legendary {
          border-color: #a855f7;
          box-shadow: 0 0 18px rgba(168, 85, 247, 0.7);
        }
        .monster-marker.rare {
          border-color: #3b82f6;
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.5);
        }
        .monster-marker.uncommon {
          border-color: #22c55e;
        }
        .monster-marker.captured {
          opacity: 0.5;
          filter: grayscale(1);
        }
        .stop-marker, .player-marker {
          animation: pulse 2s ease-in-out infinite;
          cursor: pointer;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-5px); }
        }
        @keyframes glow-pulse {
          0%, 100% { filter: drop-shadow(0 0 10px rgba(250, 204, 21, 0.7)); }
          50% { filter: drop-shadow(0 0 20px rgba(250, 204, 21, 1)); }
        }
        /* Contain Leaflet in its own stacking context to prevent iOS Safari z-index issues */
        .leaflet-map-container {
          isolation: isolate;
          contain: layout style;
          position: relative;
          z-index: 0;
        }
        .leaflet-container {
          background: #0d0f14 !important;
          z-index: 1 !important;
          /* Prevent Leaflet from creating high z-index elements */
          isolation: isolate;
        }
        .leaflet-pane {
          z-index: 1 !important;
        }
        .leaflet-tile-pane {
          z-index: 1 !important;
        }
        .leaflet-overlay-pane {
          z-index: 2 !important;
        }
        .leaflet-shadow-pane {
          z-index: 3 !important;
        }
        .leaflet-marker-pane {
          z-index: 4 !important;
        }
        .leaflet-tooltip-pane {
          z-index: 5 !important;
        }
        .leaflet-popup-pane {
          z-index: 6 !important;
        }
        .leaflet-top, .leaflet-bottom {
          z-index: 10 !important;
        }
        .leaflet-control {
          z-index: 10 !important;
        }
        .leaflet-popup-content-wrapper {
          background: rgba(13, 15, 20, 0.95);
          color: #fff;
          border: 1px solid rgba(249, 115, 22, 0.3);
        }
        .leaflet-popup-tip {
          background: rgba(13, 15, 20, 0.95);
        }
      `}</style>
      <div className={cn('w-full h-full leaflet-map-container', className)}>
        <div ref={mapRef} className="w-full h-full" />
      </div>
    </>
  );
}
