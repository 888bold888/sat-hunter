import { useEffect, useRef, useState } from 'react';
import type { GeoLocation } from '@/lib/gameTypes';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import { cn } from '@/lib/utils';
import { Pentagon, Trash2, X } from 'lucide-react';

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
  const drawHandlerRef = useRef<L.Draw.Polygon | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [hasPolygon, setHasPolygon] = useState(false);

  // Stable refs for callbacks
  const onPolygonCompleteRef = useRef(onPolygonComplete);
  const onPolygonClearRef = useRef(onPolygonClear);
  onPolygonCompleteRef.current = onPolygonComplete;
  onPolygonClearRef.current = onPolygonClear;

  // Initialize map (without leaflet-draw controls - we'll use our own UI)
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false, // We'll handle zoom differently or skip it
      attributionControl: false,
    }).setView([center.lat, center.lng], 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Create feature group for drawn items
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    drawnItemsRef.current = drawnItems;

    // Handle polygon creation event
    map.on(L.Draw.Event.CREATED, (event: L.DrawEvents.Created) => {
      drawnItems.clearLayers();
      const layer = event.layer;
      drawnItems.addLayer(layer);

      if (layer instanceof L.Polygon) {
        const latLngs = layer.getLatLngs()[0] as L.LatLng[];
        const points: GeoLocation[] = latLngs.map(ll => ({
          lat: ll.lat,
          lng: ll.lng,
        }));
        onPolygonCompleteRef.current(points);
        setHasPolygon(true);
      }
      setIsDrawing(false);
    });

    // Handle drawing stop (cancel)
    map.on('draw:drawstop', () => {
      setIsDrawing(false);
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      drawnItemsRef.current = null;
      drawHandlerRef.current = null;
    };
  }, [center.lat, center.lng]);

  // Draw existing polygon if provided
  useEffect(() => {
    if (!mapInstanceRef.current || !drawnItemsRef.current) return;

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
      mapInstanceRef.current.fitBounds(polygonLayer.getBounds(), { padding: [50, 50] });
      setHasPolygon(true);
    } else {
      setHasPolygon(false);
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

  // Start drawing polygon
  const startDrawing = () => {
    if (!mapInstanceRef.current) return;

    // Clear existing polygon first
    if (drawnItemsRef.current) {
      drawnItemsRef.current.clearLayers();
    }
    setHasPolygon(false);

    // Create and enable polygon draw handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drawHandler = new L.Draw.Polygon(mapInstanceRef.current as any, {
      allowIntersection: false,
      showArea: false,
      shapeOptions: {
        color: '#f97316',
        fillColor: '#f97316',
        fillOpacity: 0.2,
        weight: 3,
      },
    });

    drawHandler.enable();
    drawHandlerRef.current = drawHandler;
    setIsDrawing(true);
  };

  // Cancel drawing
  const cancelDrawing = () => {
    if (drawHandlerRef.current) {
      drawHandlerRef.current.disable();
      drawHandlerRef.current = null;
    }
    setIsDrawing(false);
  };

  // Delete polygon
  const deletePolygon = () => {
    if (drawnItemsRef.current) {
      drawnItemsRef.current.clearLayers();
    }
    setHasPolygon(false);
    onPolygonClearRef.current();
  };

  // Zoom controls
  const zoomIn = () => mapInstanceRef.current?.zoomIn();
  const zoomOut = () => mapInstanceRef.current?.zoomOut();

  return (
    <div className={cn('relative', className)}>
      <div ref={mapRef} className="w-full h-full rounded-lg" />

      {/* Custom controls - positioned outside Leaflet's DOM */}
      <div className="absolute top-2 right-2 flex flex-col gap-2" style={{ zIndex: 1000 }}>
        {!isDrawing ? (
          <>
            <button
              type="button"
              onClick={startDrawing}
              className="h-10 w-10 flex items-center justify-center rounded-md bg-zinc-900 border-2 border-orange-500 shadow-lg"
              title="Draw polygon"
            >
              <Pentagon className="h-5 w-5 text-orange-500" />
            </button>
            {hasPolygon && (
              <button
                type="button"
                onClick={deletePolygon}
                className="h-10 w-10 flex items-center justify-center rounded-md bg-zinc-900 border-2 border-red-500 shadow-lg"
                title="Delete polygon"
              >
                <Trash2 className="h-5 w-5 text-red-500" />
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={cancelDrawing}
            className="h-10 w-10 flex items-center justify-center rounded-md bg-zinc-900 border-2 border-red-500 shadow-lg"
            title="Cancel drawing"
          >
            <X className="h-5 w-5 text-red-500" />
          </button>
        )}
      </div>

      {/* Zoom controls */}
      <div className="absolute top-2 left-2 flex flex-col gap-1" style={{ zIndex: 1000 }}>
        <button
          type="button"
          onClick={zoomIn}
          className="h-8 w-8 flex items-center justify-center rounded-md bg-zinc-900 border border-zinc-700 shadow-lg text-white text-lg font-bold"
        >
          +
        </button>
        <button
          type="button"
          onClick={zoomOut}
          className="h-8 w-8 flex items-center justify-center rounded-md bg-zinc-900 border border-zinc-700 shadow-lg text-white text-lg font-bold"
        >
          −
        </button>
      </div>

      {/* Instructions */}
      <div className="absolute bottom-2 left-2 right-2 bg-background/90 backdrop-blur rounded px-3 py-2 text-xs text-muted-foreground text-center pointer-events-none" style={{ zIndex: 1000 }}>
        {isDrawing
          ? "Tap points on the map to draw your boundary. Tap the first point to close the shape."
          : "Tap the polygon icon (top-right) to start drawing your hunt boundary."
        }
      </div>
    </div>
  );
}
