"use client";

import React from "react";
import { apiFetch } from "@/lib/api/client";

export type Item = {
  code: string; name: string; help: string | null; unit: string | null; weight: number; marks: number; max_marks: number;
  skipped: boolean; at_max: boolean; done: number; goal: number; pct: number | null; left: number; extra: number;
};
export type Ladder = {
  rows: { level: number; sales_min_pct: number; coll_min_pct: number; sales_needed_paise: number; collection_needed_paise: number;
    incentive_at_sales_level_paise: number; incentive_at_collection_level_paise: number }[];
  sales_level: number; collection_level: number; level_match_applied: boolean; entry_min_sales_pct: number;
} | null;
export type Overview = {
  period: { type: "month" | "quarter"; start: string; end: string; status: string; days_total: number; days_left: number; working_days_left: number };
  mode: "field" | "sales" | "both"; ready: boolean; advice: string; calculated_at?: string; nudge?: { id: string; message: string } | null;
  field?: { score: number; items: Item[]; trial_funnel: { visited: number; agreed_demo: number; trials: number; paid: number; waiting: number } };
  sales?: {
    score: number; grade: string | null; grade_label: string | null; items: Item[]; waiting_for_figures: boolean;
    sales_paise: number; collection_paise: number; sales_goal_paise: number; collection_goal_paise: number;
    incentive?: { sales_level: number; collection_level: number; level_match_applied: boolean; entry_rule_applied: boolean; earned_so_far_paise: number; score_factor: number };
    what_if?: { message: string | null };
    ladder?: Ladder;
  };
};

export const getOverview = (period: "month" | "quarter") => apiFetch<Overview>(`/kpi/me/overview?period=${period}`);

/** Colours: green = done, blue = on track, amber = needs a push. Never red. */
export const C = { done: "#059669", track: "#2563eb", push: "#d97706", rail: "#e2e8f0", ink: "#334155", muted: "#64748b" };

export function status(pct: number | null, elapsed: number): "done" | "track" | "push" {
  if (pct == null) return "track";
  if (pct >= 1) return "done";
  return pct >= elapsed * 0.9 ? "track" : "push";
}
export const colorOf = (s: "done" | "track" | "push") => C[s];

/** Share of the period already gone (0-1). */
export const elapsedShare = (p: Overview["period"]) => Math.min(1, Math.max(0, (p.days_total - p.days_left) / Math.max(p.days_total, 1)));

export const rupees = (paise: number) => "₹" + Math.round(paise / 100).toLocaleString("en-IN");
export const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 1 }));
export const isMoney = (code: string) => code === "sales_done" || code === "money_collected";
export const fmt = (code: string, v: number) => (isMoney(code) ? "₹" + Math.round(v).toLocaleString("en-IN") : code === "trial_to_paid" ? `${Math.round(v)}%` : num(v));

export function Ring({ pct, color, size = 76, label }: { pct: number; color: string; size?: number; label?: string }) {
  const r = size / 2 - 7, c = 2 * Math.PI * r, shown = Math.min(Math.max(pct, 0), 1);
  return (
    <svg width={size} height={size} role="img" aria-label={label ?? `${Math.round(pct * 100)} percent`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.rail} strokeWidth={7} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={`${c * shown} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size / 4.4} fontWeight={700} fill={C.ink}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

export function Sentence({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-600 mt-2">{children}</p>;
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <h3 className="text-base font-bold text-slate-800 mb-3">{title}</h3>
      {children}
    </section>
  );
}

/** "12 of 20 done · 8 left · 9 days left" */
export function itemLine(i: Item, p: Overview["period"]) {
  const left = i.extra > 0 ? `${fmt(i.code, i.extra)} extra` : `${fmt(i.code, i.left)} left`;
  return `${fmt(i.code, i.done)} of ${fmt(i.code, i.goal)} done · ${left} · ${p.days_left} day${p.days_left === 1 ? "" : "s"} left`;
}

export type Entries = { code: string; count: number; rows: { title: string; subtitle: string; date: string | null }[] };

export function EntriesModal({ item, period, onClose }: { item: Item; period: "month" | "quarter"; onClose: () => void }) {
  const [data, setData] = React.useState<Entries | null>(null);
  const [err, setErr] = React.useState("");
  React.useEffect(() => {
    apiFetch<Entries>(`/kpi/me/entries?item=${item.code}&period=${period}`).then(setData).catch(() => setErr("Could not load the list. Please try again."));
  }, [item.code, period]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <p className="font-bold text-slate-800">{item.name}</p>
            <p className="text-xs text-slate-500">{data ? `${data.count} entr${data.count === 1 ? "y" : "ies"}` : "Loading…"}</p>
          </div>
          <button onClick={onClose} className="text-sm font-semibold text-primary-700">Close</button>
        </div>
        <div className="overflow-y-auto p-2">
          {err && <p className="p-3 text-sm text-amber-700">{err}</p>}
          {data && data.rows.length === 0 && <p className="p-3 text-sm text-slate-500">Nothing here yet for this period.</p>}
          {data?.rows.map((r, i) => (
            <div key={i} className="px-3 py-2 border-b border-slate-50 flex justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{r.title}</p>
                <p className="text-xs text-slate-500">{r.subtitle}</p>
              </div>
              {r.date && <p className="text-xs text-slate-400 shrink-0">{new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
