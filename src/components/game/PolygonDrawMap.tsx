import { useEffect, useRef } from 'react';
import type { GeoLocation } from '@/lib/gameTypes';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import { cn } from '@/lib/utils';

// Inject global styles once for iOS Safari z-index fix
// This runs once at module load, not on each render
const STYLE_ID = 'polygon-draw-map-ios-fix';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* iOS Safari z-index fix for Leaflet draw controls */
    /* Use transform to force GPU layer without isolation */
    .leaflet-control-container {
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
    }
    .leaflet-top.leaflet-right {
      z-index: 9999 !important;
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
    }
    .leaflet-draw {
      z-index: 9999 !important;
    }
    .leaflet-draw-toolbar {
      z-index: 9999 !important;
    }
  `;
  document.head.appendChild(style);
}

interface PolygonDrawMapProps {
  center: GeoLocation;
  polygon?: GeoLocation[];
  onPolygonComplete: (points: GeoLocation[]) => void;
  onPolygonClear: () => void;
  className?: string;
}

export function PolygonDrawMap({
  center,
  polygon,
  onPolygonComplete,
  onPolygonClear,
  className,
}: PolygonDrawMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const drawnItemsRef = useRef<L.FeatureGroup | null>(null);

  // Stable refs for callbacks
  const onPolygonCompleteRef = useRef(onPolygonComplete);
  const onPolygonClearRef = useRef(onPolygonClear);
  onPolygonCompleteRef.current = onPolygonComplete;
  onPolygonClearRef.current = onPolygonClear;

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([center.lat, center.lng], 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Create feature group for drawn items
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    // Add draw control - polygon only
    const drawControl = new L.Control.Draw({
      position: 'topright',
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: false,
          shapeOptions: {
            color: '#f97316',
            fillColor: '#f97316',
            fillOpacity: 0.2,
            weight: 3,
          },
        },
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
        polyline: false,
      },
      edit: {
        featureGroup: drawnItems,
        remove: true,
      },
    });
    map.addControl(drawControl);

    // Handle polygon creation
    map.on(L.Draw.Event.CREATED, (event: L.DrawEvents.Created) => {
      // Clear existing polygons first (only allow one at a time)
      drawnItems.clearLayers();

      const layer = event.layer;
      drawnItems.addLayer(layer);

      // Extract coordinates
      if (layer instanceof L.Polygon) {
        const latLngs = layer.getLatLngs()[0] as L.LatLng[];
        const points: GeoLocation[] = latLngs.map(ll => ({
          lat: ll.lat,
          lng: ll.lng,
        }));
        onPolygonCompleteRef.current(points);
      }
    });

    // Handle polygon edit
    map.on(L.Draw.Event.EDITED, (event: L.DrawEvents.Edited) => {
      const layers = event.layers;
      layers.eachLayer((layer) => {
        if (layer instanceof L.Polygon) {
          const latLngs = layer.getLatLngs()[0] as L.LatLng[];
          const points: GeoLocation[] = latLngs.map(ll => ({
            lat: ll.lat,
            lng: ll.lng,
          }));
          onPolygonCompleteRef.current(points);
        }
      });
    });

    // Handle polygon deletion
    map.on(L.Draw.Event.DELETED, () => {
      if (drawnItems.getLayers().length === 0) {
        onPolygonClearRef.current();
      }
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      drawnItemsRef.current = null;
    };
  }, [center.lat, center.lng]);

  // Draw existing polygon if provided
  useEffect(() => {
    if (!mapInstanceRef.current || !drawnItemsRef.current) return;

    // Clear existing
    drawnItemsRef.current.clearLayers();

    if (polygon && polygon.length >= 3) {
      const latLngs = polygon.map(p => L.latLng(p.lat, p.lng));
      const polygonLayer = L.polygon(latLngs, {
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 0.2,
        weight: 3,
      });
      drawnItemsRef.current.addLayer(polygonLayer);

      // Fit bounds to polygon
      mapInstanceRef.current.fitBounds(polygonLayer.getBounds(), { padding: [50, 50] });
    }
  }, [polygon]);

  // Add player location marker
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const playerMarker = L.circleMarker([center.lat, center.lng], {
      radius: 8,
      fillColor: '#3b82f6',
      fillOpacity: 1,
      color: '#1d4ed8',
      weight: 2,
    }).addTo(mapInstanceRef.current);

    playerMarker.bindTooltip('You are here', { permanent: false });

    return () => {
      playerMarker.remove();
    };
  }, [center.lat, center.lng]);

  return (
    <div className={cn('relative', className)}>
      <div ref={mapRef} className="w-full h-full rounded-lg" />
      <div className="absolute bottom-2 left-2 right-2 bg-background/90 backdrop-blur rounded px-3 py-2 text-xs text-muted-foreground text-center pointer-events-none" style={{ zIndex: 1000 }}>
        Tap the polygon icon (top-right), then tap points on the map to draw your boundary. Tap the first point to close the shape.
      </div>
    </div>
  );
}
