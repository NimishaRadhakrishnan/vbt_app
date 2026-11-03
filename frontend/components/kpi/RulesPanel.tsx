"use client";

import React, { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Item, api, errMsg, rupees, send } from "./shared";

type Rules = {
  in_force_on: string;
  weights: { code: string; mode: string; weight: number; cap_pct: number; effective_from: string }[];
  levels: { level: number; sales_min_pct: number; sales_rate: number; coll_min_pct: number; coll_rate: number }[];
  entry_min_sales_pct: number; level_gap: number; level_version: string | null;
  grades: { grade: string; label: string; min_score: number }[];
  settings: Record<string, any>; versions: string[];
};

const p = (x: number) => Math.round(x * 1_000_000) / 10_000;      // 0.0025 -> 0.25
const f = (x: number) => x / 100;                                    // 0.25 -> 0.0025
const today = () => new Date().toISOString().slice(0, 10);

const SETTING_LABELS: Record<string, [string, "number" | "bool" | "pct"]> = {
  "kpi.conversion_window_days": ["Trial to paid: days a purchase still counts after the trial", "number"],
  "kpi.score_factor_max_pct": ["Highest score factor on the incentive (%)", "pct"],
  "kpi.active_dealer_min_orders": ["Orders a dealer needs in the period to count as active", "number"],
  "kpi.quarter_start_month": ["First month of the financial year (4 = April)", "number"],
  "kpi.field_incentive_enabled": ["Pay an incentive on the Field score", "bool"],
  "kpi.nudges_enabled": ["Send friendly goal reminders (max 1 a day)", "bool"],
  "kpi.entry_edit_days": ["Days an officer may edit their own entry", "number"],
  "kpi.live_days": ["Days full detail stays live", "number"],
  "kpi.archive_years": ["Years entries are kept read-only", "number"],
  "kpi.gps_retention_days": ["Days GPS route points are kept", "number"],
  "kpi.photo_archive_px": ["Old photos are shrunk to this width (px)", "number"],
};

