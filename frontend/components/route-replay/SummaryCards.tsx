"use client";

import { Clock, MapPin, Route, Timer } from "lucide-react";
import type { Analysis } from "./types";
import { fmtDistance, fmtDuration, fmtTime } from "./format";

function Card({ icon, label, children, caption }: { icon: React.ReactNode; label: string; children: React.ReactNode; caption: React.ReactNode }) {
  return (
    <div className="min-h-[116px] rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-primary-700" aria-hidden>
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-3 text-[26px] font-semibold leading-none text-slate-900">{children}</div>
      <div className="mt-2 text-xs text-slate-500">{caption}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="min-h-[116px] rounded-xl border border-slate-200 bg-white p-4" aria-hidden>
      <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-7 w-24 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-3 w-36 animate-pulse rounded bg-slate-100" />
    </div>
  );
}

export default function SummaryCards({ analysis, loading }: { analysis: Analysis | null; loading: boolean }) {
  if (loading || !analysis) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-busy={loading}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} />
        ))}
      </div>
    );
  }
  const s = analysis.summary;
  const tracked = Math.max(1, s.movingMs + s.stationaryMs + s.noSignalMs);
  const pct = (ms: number) => `${(ms / tracked) * 100}%`;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card icon={<Route className="h-4 w-4" />} label="Distance" caption="Straight-line sum of cleaned GPS points">
        {fmtDistance(s.distanceM)}
      </Card>

      <Card
        icon={<Timer className="h-4 w-4" />}
        label="Moving / stationary"
        caption={
          <>
            <div
              className="mb-2 flex h-2 overflow-hidden rounded-full bg-slate-100"
              role="img"
              aria-label={`Moving ${fmtDuration(s.movingMs)}, stationary ${fmtDuration(s.stationaryMs)}, no signal ${fmtDuration(s.noSignalMs)}`}
            >
              <span className="bg-blue-600" style={{ width: pct(s.movingMs) }} />
              <span className="bg-amber-400" style={{ width: pct(s.stationaryMs) }} />
              <span className="bg-slate-300" style={{ width: pct(s.noSignalMs) }} />
            </div>
            <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-600" />Moving</span>
            <span className="ml-3 inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-400" />Stopped</span>
            {s.noSignalMs > 0 && (
              <span className="ml-3 inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-slate-300" />No signal {fmtDuration(s.noSignalMs)}</span>
            )}
          </>
        }
      >
        {fmtDuration(s.movingMs)} <span className="text-slate-300">/</span> {fmtDuration(s.stationaryMs)}
      </Card>

      <Card
        icon={<MapPin className="h-4 w-4" />}
        label="Stops made"
        caption={s.stopsCount === 0 ? "No stop of 5+ minutes" : "Stayed within 50 m for 5+ minutes"}
      >
        {s.stopsCount}
      </Card>

      <Card
        icon={<Clock className="h-4 w-4" />}
        label="Day span"
        caption={`${fmtTime(analysis.startT)} to ${fmtTime(analysis.endT)}`}
      >
        {fmtDuration(s.spanMs)}
      </Card>
    </div>
  );
}
