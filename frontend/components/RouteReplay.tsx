"use client";

import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Play, Pause, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api/client";

// Fix custom icon rendering
const createCustomIcon = (color: string) => {
  return new L.DivIcon({
    html: `<div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>`,
    className: "custom-leaflet-icon",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
};

const MARKER_ICON = createCustomIcon("#3b82f6");

interface RoutePoint {
  location_lat: number;
  location_lng: number;
  recorded_at: string;
  speed: number;
}

interface RouteReplayProps {
  officer_id: string;
  date: string;
}

// Controller to update map bounds based on route
function MapBoundsController({ route }: { route: RoutePoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (route.length > 0) {
      const bounds = L.latLngBounds(route.map((p) => [p.location_lat, p.location_lng]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [route, map]);
  return null;
}

export default function RouteReplay({ officer_id, date }: RouteReplayProps) {
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // GET /location/history/{officer_id}?date=YYYY-MM-DD - admin/manager
    // only, backed by real gps_tracks rows (see location_router.py). This
    // was previously mock data (randomly generated points around Salem/
    // Coimbatore, hardcoded regardless of which officer or date was
    // selected) with the real call written but commented out - the
    // backend endpoint's own docstring already assumed this component
    // was calling it ("lets a client (including RouteReplay, which calls
    // this endpoint)..."), so this wires up what was actually already
    // built and waiting on the backend side.
    let cancelled = false;
    const fetchRoute = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows: any[] = await apiFetch(
          `/location/history/${officer_id}?date=${encodeURIComponent(date)}`
        );
        if (cancelled) return;
        const mapped: RoutePoint[] = (rows || []).map((r) => ({
          location_lat: r.lat,
          location_lng: r.lng,
          recorded_at: r.recorded_at,
          speed: r.speed ?? 0,
        }));
        setRoute(mapped);
        setCurrentIndex(0);
        setIsPlaying(false);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || "Failed to fetch route history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchRoute();
    return () => {
      cancelled = true;
    };
  }, [officer_id, date]);

  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= route.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000 / playbackSpeed);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    }

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, route.length, playbackSpeed]);

  const handlePlayPause = () => {
    if (currentIndex >= route.length - 1) {
      setCurrentIndex(0); // reset if at the end
    }
    setIsPlaying(!isPlaying);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentIndex(Number(e.target.value));
  };

  if (loading) {
    return (
      <div className="w-full h-[500px] flex items-center justify-center bg-slate-100 rounded-xl border border-slate-200">
        <RefreshCw className="animate-spin text-slate-400 w-8 h-8" />
        <span className="ml-3 text-slate-500 font-medium">Loading Route History...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-[500px] flex items-center justify-center bg-red-50 rounded-xl border border-red-200 text-red-600 font-medium">
        {error}
      </div>
    );
  }

  if (route.length === 0) {
    return (
      <div className="w-full h-[500px] flex items-center justify-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500 font-medium">
        No route data available for this date.
      </div>
    );
  }

  const polylinePositions = route.map((p) => [p.location_lat, p.location_lng] as [number, number]);
  const currentPoint = route[currentIndex];
  
  const formatDate = (isoStr: string) => {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-col md:flex-row items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <button
          onClick={handlePlayPause}
          className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full transition shadow-md"
        >
          {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-1" />}
        </button>

        <div className="flex-1 w-full flex flex-col gap-2">
          <input
            type="range"
            min="0"
            max={route.length - 1}
            value={currentIndex}
            onChange={handleSliderChange}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600 text-slate-900"
          />
          <div className="flex justify-between text-xs text-slate-500 font-medium">
            <span>{route.length > 0 ? formatDate(route[0]?.recorded_at || "") : ""}</span>
            <span>{route.length > 0 ? formatDate(route[route.length - 1]?.recorded_at || "") : ""}</span>
          </div>
        </div>

        <div className="flex flex-col min-w-[120px]">
          <span className="text-xs text-slate-500 uppercase font-bold">Speed</span>
          <select 
            value={playbackSpeed} 
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            className="p-1 border border-slate-300 rounded text-sm bg-slate-50 text-slate-900"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x Normal</option>
            <option value={2}>2x Fast</option>
            <option value={5}>5x Very Fast</option>
          </select>
        </div>
      </div>

      <div className="relative w-full h-[500px] rounded-xl overflow-hidden border border-slate-300 shadow-inner z-10">
        {/* We use a div covering the map when playing is active if we want to avoid interaction, but leaflet is fine. */}
        {currentPoint && (
          <div className="absolute top-4 right-4 z-[400] bg-white p-3 rounded-lg shadow-lg border border-slate-200">
            <div className="text-sm font-bold text-slate-800 mb-1">Current Status</div>
            <div className="text-xs text-slate-600">Time: <span className="font-semibold text-slate-900">{formatDate(currentPoint.recorded_at)}</span></div>
            <div className="text-xs text-slate-600">Speed: <span className="font-semibold text-slate-900">{currentPoint.speed} km/h</span></div>
          </div>
        )}

        <MapContainer center={route.length > 0 ? [route[0]?.location_lat || 0, route[0]?.location_lng || 0] : [0, 0]} zoom={13} scrollWheelZoom={true} className="w-full h-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Polyline positions={polylinePositions} color="#3b82f6" weight={4} opacity={0.6} />
          
          {currentPoint && (
            <Marker position={[currentPoint.location_lat, currentPoint.location_lng]} icon={MARKER_ICON}>
              <Popup>
                <div className="font-bold text-sm text-slate-800">Officer Location</div>
                <div className="text-xs text-slate-600">{formatDate(currentPoint.recorded_at)}</div>
                <div className="text-xs text-slate-600">Speed: {currentPoint.speed} km/h</div>
              </Popup>
            </Marker>
          )}

          <MapBoundsController route={route} />
        </MapContainer>
      </div>
    </div>
  );
}
