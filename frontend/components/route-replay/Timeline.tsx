"use client";

import type { Analysis, TimelineEvent } from "./types";
import { fmtDistance, fmtDuration, fmtTime } from "./format";

interface Props {
  analysis: Analysis | null;
  loading: boolean;
  /** Place names looked up for positions, keyed by placeKey(lat, lng). */
  names: Record<string, string>;
  selectedId: string | null;
  onSelect: (e: TimelineEvent) => void;
}

/** Same rounding the server uses for its place-name cache (about 11 m). */
export function placeKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

const coords = (lat: number, lng: number) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

// The day as a list of stations, the way "where is my train" shows a journey:
// arrival time on the left, departure on the right, the place in the middle,
// and the distance and time travelled between one place and the next.
export default function Timeline({ analysis, loading, names, selectedId, onSelect }: Props) {
  const nameAt = (lat: number, lng: number) => names[placeKey(lat, lng)] ?? coords(lat, lng);

  return (
    <section
      aria-label="Places visited"
      className="flex h-[540px] flex-col rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Places visited</h3>
        <span className="flex gap-12 pr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <span>Arrival</span>
          <span>Departure</span>
        </span>
      </header>

      {loading || !analysis ? (
        <div className="flex-1 space-y-4 overflow-hidden p-4" aria-busy aria-label="Loading places">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="h-4 w-14 animate-pulse rounded bg-slate-200" />
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ol className="relative flex-1 overflow-y-auto py-2">
          {analysis.events.map((e) => {
            const selected = e.id === selectedId;
            const station = (
              node: React.ReactNode,
              title: string,
              sub: string,
              left: string,
              right: string,
              label: string,
            ) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSelect(e)}
                  aria-label={label}
                  aria-current={selected ? "step" : undefined}
                  className={`grid w-full grid-cols-[64px_36px_minmax(0,1fr)_64px] items-start gap-x-2 px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    selected ? "bg-primary-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="pt-1 text-right text-xs font-semibold tabular-nums text-slate-700">{left}</span>
                  <span className="flex justify-center">{node}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{title}</span>
                    <span className="block text-xs text-slate-500">{sub}</span>
                  </span>
                  <span className="pt-1 text-xs font-semibold tabular-nums text-slate-500">{right}</span>
                </button>
              </li>
            );

            const connector = (line: string, text: string, sub: string, label: string) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSelect(e)}
                  aria-label={label}
                  aria-current={selected ? "step" : undefined}
                  className={`grid w-full grid-cols-[64px_36px_minmax(0,1fr)_64px] items-center gap-x-2 px-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                    selected ? "bg-primary-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span />
                  <span className="flex justify-center self-stretch">
                    <span className={`w-1 min-h-[44px] rounded-full ${line}`} />
                  </span>
                  <span className="py-2">
                    <span className="block text-xs font-semibold text-slate-700">{text}</span>
                    <span className="block text-[11px] text-slate-400">{sub}</span>
                  </span>
                  <span />
                </button>
              </li>
            );

            switch (e.kind) {
              case "start": {
                const p = analysis.points[e.idx]!;
                return station(
                  <span className="mt-0.5 h-4 w-4 rounded-full border-[3px] border-white bg-emerald-600 ring-2 ring-emerald-600" />,
                  nameAt(p.lat, p.lng),
                  "Day started: first location recorded",
                  fmtTime(e.at),
                  "",
                  `Day started at ${fmtTime(e.at)}`,
                );
              }
              case "stop": {
                const s = e.stop;
                const title = s.placeName ?? nameAt(s.lat, s.lng);
                return station(
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white ring-2 ring-white">
                    {s.number}
                  </span>,
                  title,
                  `${s.placeType ? `${s.placeType} · ` : ""}Stayed ${fmtDuration(s.dwellMs)}`,
                  fmtTime(s.arrival),
                  fmtTime(s.departure),
                  `Stop ${s.number}, ${title}, ${fmtTime(s.arrival)} to ${fmtTime(s.departure)}`,
                );
              }
              case "travel":
                return connector(
                  "bg-blue-400",
                  `${fmtDistance(e.distanceM)} · ${fmtDuration(e.endAt - e.at)}`,
                  `Travelling, ${fmtTime(e.at)} to ${fmtTime(e.endAt)}`,
                  `Travelled ${fmtDistance(e.distanceM)} in ${fmtDuration(e.endAt - e.at)}`,
                );
              case "gap":
                return connector(
                  "bg-slate-300",
                  `No signal for ${fmtDuration(e.endAt - e.at)}`,
                  `${fmtTime(e.at)} to ${fmtTime(e.endAt)} · position unknown`,
                  `No signal for ${fmtDuration(e.endAt - e.at)}`,
                );
              case "end": {
                const p = analysis.points[e.idx]!;
                return station(
                  <span className="mt-0.5 h-4 w-4 rounded-full border-[3px] border-white bg-rose-600 ring-2 ring-rose-600" />,
                  nameAt(p.lat, p.lng),
                  "Last location recorded",
                  fmtTime(e.at),
                  "",
                  `Last location at ${fmtTime(e.at)}`,
                );
              }
            }
          })}
        </ol>
      )}
    </section>
  );
}
