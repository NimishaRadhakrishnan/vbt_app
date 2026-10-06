"use client";

import { useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Analysis, Position } from "./types";
import { fmtDuration, fmtTime } from "./format";

export const SPEEDS = [1, 2, 5, 10] as const;

interface Props {
  analysis: Analysis;
  currentT: number;
  position: Position | null;
  playing: boolean;
  speed: number;
  hasPrevStop: boolean;
  hasNextStop: boolean;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onSpeed: (s: number) => void;
  onPrevStop: () => void;
  onNextStop: () => void;
}

const roundBtn =
  "inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40";

export default function PlaybackControls({
  analysis,
  currentT,
  position,
  playing,
  speed,
  hasPrevStop,
  hasNextStop,
  onToggle,
  onSeek,
  onSpeed,
  onPrevStop,
  onNextStop,
}: Props) {
  const { startT, endT } = analysis;
  const spanSec = Math.max(1, Math.round((endT - startT) / 1000));
  const valueSec = Math.max(0, Math.min(spanSec, Math.round((currentT - startT) / 1000)));
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - startT) / (endT - startT || 1)) * 100))}%`;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ left: number; t: number } | null>(null);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const f = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
    setHover({ left: f * 100, t: startT + f * (endT - startT) });
  };

  const readout = position?.inGap
    ? `${fmtTime(currentT)} · no signal`
    : `${fmtTime(currentT)} · ${Math.round(position?.speedKmh ?? 0)} km/h`;

  return (
    <section
      aria-label="Playback"
      className="route-print-hide rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <button type="button" className={roundBtn} onClick={onPrevStop} disabled={!hasPrevStop} aria-label="Previous stop" title="Previous stop ( [ )" aria-keyshortcuts="[">
            <SkipBack className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            aria-keyshortcuts="Space"
            className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary-700 text-white shadow-md transition-all duration-150 hover:bg-primary-800 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {playing ? <Pause className="h-5 w-5" aria-hidden /> : <Play className="ml-0.5 h-5 w-5" aria-hidden />}
          </button>
          <button type="button" className={roundBtn} onClick={onNextStop} disabled={!hasNextStop} aria-label="Next stop" title="Next stop ( ] )" aria-keyshortcuts="]">
            <SkipForward className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="min-w-[200px] flex-1">
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <span className="font-semibold tabular-nums text-slate-900" aria-live="off">{readout}</span>
            <span className="text-xs text-slate-500">{fmtDuration(currentT - startT)} into the day</span>
          </div>

          <div ref={wrapRef} className="relative h-8" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-slate-200" aria-hidden />
            <div className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-blue-600/70" style={{ width: pct(currentT) }} aria-hidden />
            {analysis.gaps.map((g) => (
              <div
                key={g.id}
                className="absolute top-1/2 h-2 -translate-y-1/2 bg-slate-500/60 [background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.55)_0,rgba(255,255,255,.55)_2px,transparent_2px,transparent_5px)]"
                style={{ left: pct(g.from), width: `calc(${pct(g.to)} - ${pct(g.from)})` }}
                title={`No signal ${fmtDuration(g.durationMs)}`}
                aria-hidden
              />
            ))}
            {analysis.stops.map((s) => (
              <div key={s.id} className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 bg-slate-900" style={{ left: pct(s.arrival) }} title={`Stop ${s.number}`} aria-hidden />
            ))}
            <input
              type="range"
              className="route-range absolute inset-0"
              min={0}
              max={spanSec}
              step={1}
              value={valueSec}
              aria-label="Position in the day"
              aria-valuetext={readout}
              onChange={(e) => onSeek(startT + Number(e.target.value) * 1000)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const step = (e.shiftKey ? 10 : 1) * 60_000;
                  onSeek(currentT + (e.key === "ArrowRight" ? step : -step));
                }
              }}
            />
            {hover && (
              <div
                className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-0.5 text-xs font-medium text-white shadow"
                style={{ left: `${hover.left}%` }}
              >
                {fmtTime(hover.t)}
              </div>
            )}
          </div>

          <div className="flex justify-between text-xs text-slate-500">
            <span>{fmtTime(startT)}</span>
            <span>{fmtTime(endT)}</span>
          </div>
        </div>

        <div className="flex flex-col items-start gap-1">
          <span id="route-speed-label" className="text-xs font-semibold uppercase tracking-wider text-slate-500">Speed</span>
          <div role="radiogroup" aria-labelledby="route-speed-label" className="flex rounded-lg bg-slate-100 p-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={speed === s}
                onClick={() => onSpeed(s)}
                title={`${s} minute${s === 1 ? "" : "s"} of the day per second`}
                className={`h-8 min-w-[44px] rounded-md px-3 text-sm font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  speed === s ? "bg-white text-primary-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Keys: Space play/pause · Left/Right step 1 min (Shift = 10) · [ and ] previous/next stop. 1x plays one minute of the day per second.
      </p>
    </section>
  );
}
