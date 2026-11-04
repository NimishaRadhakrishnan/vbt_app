"use client";

import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { errMsg } from "./shared";
import { BreakdownModal } from "./Statements";

type Heat = { officer_id: string; name: string; work_mode: string; region: string; score: number | null; cells: Record<string, number | null> };
type Overview = {
  period: { id: string; start: string; end: string; status: string };
  items: { code: string; name: string }[]; heat: Heat[];
  totals: { sales_paise: number; sales_goal_paise: number; collection_paise: number; collection_goal_paise: number; incentive_payable_paise: number };
  level_spread: { level: number; officers: number }[];
  trend: { year: number; month: number; sales_paise: number; collection_paise: number; goal_paise: number }[];
  regions: { region: string; sales_paise: number; goal_paise: number; pct: number | null }[];
};
type Period = { id: string; start: string; end: string; status: string };

const inr = (p: number) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Shade by % done. Blue-green scale; no red. */
function shade(p: number | null | undefined): React.CSSProperties {
  if (p == null) return { background: "#f1f5f9", color: "#94a3b8" };
  const a = Math.min(p, 1.2) / 1.2;
  return { background: `rgba(5,150,105,${0.12 + a * 0.75})`, color: a > 0.55 ? "#fff" : "#064e3b" };
}

function Bars({ rows, max, fmt }: { rows: { label: string; value: number; sub?: string }[]; max: number; fmt: (v: number) => string }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-sm"><span className="text-slate-700">{r.label}</span><span className="font-semibold">{fmt(r.value)}</span></div>
          <div className="h-2.5 rounded bg-slate-100"><div className="h-2.5 rounded bg-blue-600" style={{ width: `${max ? Math.min(r.value / max, 1) * 100 : 0}%` }} /></div>
          {r.sub && <p className="text-xs text-slate-400">{r.sub}</p>}
        </div>
      ))}
    </div>
  );
}

