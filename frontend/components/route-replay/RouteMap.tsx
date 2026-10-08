"use client";

import { memo, useEffect, useMemo } from "react";
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Maximize2 } from "lucide-react";
import type { Analysis, Position, Stop } from "./types";
import { buildSpeedRuns, decimatedPath, indexAtTime, traveledRuns, DEFAULT_OPTIONS } from "./routeAnalysis";
import { fmtDuration, fmtTime } from "./format";

export interface MapFocus {
  lat: number;
  lng: number;
  /** Changes every time the screen wants the map to move. */
  nonce: number;
}

interface Props {
  analysis: Analysis;
  currentT: number;
  position: Position | null;
  activeStopId: string | null;
  focus: MapFocus | null;
  fitNonce: number;
  /** True while playing: the map pans to keep the marker visible. */
  follow: boolean;
  onFit: () => void;
  onStopClick: (stop: Stop) => void;
}

const ROUTE_BLUE = "#2563eb";
const SLOW_AMBER = "#f59e0b";
const NO_SIGNAL = "#64748b";

function pinIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [30, 38],
    iconAnchor: [15, 37],
    html: `<div style="width:30px;height:38px;filter:drop-shadow(0 2px 3px rgba(15,23,42,.4))">
      <svg viewBox="0 0 30 38" width="30" height="38" aria-label="${label}">
        <path d="M15 37C15 37 2 23 2 14a13 13 0 0 1 26 0c0 9-13 23-13 23z" fill="${color}" stroke="#fff" stroke-width="2"/>
        <circle cx="15" cy="14" r="5" fill="#fff"/>
      </svg></div>`,
  });
}
const START_ICON = pinIcon("#16a34a", "Day start");
const END_ICON = pinIcon("#dc2626", "Day end");

function stopIcon(n: number, active: boolean): L.DivIcon {
  const ring = active ? "box-shadow:0 0 0 4px rgba(159,29,29,.35),0 2px 6px rgba(15,23,42,.45);" : "box-shadow:0 2px 6px rgba(15,23,42,.45);";
  const bg = active ? "#9f1d1d" : "#0f172a";
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${bg};color:#fff;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font:600 12px/1 system-ui,sans-serif;${ring}transition:all 150ms ease">${n}</div>`,
  });
}