export default function RulesPanel({ items }: { items: Item[] }) {
  const [rules, setRules] = useState<Rules | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [cap, setCap] = useState(120);
  const [eff, setEff] = useState(today());
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ officers: number; note: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Record<string, any>>({});

  const load = async () => {
    try {
      const r = await api<Rules>("/rules");
      setRules(r); setDraft(JSON.parse(JSON.stringify(r)));
      setSettings(r.settings);
      setCap(Math.round((r.weights[0]?.cap_pct ?? 1.2) * 100));
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };
  useEffect(() => { load(); }, []);
  if (!draft || !rules) return <p className="text-sm text-slate-400">{msg?.text ?? "Loading…"}</p>;

  const name = (code: string) => items.find((i) => i.code === code)?.name ?? code;
  const sum = (mode: string) => draft.weights.filter((w) => w.mode === mode).reduce((s, w) => s + w.weight, 0);
  const setW = (code: string, v: number) => setDraft({ ...draft, weights: draft.weights.map((w) => (w.code === code ? { ...w, weight: v } : w)) });
  const setL = (i: number, k: keyof Rules["levels"][0], v: number) =>
    setDraft({ ...draft, levels: draft.levels.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const marksOk = sum("field") === 100 && sum("sales") === 100;

  const body = () => ({
    effective_from: eff, reason,
    weights: draft.weights.map((w) => ({ code: w.code, weight: w.weight, cap_pct: cap / 100 })),
    levels: draft.levels, entry_min_sales_pct: draft.entry_min_sales_pct, level_gap: draft.level_gap,
    grades: draft.grades,
  });

  const check = async () => {
    setMsg(null);
    try { setPreview(await api<{ officers: number; note: string }>(`/rules/preview?effective_from=${eff}`)); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await send("/rules", "PUT", body());
      setMsg({ ok: true, text: `Saved from ${eff}. Earlier periods keep the rules they were calculated with.` });
      setPreview(null); setReason(""); await load();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); }
  };
  const saveSettings = async () => {
    setBusy(true); setMsg(null);
    try {
      const changed: Record<string, any> = {};
      for (const k of Object.keys(settings)) if (JSON.stringify(settings[k]) !== JSON.stringify(rules.settings[k])) changed[k] = settings[k];
      if (!Object.keys(changed).length) { setMsg({ ok: true, text: "No setting was changed." }); return; }
      await send("/settings", "PUT", { values: changed, reason: reason || "Settings change" });
      setMsg({ ok: true, text: "Settings saved and added to the change history." }); await load();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const num = "w-24 p-1.5 border rounded-md text-right text-sm border-slate-200";
  const card = "bg-white rounded-xl border border-slate-100 p-4 space-y-3";
  return (
    <div className="space-y-5">
      {msg && <div className={`p-3 rounded-lg text-sm border ${msg.ok ? "bg-success-50 text-success-800 border-success-200" : "bg-red-50 text-red-700 border-red-200"}`}>{msg.text}</div>}
      <p className="text-sm text-slate-500">Showing the rules in force today{rules.level_version ? ` (from ${rules.level_version})` : ""}. Changes start on the date you choose when you save; earlier periods are not touched.</p>

      {(["field", "sales"] as const).map((mode) => (
        <div key={mode} className={card}>
          <h3 className="font-bold text-slate-800">{mode === "field" ? "Field officer" : "Sales officer"} marks <span className={`text-sm ml-2 ${sum(mode) === 100 ? "text-success-700" : "text-red-600"}`}>total {sum(mode)} of 100</span></h3>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {draft.weights.filter((w) => w.mode === mode).map((w) => (
              <label key={w.code} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                <span className="inline-flex items-center gap-1">{name(w.code)}
                  <span title={items.find((i) => i.code === w.code)?.help ?? ""}><Info className="w-3.5 h-3.5 text-slate-400" /></span></span>
                <input type="number" min={0} value={w.weight} onChange={(e) => setW(w.code, Number(e.target.value))} className={num} />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className={card}>
        <h3 className="font-bold text-slate-800">Score cap</h3>
        <label className="flex items-center gap-3 text-sm text-slate-700">An item can earn at most
          <input type="number" min={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} className={num} /> % of its marks
        </label>
        <p className="text-xs text-slate-500">Example: with 120%, selling 300% of the focus products earns 18 of the 15 marks, not more.</p>
      </div>

      <div className={card}>
        <h3 className="font-bold text-slate-800">Incentive levels</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase"><tr>
              <th className="text-left p-2">Level</th><th className="p-2">Sales done (min %)</th><th className="p-2">Sales incentive (%)</th>
              <th className="p-2">Money collected (min %)</th><th className="p-2">Collection incentive (%)</th></tr></thead>
            <tbody>
              {draft.levels.map((l, i) => (
                <tr key={l.level} className="border-t border-slate-100">
                  <td className="p-2 font-bold">Level {l.level}</td>
                  {([["sales_min_pct", l.sales_min_pct], ["sales_rate", l.sales_rate], ["coll_min_pct", l.coll_min_pct], ["coll_rate", l.coll_rate]] as const).map(([k, v]) => (
                    <td key={k} className="p-2 text-center"><input type="number" step="0.01" min={0} value={p(v)} onChange={(e) => setL(i, k, f(Number(e.target.value)))} className={num} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-6 text-sm text-slate-700">
          <label className="flex items-center gap-2">No incentive if sales done is under
            <input type="number" min={0} value={p(draft.entry_min_sales_pct)} onChange={(e) => setDraft({ ...draft, entry_min_sales_pct: f(Number(e.target.value)) })} className={num} /> %</label>
          <label className="flex items-center gap-2">Level match: levels this far apart drop the higher one
            <input type="number" min={1} value={draft.level_gap} onChange={(e) => setDraft({ ...draft, level_gap: Number(e.target.value) })} className="w-16 p-1.5 border rounded-md text-right text-sm border-slate-200" /></label>
        </div>
        <ul className="text-xs text-slate-500 space-y-1 pt-1">
          {draft.levels.map((l) => (
            <li key={l.level}>Level {l.level} = sell at least {p(l.sales_min_pct)}% of your goal. You get {p(l.sales_rate)}% of your sales. On ₹10 lakh that is {rupees(1_000_000 * l.sales_rate)}.</li>
          ))}
        </ul>
      </div>

      <div className={card}>
        <h3 className="font-bold text-slate-800">Grades <span className="text-xs font-normal text-slate-500">(placeholders until the company confirms)</span></h3>
        <div className="flex flex-wrap gap-4">
          {draft.grades.map((g, i) => (
            <label key={g.grade} className="text-sm text-slate-700">{g.grade} · {g.label}
              <input type="number" min={0} value={g.min_score} onChange={(e) => setDraft({ ...draft, grades: draft.grades.map((x, j) => (j === i ? { ...x, min_score: Number(e.target.value) } : x)) })} className={`${num} block mt-1`} />
              <span className="text-[11px] text-slate-400">score from</span></label>
          ))}
        </div>
      </div>

      <div className={`${card} border-green-200`}>
        <h3 className="font-bold text-slate-800">Save marks, levels and grades</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold text-slate-600">Starts on
            <input type="date" value={eff} onChange={(e) => { setEff(e.target.value); setPreview(null); }} className="block mt-1 p-2 border rounded-lg text-sm" /></label>
          <label className="text-xs font-bold text-slate-600 flex-1 min-w-[220px]">Reason (required)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. New rates from management" className="block mt-1 p-2 border rounded-lg text-sm w-full" /></label>
          <button onClick={check} disabled={!marksOk || !reason.trim()} className="text-sm font-semibold border rounded-lg px-4 py-2 bg-white disabled:opacity-40">Check what changes</button>
        </div>
        {!marksOk && <p className="text-sm text-red-600">Marks must add up to 100 for both Field and Sales before you can save.</p>}
        {preview && (
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 space-y-2">
            <p><b>This changes the results of {preview.officers} officer{preview.officers === 1 ? "" : "s"}.</b> {preview.note}</p>
            <button onClick={save} disabled={busy} className="text-sm font-semibold text-white bg-green-700 rounded-lg px-4 py-2 disabled:opacity-40">Confirm and save from {eff}</button>
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="font-bold text-slate-800">Other settings</h3>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
          {Object.entries(SETTING_LABELS).map(([key, [label, kind]]) => key in settings && (
            <label key={key} className="flex items-center justify-between gap-3 text-sm text-slate-700">
              <span>{label}</span>
              {kind === "bool" ? (
                <input type="checkbox" checked={!!settings[key]} onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })} className="w-5 h-5" />
              ) : kind === "pct" ? (
                <input type="number" min={100} value={Math.round(Number(settings[key]) * 100)} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) / 100 })} className={num} />
              ) : (
                <input type="number" min={0} value={Number(settings[key])} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} className={num} />
              )}
            </label>
          ))}
        </div>
        <button onClick={saveSettings} disabled={busy} className="text-sm font-semibold text-white bg-green-700 rounded-lg px-4 py-2 disabled:opacity-40">Save settings</button>
        <p className="text-xs text-slate-500">Settings take effect straight away and are added to the change history (use the reason box above).</p>
      </div>
    </div>
  );
}
