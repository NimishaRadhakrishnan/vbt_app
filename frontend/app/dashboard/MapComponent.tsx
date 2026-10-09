"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap, Circle, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix custom icon rendering to avoid broken image URLs in next.js webpack builder
const createCustomIcon = (color: string, shape: "circle" | "square" = "circle") => {
  const borderRadius = shape === "circle" ? "50%" : "2px";
  return new L.DivIcon({
    html: `<div style="background-color: ${color}; width: 14px; height: 14px; border-radius: ${borderRadius}; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.4);"></div>`,
    className: "custom-leaflet-icon",
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
};

const OFFICER_ACTIVE_ICON = createCustomIcon("#22c55e", "circle");   // green circle
const OFFICER_INACTIVE_ICON = createCustomIcon("#94a3b8", "circle"); // gray circle
const DEALER_ICON = createCustomIcon("#3b82f6", "square");          // blue square
const FARMER_ICON = createCustomIcon("#f59e0b", "circle");          // amber circle

// One stable colour per officer so each path is easy to tell apart.
const TRAIL_COLORS = ["#2563eb", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be185d", "#65a30d", "#4f46e5"];
function trailColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TRAIL_COLORS[h % TRAIL_COLORS.length] ?? "#2563eb";
}

// Leaflet only measures its container when it is created. If the page lays
// out afterwards (sidebar, fonts, a banner above the map), it keeps the old
// size and leaves grey, unloaded bands. Re-measure whenever the box changes.
function MapSizeFix() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const t1 = setTimeout(fix, 100);
    const t2 = setTimeout(fix, 600);
    const el = map.getContainer();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fix) : null;
    ro?.observe(el);
    window.addEventListener("resize", fix);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
      window.removeEventListener("resize", fix);
    };
  }, [map]);
  return null;
}

function MapController({ selectedMarker }: { selectedMarker: any }) {
  const map = useMap();
  useEffect(() => {
    const hasPosition = !!(selectedMarker && selectedMarker.lat && selectedMarker.lng);

    // Close any popup that belongs to a different marker. Otherwise picking
    // an officer from the list leaves the previous officer's popup open, and
    // for an officer with no location the map keeps showing someone else.
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker && layer.isPopupOpen()) {
        const at = layer.getLatLng();
        const isSelected = hasPosition && at.lat === selectedMarker.lat && at.lng === selectedMarker.lng;
        if (!isSelected) layer.closePopup();
      }
    });

    if (hasPosition) {
      map.setView([selectedMarker.lat, selectedMarker.lng], 13, {
        animate: true,
      });
    }
  }, [selectedMarker, map]);
  return null;
}

interface MapComponentProps {
  officers: any[];
  dealers: any[];
  farmers: any[];
  selectedMarker: any;
  onMarkerClick: (marker: any) => void;
  filterDistrict: string;
  /** Today's path per officer id: [lat, lng] points, oldest first. */
  trails?: Record<string, [number, number][]>;
}

export default function MapComponent({
  officers,
  dealers,
  farmers,
  selectedMarker,
  onMarkerClick,
  filterDistrict,
  trails = {},
}: MapComponentProps) {
  // Center on Tamil Nadu Salem region initially
  const defaultCenter: [number, number] = [11.6643, 78.1460];

  // Filter lists based on district
  const filteredOfficers = officers.filter(
    (o) => filterDistrict === "All" || o.district === filterDistrict
  );
  const filteredDealers = dealers.filter(
    (d) => filterDistrict === "All" || d.district === filterDistrict
  );
  const filteredFarmers = farmers.filter(
    (f) => filterDistrict === "All" || f.district === filterDistrict
  );

  return (
    <div className="w-full h-full min-h-[480px]">
      <MapContainer
        center={defaultCenter}
        zoom={9}
        scrollWheelZoom={true}
        className="w-full h-full rounded-xl overflow-hidden shadow-inner border border-slate-300 z-10"
      >
        <TileLayer
          className="light-tiles"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          keepBuffer={4}
          updateWhenIdle={false}
          maxZoom={19}
        />

        {/* Movement trails: today's path of each officer, growing live */}
        {filteredOfficers.map((o) => {
          const pts = trails[o.id];
          if (!pts || pts.length < 2) return null;
          return (
            <Polyline
              key={`trail-${o.id}`}
              positions={pts}
              pathOptions={{ color: trailColor(String(o.id)), weight: 4, opacity: 0.75 }}
              interactive={false}
            />
          );
        })}

        {/* Officers Markers */}
        {filteredOfficers.map((o) => {
          if (!o.lat || !o.lng) return null;
          const isActive = o.status === "Active";
          const isStale = o.status === "Stale";
          const isLowAccuracy = o.status === "Low accuracy";
          
          let statusColorClass = "text-slate-500";
          let circleColor = "#94a3b8"; // default gray
          
          if (isActive) {
            statusColorClass = "text-green-600 font-bold";
            circleColor = "#22c55e";
          } else if (isStale) {
            statusColorClass = "text-amber-600 font-bold";
            circleColor = "#f59e0b";
          } else if (isLowAccuracy) {
            statusColorClass = "text-yellow-600 font-bold";
            circleColor = "#eab308";
          }

          return (
            <div key={`officer-group-${o.id}`}>
              <Marker
                position={[o.lat, o.lng]}
                icon={isActive || isLowAccuracy ? OFFICER_ACTIVE_ICON : OFFICER_INACTIVE_ICON}
                eventHandlers={{
                  click: () => onMarkerClick({ ...o, type: "officer" }),
                }}
              >
              </Marker>
              
              {/* Draw accuracy circle if we have a valid accuracy and a recent/active position */}
              {o.accuracy !== null && (isActive || isStale || isLowAccuracy) && (
                <Circle 
                  center={[o.lat, o.lng]} 
                  radius={o.accuracy}
                  pathOptions={{
                    color: circleColor,
                    fillColor: circleColor,
                    fillOpacity: 0.15,
                    weight: 1
                  }}
                  interactive={false}
                />
              )}
            </div>
          );
        })}

        {/* Dealers Markers */}
        {filteredDealers.map((d) => {
          if (!d.lat || !d.lng) return null;
          return (
            <Marker
              key={`dealer-${d.id}`}
              position={[d.lat, d.lng]}
              icon={DEALER_ICON}
              eventHandlers={{
                click: () => onMarkerClick({ ...d, type: "dealer" }),
              }}
            >
            </Marker>
          );
        })}

        {/* Farmers Markers */}
        {filteredFarmers.map((f) => {
          if (!f.lat || !f.lng) return null;
          return (
            <Marker
              key={`farmer-${f.id}`}
              position={[f.lat, f.lng]}
              icon={FARMER_ICON}
              eventHandlers={{
                click: () => onMarkerClick({ ...f, type: "farmer" }),
              }}
            >
            </Marker>
          );
        })}

        <MapSizeFix />
        <MapController selectedMarker={selectedMarker} />
      </MapContainer>
    </div>
  );
}