function movingIcon(heading: number): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<div style="width:36px;height:36px;border-radius:9999px;background:${ROUTE_BLUE};border:3px solid #fff;box-shadow:0 0 0 5px rgba(37,99,235,.25),0 3px 8px rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center">
      <svg viewBox="0 0 24 24" width="20" height="20" style="transform:rotate(${heading}deg);transition:transform 150ms linear" aria-hidden="true">
        <path d="M12 3l6.5 16L12 15.5 5.5 19z" fill="#fff"/>
      </svg></div>`,
  });
}

function Controllers({
  analysis,
  fitNonce,
  focus,
  position,
  follow,
}: {
  analysis: Analysis;
  fitNonce: number;
  focus: MapFocus | null;
  position: Position | null;
  follow: boolean;
}) {
  const map = useMap();

  // While playing, keep the moving marker on screen.
  useEffect(() => {
    if (!follow || !position) return;
    const here = L.latLng(position.lat, position.lng);
    if (!map.getBounds().pad(-0.15).contains(here)) map.panTo(here, { animate: true, duration: 0.4 });
  }, [follow, position, map]);

  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);

  useEffect(() => {
    const pts = analysis.points;
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView([pts[0]!.lat, pts[0]!.lng], 16);
      return;
    }
    const bounds = L.latLngBounds(decimatedPath(pts, pts.length - 1, 1500));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
  }, [analysis, fitNonce, map]);

  useEffect(() => {
    if (!focus) return;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, map]);

  return null;
}

/** Everything that does not change while the playhead moves. */
const StaticLayers = memo(function StaticLayers({
  analysis,
  activeStopId,
  onStopClick,
}: {
  analysis: Analysis;
  activeStopId: string | null;
  onStopClick: (s: Stop) => void;
}) {
  const runs = useMemo(() => buildSpeedRuns(analysis.points, DEFAULT_OPTIONS.gapMs), [analysis]);
  const first = analysis.points[0]!;
  const last = analysis.points[analysis.points.length - 1]!;
  const multi = analysis.points.length > 1;

  return (
    <>
      {runs.map((r, i) => (
        <Polyline
          key={`faint-${i}`}
          positions={r.positions}
          pathOptions={{ color: r.cls === "slow" ? SLOW_AMBER : ROUTE_BLUE, weight: 4, opacity: 0.28, lineCap: "round", lineJoin: "round" }}
          interactive={false}
        />
      ))}

      {analysis.gaps.map((g) => {
        const a = analysis.points[g.fromIdx]!;
        const b = analysis.points[g.toIdx]!;
        return (
          <Polyline
            key={g.id}
            positions={[
              [a.lat, a.lng],
              [b.lat, b.lng],
            ]}
            pathOptions={{ color: NO_SIGNAL, weight: 3, opacity: 0.9, dashArray: "6 9" }}
            interactive={false}
          >
            <Tooltip permanent direction="center" className="route-gap-label">
              No signal {fmtDuration(g.durationMs)}
            </Tooltip>
          </Polyline>
        );
      })}

      {analysis.stops.map((s) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lng]}
          icon={stopIcon(s.number, s.id === activeStopId)}
          zIndexOffset={s.id === activeStopId ? 700 : 400}
          eventHandlers={{ click: () => onStopClick(s) }}
        >
          <Tooltip direction="top" offset={[0, -14]} className="route-tooltip">
            <div className="text-xs">
              <div className="text-sm font-semibold">
                {s.number}. {s.placeName ?? "Unknown location"}
              </div>
              {s.placeType && <div className="text-slate-500">{s.placeType}</div>}
              <div className="mt-1">
                {fmtTime(s.arrival)} to {fmtTime(s.departure)}
              </div>
              <div className="font-medium">Stayed {fmtDuration(s.dwellMs)}</div>
            </div>
          </Tooltip>
        </Marker>
      ))}

      <Marker position={[first.lat, first.lng]} icon={START_ICON} zIndexOffset={500}>
        <Tooltip direction="top" offset={[0, -34]} className="route-tooltip">
          <span className="text-xs font-semibold">Day started {fmtTime(first.t)}</span>
        </Tooltip>
      </Marker>
      {multi && (
        <Marker position={[last.lat, last.lng]} icon={END_ICON} zIndexOffset={500}>
          <Tooltip direction="top" offset={[0, -34]} className="route-tooltip">
            <span className="text-xs font-semibold">Last ping {fmtTime(last.t)}</span>
          </Tooltip>
        </Marker>
      )}
    </>
  );
});

function Legend() {
  const row = "flex items-center gap-2";
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-md backdrop-blur">
      <div className="mb-1 font-semibold uppercase tracking-wider text-slate-400">Legend</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className={row}><i className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Start</span>
        <span className={row}><i className="h-2.5 w-2.5 rounded-full bg-red-600" />End</span>
        <span className={row}><i className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-[8px] font-bold text-white">1</i>Stop</span>
        <span className={row}><i className="h-1 w-4 rounded bg-blue-600" />Moving</span>
        <span className={row}><i className="h-1 w-4 rounded bg-amber-500" />Slow</span>
        <span className={row}><i className="h-0 w-4 border-t-2 border-dashed border-slate-500" />No signal</span>
      </div>
    </div>
  );
}

export default function RouteMap({ analysis, currentT, position, activeStopId, focus, fitNonce, follow, onFit, onStopClick }: Props) {
  const multi = analysis.points.length > 1;
  const runs = useMemo(() => buildSpeedRuns(analysis.points, DEFAULT_OPTIONS.gapMs), [analysis]);

  const idx = position?.idx ?? 0;
  const traveled = useMemo(() => {
    if (!multi) return [];
    const done = traveledRuns(runs, idx);
    const lastRun = done[done.length - 1];
    if (lastRun && position && !position.inGap) lastRun.positions.push([position.lat, position.lng]);
    return done;
  }, [runs, idx, position, multi]);

  const trail = useMemo(() => {
    if (!multi || !position) return [] as [number, number][][];
    const from = indexAtTime(analysis.points, currentT - 180_000);
    const pts: [number, number][] = [];
    for (let i = from; i <= idx; i++) {
      const p = analysis.points[i]!;
      pts.push([p.lat, p.lng]);
    }
    pts.push([position.lat, position.lng]);
    const third = Math.max(1, Math.floor(pts.length / 3));
    return [pts.slice(0, third + 1), pts.slice(third, third * 2 + 1), pts.slice(third * 2)].filter((c) => c.length > 1);
  }, [analysis.points, currentT, idx, position, multi]);

  const headingBucket = position ? Math.round(position.heading / 10) * 10 : 0;
  const mover = useMemo(() => movingIcon(headingBucket), [headingBucket]);

  return (
    <div className="relative h-[540px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <MapContainer
        center={[analysis.points[0]!.lat, analysis.points[0]!.lng]}
        zoom={13}
        scrollWheelZoom
        preferCanvas
        className="h-full w-full"
      >
        <TileLayer
          className="route-tiles"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <Controllers analysis={analysis} fitNonce={fitNonce} focus={focus} position={position} follow={follow} />
        <StaticLayers analysis={analysis} activeStopId={activeStopId} onStopClick={onStopClick} />

        {traveled.map((r, i) => (
          <Polyline
            key={`done-${r.startIdx}-${i}`}
            positions={r.positions}
            pathOptions={{ color: r.cls === "slow" ? SLOW_AMBER : ROUTE_BLUE, weight: 5, opacity: 1, lineCap: "round", lineJoin: "round" }}
            interactive={false}
          />
        ))}

        {trail.map((c, i) => (
          <Polyline
            key={`trail-${i}`}
            positions={c}
            pathOptions={{ color: ROUTE_BLUE, weight: 9, opacity: 0.12 + i * 0.12, lineCap: "round" }}
            interactive={false}
          />
        ))}

        {multi && position && (
          <Marker position={[position.lat, position.lng]} icon={mover} zIndexOffset={1000} keyboard={false} />
        )}
      </MapContainer>

      <button
        type="button"
        onClick={onFit}
        className="route-print-hide absolute right-3 top-3 z-[500] inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-md transition-colors duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        aria-label="Fit the whole route on screen"
        title="Fit route"
      >
        <Maximize2 className="h-4 w-4" aria-hidden />
        Fit route
      </button>
      <Legend />
    </div>
  );
}
