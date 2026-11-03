"use client";

import React, { useEffect, useState } from "react";
import { Officer, api, errMsg } from "./shared";

type Entry = { id: string; entity: string; action: string; old: any; new: any; reason: string | null; at: string; by: string | null };

const ENTITY: Record<string, string> = {
  goal: "Goal", rules: "Rules", settings: "Settings", sales_figure: "Sales figure",
  focus_product_plan: "Focus product", month_weight: "Season weights",
};

function describe(e: Entry, name: (id: string) => string): string {
  const n = e.new ?? {}; const o = e.old ?? {};
  switch (e.entity) {
    case "goal": return `${name(n.officer_id)} · ${n.item} · ${String(n.month).padStart(2, "0")}/${n.year}: ${o.value ?? "not set"} → ${n.value}`;
    case "sales_figure": return `${name(n.officer_id)} · ${String(n.month).padStart(2, "0")}/${n.year}: sales ₹${(n.sales ?? 0).toLocaleString("en-IN")}, collected ₹${(n.collection ?? 0).toLocaleString("en-IN")}${o.sales !== undefined ? ` (was ₹${o.sales.toLocaleString("en-IN")} / ₹${o.collection.toLocaleString("en-IN")})` : ""}`;
    case "focus_product_plan": return e.action === "delete" ? `${name(o.officer_id)} · line removed (was ${o.expected} ${o.unit})` : `${name(n.officer_id)} · expected ${n.expected} ${n.unit}${o.expected !== undefined ? ` (was ${o.expected})` : ""}`;
    case "rules": return `Rules starting ${n.effective_from ?? ""} changed`;
    case "settings": return Object.keys(n).map((k) => `${k.replace("kpi.", "")}: ${JSON.stringify(o[k])} → ${JSON.stringify(n[k])}`).join("; ");
    case "month_weight": return `Season weights for ${n.year} changed`;
    default: return e.action;
  }
}

export default function History({ officers }: { officers: Officer[] }) {
  const [entity, setEntity] = useState("");
  const [officer, setOfficer] = useState("");
  const [rows, setRows] = useState<Entry[]>([]);
  const [err, setErr] = useState("");
  const name = (id: string) => officers.find((o) => o.id === id)?.name ?? "Officer";
  useEffect(() => {
    const q = new URLSearchParams({ limit: "200" });
    if (entity) q.set("entity", entity);
    if (officer) q.set("officer_id", officer);
    api<Entry[]>(`/history?${q}`).then((r) => { setRows(r); setErr(""); }).catch((e) => setErr(errMsg(e)));
  }, [entity, officer]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-slate-100">
        <label className="text-xs font-bold text-slate-600">What
          <select value={entity} onChange={(e) => setEntity(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm">
            <option value="">Everything</option>{Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-600">Officer
          <select value={officer} onChange={(e) => setOfficer(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm">
            <option value="">All officers</option>{officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <p className="text-sm text-slate-500 flex-1 min-w-[200px]">Every change to goals, rules, figures and focus products: who, when, what it was and what it became. This list is never deleted.</p>
      </div>
      {err && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{err}</div>}
      <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr>
            <th className="text-left p-3">When</th><th className="text-left p-3">Who</th><th className="text-left p-3">What</th><th className="text-left p-3">Change</th><th className="text-left p-3">Reason</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No changes recorded yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="p-3 whitespace-nowrap text-slate-500">{new Date(r.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="p-3">{r.by ?? "System"}</td>
                <td className="p-3">{ENTITY[r.entity] ?? r.entity} <span className="text-xs text-slate-400">({r.action})</span></td>
                <td className="p-3 text-slate-700">{describe(r, name)}</td>
                <td className="p-3 text-slate-500">{r.reason ?? "—"}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
