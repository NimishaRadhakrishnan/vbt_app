"use client";

import { useEffect, useRef } from "react";
import { Flag, MapPin, Navigation, WifiOff } from "lucide-react";
import type { Analysis, TimelineEvent } from "./types";
import { fmtDistance, fmtDuration, fmtTime } from "./format";

interface Props {
  analysis: Analysis | null;
  loading: boolean;
  currentT: number;
  /** Disable the "you are here" highlight (single point / very short days). */
  highlight: boolean;
  onSelect: (e: TimelineEvent) => void;
}

export function activeEventId(events: TimelineEvent[], t: number): string | null {
  let id: string | null = null;
  for (const e of events) {
    if (e.at <= t) id = e.id;
    else break;
  }
  return id;
}

function Row({ active, onClick, rail, children, label }: { active: boolean; onClick: () => void; rail: React.ReactNode; children: React.ReactNode; label: string }) {
  return (
    <li className="relative" data-event-active={active ? "true" : undefined}>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "step" : undefined}
        aria-label={label}
        className={`group flex w-full gap-3 rounded-lg border px-2 py-2 text-left transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 ${
          active ? "border-primary-200 bg-primary-50" : "border-transparent hover:bg-slate-50"
        }`}
      >
        {rail}
        <span className="min-w-0 flex-1">{children}</span>
      </button>
    </li>
  );
}

const railBase = "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full";

export default function Timeline({ analysis, loading, currentT, highlight, onSelect }: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeId = analysis && highlight ? activeEventId(analysis.events, currentT) : null;

  // Keep the current row in view inside the list, without scrolling the page.
  useEffect(() => {
    const box = listRef.current;
    if (!box || !activeId) return;
    const el = box.querySelector<HTMLElement>('[data-event-active="true"]');
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = Math.max(0, top - 8);
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 8;
  }, [activeId]);

  return (
    <section
      aria-label="Day timeline"
      className="flex h-[540px] flex-col rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <header className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Timeline</h3>
      </header>

      {loading || !analysis ? (
        <div className="flex-1 space-y-4 overflow-hidden p-4" aria-busy aria-label="Loading timeline">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div ref={listRef} className="relative flex-1 overflow-y-auto p-2">
          <ol className="relative">
            <span className="absolute bottom-4 left-[22px] top-4 w-px bg-slate-200" aria-hidden />
            {analysis.events.map((e) => {
              const active = e.id === activeId;
              switch (e.kind) {
                case "start": {
                  return (
                    <Row key={e.id} active={active} onClick={() => onSelect(e)} label={`Day started at ${fmtTime(e.at)}`} rail={<span className={`${railBase} bg-emerald-100 text-emerald-700`}><Flag className="h-4 w-4" aria-hidden /></span>}>
                      <span className="block text-sm font-semibold text-slate-900">Day started</span>
                      <span className="block text-xs text-slate-500">{fmtTime(e.at)} · first GPS ping</span>
                    </Row>
                  );
                }
                case "stop": {
                  const s = e.stop;
                  return (
                    <Row
                      key={e.id}
                      active={active}
                      onClick={() => onSelect(e)}
                      label={`Stop ${s.number}, ${s.placeName ?? "unknown location"}, ${fmtTime(s.arrival)} to ${fmtTime(s.departure)}`}
                      rail={<span className={`${railBase} bg-slate-900 text-xs font-semibold text-white`}>{s.number}</span>}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">{s.placeName ?? "Unknown location"}</span>
                          <span className="block text-xs text-slate-500">
                            {s.placeType ? `${s.placeType} · ` : ""}
                            {fmtTime(s.arrival)} to {fmtTime(s.departure)}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                          {fmtDuration(s.dwellMs)}
                        </span>
                      </span>
                    </Row>
                  );
                }
                case "travel": {
                  return (
                    <Row key={e.id} active={active} onClick={() => onSelect(e)} label={`Travelled ${fmtDistance(e.distanceM)} in ${fmtDuration(e.endAt - e.at)}`} rail={<span className={`${railBase} bg-blue-50 text-blue-600`}><Navigation className="h-4 w-4" aria-hidden /></span>}>
                      <span className="block text-sm text-slate-700">
                        Travelled <span className="font-semibold text-slate-900">{fmtDistance(e.distanceM)}</span>
                      </span>
                      <span className="block text-xs text-slate-500">
                        {fmtDuration(e.endAt - e.at)} · {fmtTime(e.at)} to {fmtTime(e.endAt)}
                      </span>
                    </Row>
                  );
                }
                case "gap": {
                  return (
                    <Row key={e.id} active={active} onClick={() => onSelect(e)} label={`No signal for ${fmtDuration(e.endAt - e.at)}`} rail={<span className={`${railBase} bg-slate-200 text-slate-600`}><WifiOff className="h-4 w-4" aria-hidden /></span>}>
                      <span className="block text-sm font-semibold text-slate-700">No signal {fmtDuration(e.endAt - e.at)}</span>
                      <span className="block text-xs text-slate-500">
                        {fmtTime(e.at)} to {fmtTime(e.endAt)} · position unknown
                      </span>
                    </Row>
                  );
                }
                case "end": {
                  return (
                    <Row key={e.id} active={active} onClick={() => onSelect(e)} label={`Day ended at ${fmtTime(e.at)}`} rail={<span className={`${railBase} bg-rose-100 text-rose-700`}><MapPin className="h-4 w-4" aria-hidden /></span>}>
                      <span className="block text-sm font-semibold text-slate-900">Day ended</span>
                      <span className="block text-xs text-slate-500">{fmtTime(e.at)} · last GPS ping</span>
                    </Row>
                  );
                }
              }
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
