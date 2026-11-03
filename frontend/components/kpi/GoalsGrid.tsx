"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, Copy, Users, Save, CalendarRange } from "lucide-react";
import {
  Goal, Item, Officer, Region, api, downloadTemplate, errMsg, monthLabel, quarterOptions, send, uploadFile, ymParts,
} from "./shared";

type ImportRow = { row: number; officer?: string; item: string; year: number; month: number; old: number | null; new: number | null; status: string; error?: string };
type ImportResult = { new: number; changed: number; same: number; skipped: number; errors: number; total: number; rows: ImportRow[]; saved?: { changed: number; officers: number } };

const key = (o: string, c: string, ym: string) => `${o}|${c}|${ym}`;

export default function GoalsGrid({ officers, items, regions }: { officers: Officer[]; items: Item[]; regions: Region[] }) {
  const quarters = useMemo(() => quarterOptions(4), []);
  const [qi, setQi] = useState(2);                       // index 2 = this quarter
  const months = useMemo(() => quarters[qi]?.months ?? [], [quarters, qi]);
  const goalItems = items.filter((i) => i.has_goal);
  const [code, setCode] = useState(goalItems[0]?.code ?? "farmers_visited");
  const item = goalItems.find((i) => i.code === code) ?? goalItems[0]!;
  const [region, setRegion] = useState("");
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [yearly, setYearly] = useState("");
  const [srcOfficer, setSrcOfficer] = useState("");
  const [check, setCheck] = useState<{ file: File; result: ImportResult } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api<Goal[]>(`/goals?months=${months.join(",")}`);
      const map: Record<string, number> = {};
      rows.forEach((g) => { map[key(g.officer_id, g.code, `${g.year}-${String(g.month).padStart(2, "0")}`)] = g.value; });
      setGoals(map);
      setEdits({});
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  }, [months]);
  useEffect(() => { load(); }, [load]);

  const shown = officers.filter((o) =>
    (item.mode === "field" ? o.work_mode !== "sales" : o.work_mode !== "field") &&
    (!region || o.region_ids.includes(region)));

  const val = (o: string, ym: string) => {
    const k = key(o, code, ym);
    return k in edits ? edits[k] : goals[k] !== undefined ? String(goals[k]) : "";
  };
  const total = (o: string) => months.reduce((s, ym) => s + (Number(val(o, ym)) || 0), 0);
  const dirty = Object.keys(edits).length;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); await load(); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const save = () => run(async () => {
    const cells = Object.entries(edits).filter(([, v]) => v.trim() !== "").map(([k, v]) => {
      const [officer_id = "", c = "", ym = ""] = k.split("|"); const [y, m] = ymParts(ym);
      return { officer_id, code: c, year: y, month: m, value: Number(v) };
    });
    const r = await send<{ changed: number }>("/goals", "PUT", { cells, reason: reason || undefined });
    return `Saved. ${r.changed} goal${r.changed === 1 ? "" : "s"} changed and added to the change history.`;
  });

  const fyYear = () => { const [y, m] = ymParts(months[0] ?? "2026-04"); return m >= 4 ? y : y - 1; };
  const split = () => run(async () => {
    const r = await send<{ officers: number; changed: number }>("/goals/split-yearly", "POST", {
      code, fy_year: fyYear(), yearly_value: Number(yearly), officer_ids: shown.map((o) => o.id), reason: reason || undefined,
    });
    return `Yearly goal split into months for ${r.officers} officer${r.officers === 1 ? "" : "s"} (${r.changed} month goals changed).`;
  });
  const copyLast = () => run(async () => {
    const r = await send<{ changed: number; officers: number }>("/goals/copy-last-year", "POST", {
      months: months.join(","), officer_ids: shown.map((o) => o.id), reason: reason || undefined });
    return r.changed ? `Copied ${r.changed} goals from last year for ${r.officers} officers. Months that already had a goal were kept.` : "Nothing to copy: last year has no goals for these months, or they are already filled.";
  });
  const applyRegion = () => run(async () => {
    if (!srcOfficer || !region) throw new Error("Pick a region (top filter) and the officer to copy from.");
    const r = await send<{ officers: number; changed: number }>("/goals/apply-to-region", "POST", {
      source_officer_id: srcOfficer, region_id: region, months: months.join(","), reason: reason || undefined });
    return `Copied to ${r.officers} other officers in the region (${r.changed} goals changed).`;
  });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try { setCheck({ file: f, result: await uploadFile<ImportResult>("/goals/import?dry_run=true", f) }); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const confirmImport = async () => {
    if (!check) return;
    setBusy(true);
    try {
      const r = await uploadFile<ImportResult>(`/goals/import?dry_run=false&reason=${encodeURIComponent(reason || "Excel import")}`, check.file);
      setMsg({ ok: true, text: `Imported. ${r.saved?.changed ?? 0} goals saved for ${r.saved?.officers ?? 0} officers.` });
      setCheck(null); await load();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const unit = item.unit_label ? ` (${item.unit_label})` : "";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-slate-100">
        <label className="text-xs font-bold text-slate-600">Quarter
          <select value={qi} onChange={(e) => setQi(Number(e.target.value))} className="block mt-1 p-2 border rounded-lg text-sm">
            {quarters.map((q, i) => <option key={i} value={i}>{q.label}{i === 2 ? " · this quarter" : ""}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">Region
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm">
            <option value="">All regions</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => downloadTemplate(`/goals/template?months=${months.join(",")}`, "goals-template.xlsx").catch((e) => setMsg({ ok: false, text: errMsg(e) }))}
            className="flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 bg-white text-slate-700"><Download className="w-4 h-4" /> Excel template</button>
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 bg-white text-slate-700"><Upload className="w-4 h-4" /> Upload Excel</button>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {goalItems.map((i) => (
          <button key={i.code} onClick={() => { setCode(i.code); setEdits({}); }}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${i.code === code ? "bg-green-700 text-white border-green-700" : "bg-white text-slate-600 border-slate-200"}`}>
            {i.name}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-500">{item.help} Goal is set per month{unit}; the quarter goal is the sum of its months.</p>

      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-slate-100">
        <label className="text-xs font-bold text-slate-600">Yearly goal{unit} for the {shown.length} officers shown
          <input type="number" min={0} value={yearly} onChange={(e) => setYearly(e.target.value)} placeholder="e.g. 1200"
            className="block mt-1 p-2 border rounded-lg text-sm w-44" />
        </label>
        <button onClick={split} disabled={busy || !yearly || !shown.length}
          className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-700 disabled:opacity-40 rounded-lg px-3 py-2"><CalendarRange className="w-4 h-4" /> Split into months</button>
        <button onClick={copyLast} disabled={busy}
          className="flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 bg-white text-slate-700"><Copy className="w-4 h-4" /> Copy last year&apos;s goals</button>
        <div className="flex items-end gap-2">
          <label className="text-xs font-bold text-slate-600">Apply one officer&apos;s goals to the region
            <select value={srcOfficer} onChange={(e) => setSrcOfficer(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm">
              <option value="">Copy from…</option>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <button onClick={applyRegion} disabled={busy || !region || !srcOfficer}
            className="flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 bg-white text-slate-700 disabled:opacity-40"><Users className="w-4 h-4" /> Apply to all in region</button>
        </div>
      </div>

      {msg && <div className={`p-3 rounded-lg text-sm border ${msg.ok ? "bg-success-50 text-success-800 border-success-200" : "bg-red-50 text-red-700 border-red-200"}`}>{msg.text}</div>}

      <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Officer</th>
              {months.map((ym) => <th key={ym} className="p-3 text-right">{monthLabel(ym)}</th>)}
              <th className="p-3 text-right">Quarter goal</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No officers work in this mode{region ? " in this region" : ""}.</td></tr>}
            {shown.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="p-3"><span className="font-semibold text-slate-800">{o.name}</span>
                  <span className="block text-[11px] text-slate-400">{o.employee_id ?? "no employee ID"} · {o.work_mode} · {o.regions.join(", ") || "no region"}</span></td>
                {months.map((ym) => (
                  <td key={ym} className="p-2 text-right">
                    <input type="number" min={0} value={val(o.id, ym)} onChange={(e) => setEdits({ ...edits, [key(o.id, code, ym)]: e.target.value })}
                      className={`w-28 p-1.5 border rounded-md text-right ${key(o.id, code, ym) in edits ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} />
                  </td>
                ))}
                <td className="p-3 text-right font-bold text-slate-800">{total(o.id).toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 sticky bottom-3 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 shadow-sm">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for this change (optional, saved in history)"
          className="flex-1 min-w-[220px] p-2 border rounded-lg text-sm" />
        <span className="text-sm text-slate-500">{dirty ? `${dirty} unsaved change${dirty === 1 ? "" : "s"}` : "No unsaved changes"}</span>
        <button onClick={save} disabled={busy || !dirty}
          className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-700 disabled:opacity-40 rounded-lg px-4 py-2"><Save className="w-4 h-4" /> Save changes</button>
      </div>

      <SeasonWeights regions={regions} defaultRegion={region} fyYear={fyYear()} />

      {check && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col">
            <div className="p-5 border-b">
              <h3 className="font-bold text-lg text-slate-900">Check before saving</h3>
              <p className="text-sm text-slate-600 mt-1">
                {check.result.new} new · {check.result.changed} changed · {check.result.same} unchanged · {check.result.skipped} blank ·{" "}
                <span className={check.result.errors ? "text-red-600 font-bold" : ""}>{check.result.errors} with problems</span>
              </p>
            </div>
            <div className="overflow-auto p-5 text-sm">
              {check.result.rows.filter((r) => r.status === "error" || r.status === "changed" || r.status === "new").slice(0, 200).map((r) => (
                <div key={r.row} className={`py-1.5 border-b border-slate-50 ${r.status === "error" ? "text-red-700" : "text-slate-700"}`}>
                  Row {r.row}: {r.officer ?? r.item} · {r.item} · {String(r.month).padStart(2, "0")}/{r.year} ·{" "}
                  {r.status === "error" ? r.error : r.old !== null ? `${r.old} → ${r.new}` : `new ${r.new}`}
                </div>
              ))}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button onClick={() => setCheck(null)} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
              <button onClick={confirmImport} disabled={busy || check.result.errors > 0 || (check.result.new + check.result.changed) === 0}
                className="px-4 py-2 text-sm font-semibold text-white bg-green-700 rounded-lg disabled:opacity-40">
                {check.result.errors ? "Fix the problems and upload again" : `Save ${check.result.new + check.result.changed} goals`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Season weights: how a yearly goal is shared across months for a region. Equal by default. */
function SeasonWeights({ regions, defaultRegion, fyYear }: { regions: Region[]; defaultRegion: string; fyYear: number }) {
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState(defaultRegion);
  const [w, setW] = useState<number[]>(Array(12).fill(1));
  const [msg, setMsg] = useState("");
  useEffect(() => { if (defaultRegion) setRegion(defaultRegion); }, [defaultRegion]);
  useEffect(() => {
    if (!open || !region) return;
    api<{ month: number; weight: number }[]>(`/month-weights?region_id=${region}&year=${fyYear}`)
      .then((r) => setW(r.map((x) => x.weight))).catch(() => undefined);
  }, [open, region, fyYear]);
  const save = async () => {
    try {
      await send(`/month-weights?region_id=${region}&year=${fyYear}`, "PUT", { weights: w.map((weight, i) => ({ month: i + 1, weight })) });
      setMsg("Saved. New yearly splits for this region will follow these weights.");
    } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4">
      <button onClick={() => setOpen(!open)} className="text-sm font-semibold text-slate-700">{open ? "▾" : "▸"} Season weights (how a yearly goal is shared across months)</button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-slate-500">A bigger number gives that month a bigger share. Leave all at 1 to share equally. Applies to the year starting {fyYear}.</p>
          <select value={region} onChange={(e) => setRegion(e.target.value)} className="p-2 border rounded-lg text-sm">
            <option value="">Pick a region…</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-2">
            {w.map((v, i) => (
              <label key={i} className="text-[11px] font-bold text-slate-500 text-center">{["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][i]}
                <input type="number" min={0} step="0.1" value={v} onChange={(e) => setW(w.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                  className="w-full mt-1 p-1.5 border rounded-md text-center text-sm" />
              </label>
            ))}
          </div>
          <button onClick={save} disabled={!region} className="text-sm font-semibold text-white bg-green-700 disabled:opacity-40 rounded-lg px-4 py-2">Save weights</button>
          {msg && <p className="text-sm text-slate-600">{msg}</p>}
        </div>
      )}
    </div>
  );
}
