import { useEffect, useRef } from 'react';
import type { Monster, SatStop, GeoLocation } from '@/lib/gameTypes';
import { calculateDistance, getRarityColor, formatSats } from '@/lib/gameUtils';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';

// Fix Leaflet default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
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
}: HuntMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const circlesRef = useRef<L.Circle[]>([]);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([center.lat, center.lng], 16);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [center]);

  // Update markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    circlesRef.current.forEach(circle => circle.remove());
    markersRef.current = [];
    circlesRef.current = [];

    // Add geofence circle
    const geofenceCircle = L.circle([center.lat, center.lng], {
      radius: radiusMeters,
      color: '#f97316',
      fillColor: '#f97316',
      fillOpacity: 0.1,
      weight: 3,
      dashArray: '10, 10',
    }).addTo(map);
    circlesRef.current.push(geofenceCircle);

    // Filter visible monsters
    const VISIBILITY_RANGE = 3;
    const visibleMonsters = showAllMonsters
      ? monsters
      : playerLocation
        ? monsters.filter(m => calculateDistance(playerLocation, m.location) <= VISIBILITY_RANGE)
        : [];

    // Add monster markers
    visibleMonsters.forEach(monster => {
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

      if (onMonsterClick) {
        marker.on('click', () => onMonsterClick(monster));
      }

      markersRef.current.push(marker);
    });

    // Add sat stop markers
    satStops.forEach(stop => {
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
            <p style="font-weight: bold;">🟢 ${stop.ballsPerCollection} SatBalls</p>
          </div>
        `)
        .addTo(map);

      if (onStopClick) {
        marker.on('click', () => onStopClick(stop));
      }

      markersRef.current.push(marker);
    });

    // Add player marker
    if (playerLocation) {
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

      const playerMarker = L.marker([playerLocation.lat, playerLocation.lng], { icon })
        .bindPopup('<div style="text-align: center; font-weight: bold;">Your Location</div>')
        .addTo(map);

      markersRef.current.push(playerMarker);

      // Add visibility circle for players
      if (!showAllMonsters) {
        const visibilityCircle = L.circle([playerLocation.lat, playerLocation.lng], {
          radius: VISIBILITY_RANGE,
          color: '#22c55e',
          fillColor: '#22c55e',
          fillOpacity: 0.15,
          weight: 2,
        }).addTo(map);
        circlesRef.current.push(visibilityCircle);
      }

      // Center map on player
      map.setView([playerLocation.lat, playerLocation.lng], map.getZoom());
    }
  }, [center, radiusMeters, playerLocation, monsters, satStops, showAllMonsters, onMonsterClick, onStopClick]);

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
        .leaflet-container {
          background: #0d0f14 !important;
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
      <div ref={mapRef} className={cn('w-full h-full', className)} />
    </>
  );
}
