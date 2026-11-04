"use client";

import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { C, Item, Ladder, Overview, fmt, num, rupees } from "./common";

/* ---------------------------------------------------------------- On-track line */
type Series = { goal: number; points: { date: string; actual: number; needed: number }[]; sentence: string };

export function PaceLine({ code, period }: { code: string; period: "month" | "quarter" }) {
  const [s, setS] = useState<Series | null>(null);
  useEffect(() => { apiFetch<Series>(`/kpi/me/series?item=${code}&period=${period}`).then(setS).catch(() => setS(null)); }, [code, period]);
  if (!s || s.points.length === 0) return <p className="text-sm text-slate-400">No days to show yet.</p>;
  const W = 320, H = 130, P = 8;
  const max = Math.max(s.goal, ...s.points.map((p) => p.actual), 1);
  const n = s.points.length;
  const x = (i: number) => P + (i / Math.max(n - 1, 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const last = s.points[n - 1]!;
  const color = last.actual >= last.needed ? C.done : last.actual >= last.needed * 0.9 ? C.track : C.push;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="On-track line">
        <line x1={P} y1={y(s.goal)} x2={W - P} y2={y(s.goal)} stroke={C.rail} />
        <polyline fill="none" stroke={C.muted} strokeDasharray="4 4" strokeWidth={1.5}
          points={s.points.map((p, i) => `${x(i)},${y(p.needed)}`).join(" ")} />
        <polyline fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round"
          points={s.points.map((p, i) => `${x(i)},${y(p.actual)}`).join(" ")} />
        <circle cx={x(n - 1)} cy={y(last.actual)} r={4} fill={color} />
      </svg>
      <p className="text-sm text-slate-600 mt-1">{s.sentence}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- Level ladder */
export function LevelLadder({ ladder, earned, salesPct, collPct }: { ladder: NonNullable<Ladder>; earned: number; salesPct?: number; collPct?: number }) {
  const rows = [...ladder.rows].sort((a, b) => b.level - a.level);
  const here = (lv: number, cur: number) => lv === cur;
  return (
    <div>
      <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 text-xs text-slate-500 mb-1"><span /><span>Sales</span><span>Collection</span></div>
      {[...rows, { level: 0 } as any].map((r) => (
        <div key={r.level} className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 items-stretch mb-1.5">
          <div className="flex items-center justify-center rounded-lg bg-slate-100 font-bold text-slate-700 text-sm">{r.level}</div>
          {(["sales", "collection"] as const).map((k) => {
            const cur = k === "sales" ? ladder.sales_level : ladder.collection_level;
            const you = here(r.level, cur);
            const reached = r.level <= cur;
            const needed = r.level === 0 ? 0 : k === "sales" ? r.sales_needed_paise : r.collection_needed_paise;
            const inc = r.level === 0 ? 0 : k === "sales" ? r.incentive_at_sales_level_paise : r.incentive_at_collection_level_paise;
            return (
              <div key={k} className={`rounded-lg px-2 py-1.5 text-xs border ${you ? "border-2" : "border-slate-100"}`}
                style={{ borderColor: you ? C.track : undefined, background: reached ? "#f0fdf4" : "#fff" }}>
                {you && <p className="font-bold" style={{ color: C.track }}>You are here</p>}
                {r.level > 0 && !reached && <p className="text-slate-700">{rupees(needed)} more to climb</p>}
                {r.level > 0 && <p className="text-slate-500">{reached && you ? `${rupees(earned)} earned` : `${rupees(inc)} if reached`}</p>}
                {r.level === 0 && !you && <p className="text-slate-400">Start</p>}
              </div>
            );
          })}
        </div>
      ))}
      {ladder.level_match_applied && <p className="text-xs text-slate-500 mt-1">One level was held back so Sales and Collection stay close together.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- Trial funnel */
export function TrialFunnel({ f }: { f: NonNullable<Overview["field"]>["trial_funnel"] }) {
  const steps = [["Visited", f.visited], ["Agreed for demo", f.agreed_demo], ["Trial given", f.trials], ["Paid", f.paid]] as const;
  const max = Math.max(f.visited, 1);
  return (
    <div className="space-y-2">
      {steps.map(([label, v], i) => (
        <div key={label}>
          <div className="flex justify-between text-sm"><span className="text-slate-700">{label}</span><span className="font-semibold">{num(v)}</span></div>
          <div className="h-3 rounded bg-slate-100"><div className="h-3 rounded" style={{ width: `${(v / max) * 100}%`, background: i === 3 ? C.done : C.track }} /></div>
        </div>
      ))}
      {f.waiting > 0 && <p className="text-xs text-slate-500">{f.waiting} trial farmer{f.waiting === 1 ? " is" : "s are"} still within the time to buy.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- Work calendar */
type Cal = { days: { date: string; visits: number; closed: boolean; kind: string; note: string | null }[]; max_visits: number; sentence: string };

export function WorkCalendar() {
  const [c, setC] = useState<Cal | null>(null);
  useEffect(() => { apiFetch<Cal>("/kpi/me/calendar").then(setC).catch(() => setC(null)); }, []);
  if (!c) return <p className="text-sm text-slate-400">Loading…</p>;
  const lead = (new Date(c.days[0]!.date + "T00:00:00").getDay() + 6) % 7;      // Monday first
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-400 mb-1">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }).map((_, i) => <span key={`b${i}`} />)}
        {c.days.map((d) => {
          const grey = d.kind === "holiday" || d.kind === "leave" || d.kind === "sunday";
          const a = d.kind === "work" ? 0.15 + 0.85 * Math.min(d.visits / c.max_visits, 1) : 0;
          return (
            <div key={d.date} title={d.note ?? (d.kind === "leave" ? "Leave" : `${d.visits} visits`)}
              className="aspect-square rounded-md flex items-center justify-center text-[11px]"
              style={{ background: grey ? "#e5e7eb" : d.kind === "future" ? "#fff" : d.visits ? `rgba(5,150,105,${a})` : "#f1f5f9",
                       border: d.kind === "future" ? "1px solid #f1f5f9" : "none", color: a > 0.6 ? "#fff" : C.ink }}>
              {Number(d.date.slice(8))}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-slate-600 mt-2">{c.sentence}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- Score bars */
export function ScoreBars({ items, onOpen }: { items: Item[]; onOpen: (i: Item) => void }) {
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <button key={i.code} onClick={() => onOpen(i)} className="w-full text-left" disabled={i.skipped}>
          <div className="flex justify-between text-sm">
            <span className="text-slate-700">{i.name}</span>
            <span className="font-semibold">{i.skipped ? "Not counted" : `${num(i.marks)} / ${num(i.weight)}`}{i.at_max && <span className="ml-1 text-xs" style={{ color: C.done }}>Max</span>}</span>
          </div>
          <div className="h-2.5 rounded bg-slate-100"><div className="h-2.5 rounded" style={{ width: `${i.max_marks ? Math.min(i.marks / i.max_marks, 1) * 100 : 0}%`, background: i.at_max ? C.done : C.track }} /></div>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- My best + Past */
export function MyBest() {
  const [rows, setRows] = useState<{ code: string; name: string; value: number; month: string }[] | null>(null);
  useEffect(() => { apiFetch<{ items: any[] }>("/kpi/me/best").then((d) => setRows(d.items)).catch(() => setRows([])); }, []);
  if (!rows) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-slate-500">Your best months will show here after your first full month.</p>;
  return (
    <div className="divide-y divide-slate-50">
      {rows.map((r) => (
        <div key={r.code} className="flex justify-between py-1.5 text-sm">
          <span className="text-slate-700">{r.name}</span>
          <span><b>{fmt(r.code, r.value)}</b> <span className="text-xs text-slate-400">{new Date(r.month).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })}</span></span>
        </div>
      ))}
    </div>
  );
}

type PastRow = { start: string; end: string; closed: boolean; score: number | null; grade: string | null; statement_status: string | null; final_amount_paise: number | null; waiting_for_figures: boolean };
export function PastList({ period }: { period: "month" | "quarter" }) {
  const [rows, setRows] = useState<PastRow[] | null>(null);
  useEffect(() => { apiFetch<{ periods: PastRow[] }>(`/kpi/me/past?period=${period}`).then((d) => setRows(d.periods)).catch(() => setRows([])); }, [period]);
  if (!rows) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-slate-500">Nothing yet. Finished {period}s will be listed here.</p>;
  return (
    <div className="divide-y divide-slate-50">
      {rows.map((r) => (
        <div key={r.start} className="flex justify-between py-2 text-sm">
          <span className="text-slate-700">{new Date(r.start).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}{period === "quarter" ? " quarter" : ""}</span>
          <span className="text-right">
            <b>{r.score == null ? "–" : `${num(r.score)} marks`}</b>{r.grade && <span className="ml-1 text-slate-500">· Grade {r.grade}</span>}
            {r.final_amount_paise != null && <span className="block text-xs" style={{ color: C.done }}>{rupees(r.final_amount_paise)}{r.statement_status === "paid" ? " paid" : ""}</span>}
            {r.waiting_for_figures && <span className="block text-xs text-slate-500">Sales figures were not in</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