export default function TeamOverview() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [pid, setPid] = useState("");
  const [mode, setMode] = useState("");
  const [region, setRegion] = useState("");
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Heat | null>(null);

  useEffect(() => {
    apiFetch<{ periods: Period[] }>("/kpi/statements/periods").then((r) => {
      setPeriods(r.periods);
    }).catch((e) => setErr(errMsg(e)));
  }, []);
  useEffect(() => {
    setD(null); setErr("");
    apiFetch<Overview>(`/kpi/team-overview?kind=quarter${pid ? `&period_id=${pid}` : ""}`).then(setD).catch((e) => setErr(errMsg(e)));
  }, [pid]);

  const regions = useMemo(() => Array.from(new Set((d?.heat ?? []).map((h) => h.region))).sort(), [d]);
  const rows = (d?.heat ?? []).filter((h) => (!mode || h.work_mode === mode) && (!region || h.region === region));
  const cols = (d?.items ?? []).filter((i) => rows.some((r) => r.cells[i.code] !== undefined));
  const t = d?.totals;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm text-slate-600">Quarter
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="block border border-slate-300 rounded-lg px-3 py-1.5 mt-1">
            <option value="">This quarter</option>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.start} to {p.end}{p.status === "closed" ? " (closed)" : ""}</option>)}
          </select></label>
        <label className="text-sm text-slate-600">Work mode
          <select value={mode} onChange={(e) => setMode(e.target.value)} className="block border border-slate-300 rounded-lg px-3 py-1.5 mt-1">
            <option value="">All</option><option value="field">Field</option><option value="sales">Sales</option><option value="both">Both</option></select></label>
        <label className="text-sm text-slate-600">Region
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="block border border-slate-300 rounded-lg px-3 py-1.5 mt-1">
            <option value="">All</option>{regions.map((r) => <option key={r}>{r}</option>)}</select></label>
      </div>
      {err && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{err}</div>}
      {!d ? (!err && <p className="text-sm text-slate-400">Loading…</p>) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[["Sales vs goal", t!.sales_paise, t!.sales_goal_paise], ["Collection vs goal", t!.collection_paise, t!.collection_goal_paise]].map(([l, a, g]) => (
              <div key={l as string} className="bg-white rounded-xl border border-slate-100 p-4">
                <p className="text-xs text-slate-500">{l as string}</p>
                <p className="text-xl font-bold text-slate-800">{inr(a as number)}</p>
                <p className="text-xs text-slate-500">of {inr(g as number)}{(g as number) ? ` · ${Math.round(((a as number) / (g as number)) * 100)}%` : ""}</p>
              </div>))}
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <p className="text-xs text-slate-500">Incentive payable this quarter</p>
              <p className="text-xl font-bold text-emerald-700">{inr(t!.incentive_payable_paise)}</p>
            </div>
          </div>

          <section className="bg-white rounded-xl border border-slate-100 p-4 overflow-x-auto">
            <h3 className="font-bold text-slate-800 mb-1">Who is where</h3>
            <p className="text-sm text-slate-500 mb-3">Each box is the share of the goal done. Darker is further along; grey means no goal. Click an officer to see the full breakdown.</p>
            {rows.length === 0 ? <p className="text-sm text-slate-500">No officers match.</p> : (
              <table className="text-sm border-separate border-spacing-1 min-w-full">
                <thead><tr><th className="text-left font-semibold text-slate-600 pr-3">Officer</th>
                  {cols.map((c) => <th key={c.code} className="font-medium text-xs text-slate-500 px-1 max-w-[90px]">{c.name}</th>)}
                  <th className="font-medium text-xs text-slate-500">Score</th></tr></thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.officer_id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(h)}>
                      <td className="pr-3 py-1 whitespace-nowrap text-slate-800">{h.name}<span className="text-xs text-slate-400"> · {h.region}</span></td>
                      {cols.map((c) => {
                        const v = h.cells[c.code];
                        return <td key={c.code} className="text-center rounded px-2 py-1 text-xs font-semibold" style={shade(v)}>{v == null ? "–" : `${Math.round(v * 100)}%`}</td>;
                      })}
                      <td className="text-center font-semibold">{h.score == null ? "–" : Math.round(h.score)}</td>
                    </tr>))}
                </tbody>
              </table>)}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <section className="bg-white rounded-xl border border-slate-100 p-4">
              <h3 className="font-bold text-slate-800 mb-3">Level spread</h3>
              <Bars rows={d.level_spread.map((l) => ({ label: `Level ${l.level}`, value: l.officers }))} max={Math.max(...d.level_spread.map((l) => l.officers), 1)} fmt={(v) => `${v} officer${v === 1 ? "" : "s"}`} />
              <p className="text-sm text-slate-500 mt-2">How many officers are on each sales level.</p>
            </section>
            <section className="bg-white rounded-xl border border-slate-100 p-4">
              <h3 className="font-bold text-slate-800 mb-3">Team by month</h3>
              <Bars rows={d.trend.map((m) => ({ label: `${MONTHS[m.month - 1]} ${m.year}`, value: m.sales_paise, sub: `goal ${inr(m.goal_paise)}` }))}
                max={Math.max(...d.trend.flatMap((m) => [m.sales_paise, m.goal_paise]), 1)} fmt={inr} />
              <p className="text-sm text-slate-500 mt-2">Sales each month against the goal shown under it.</p>
            </section>
            <section className="bg-white rounded-xl border border-slate-100 p-4">
              <h3 className="font-bold text-slate-800 mb-3">Regions</h3>
              <Bars rows={d.regions.map((r) => ({ label: r.region, value: (r.pct ?? 0) * 100 }))} max={Math.max(...d.regions.map((r) => (r.pct ?? 0) * 100), 100)} fmt={(v) => `${Math.round(v)}%`} />
              <p className="text-sm text-slate-500 mt-2">Sales as a share of goal in each region.</p>
            </section>
          </div>
        </>
      )}
      {open && d && <BreakdownModal officerId={open.officer_id} name={open.name} periodId={d.period.id} onClose={() => setOpen(null)} />}
    </div>
  );
}
