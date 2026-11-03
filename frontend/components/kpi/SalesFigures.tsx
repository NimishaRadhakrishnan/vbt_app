"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, Upload, Save } from "lucide-react";
import { Officer, api, downloadTemplate, errMsg, send, uploadFile } from "./shared";

type Fig = { officer_id: string; sales: number; collection: number; source: string };
type Row = { row: number; officer?: string; status: string; error?: string; sales: number | null; collection: number | null; old?: { sales: number; collection: number } | null };
type Result = { new: number; changed: number; same: number; skipped: number; errors: number; rows: Row[]; saved?: { changed: number } };

export default function SalesFigures({ officers }: { officers: Officer[] }) {
  const now = new Date();
  const [ym, setYm] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [figs, setFigs] = useState<Record<string, Fig>>({});
  const [edits, setEdits] = useState<Record<string, { sales?: string; collection?: string }>>({});
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ file: File; result: Result } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [year = 0, month = 1] = ym.split("-").map(Number);
  const sellers = officers.filter((o) => o.work_mode !== "field");

  const load = useCallback(async () => {
    try {
      const r = await api<Fig[]>(`/sales-figures?year=${year}&month=${month}`);
      setFigs(Object.fromEntries(r.map((x) => [x.officer_id, x]))); setEdits({});
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  }, [year, month]);
  useEffect(() => { load(); }, [load]);

  const cur = (id: string, k: "sales" | "collection") => edits[id]?.[k] ?? (figs[id] ? String(figs[id]?.[k]) : "");
  const setE = (id: string, k: "sales" | "collection", v: string) => setEdits({ ...edits, [id]: { ...edits[id], [k]: v } });
  const dirty = Object.keys(edits).length;

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const rows = Object.keys(edits).map((id) => {
        const s = cur(id, "sales"), c = cur(id, "collection");
        if (s === "" || c === "") throw new Error("Enter both Sales and Money collected for each officer you change (use 0 if nothing).");
        return { officer_id: id, year, month, sales: Number(s), collection: Number(c) };
      });
      const r = await send<{ changed: number }>("/sales-figures", "PUT", { rows, reason: reason || undefined });
      setMsg({ ok: true, text: `Saved for ${r.changed} officer${r.changed === 1 ? "" : "s"}. Their incentive updates within a minute.` }); await load();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try { setCheck({ file: f, result: await uploadFile<Result>("/sales-figures/import?dry_run=true", f) }); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const confirm = async () => {
    if (!check) return;
    setBusy(true);
    try {
      const r = await uploadFile<Result>(`/sales-figures/import?dry_run=false&reason=${encodeURIComponent(reason || "Excel import")}`, check.file);
      setMsg({ ok: true, text: `Imported figures for ${r.saved?.changed ?? 0} officers.` }); setCheck(null); await load();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-slate-100">
        <label className="text-xs font-bold text-slate-600">Month
          <input type="month" value={ym} onChange={(e) => setYm(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm" /></label>
        <p className="text-sm text-slate-500 flex-1 min-w-[200px]">Enter the month&apos;s sales and money collected in rupees. A quarter&apos;s figures are the sum of its three months.</p>
        <button onClick={() => downloadTemplate(`/sales-figures/template?year=${year}&month=${month}`, "sales-figures-template.xlsx").catch((e) => setMsg({ ok: false, text: errMsg(e) }))}
          className="flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 bg-white"><Download className="w-4 h-4" /> Excel template</button>
        <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-sm border rounded-lg px-3 py-2 bg-white"><Upload className="w-4 h-4" /> Upload Excel</button>
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {msg && <div className={`p-3 rounded-lg text-sm border ${msg.ok ? "bg-success-50 text-success-800 border-success-200" : "bg-red-50 text-red-700 border-red-200"}`}>{msg.text}</div>}
      <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr>
            <th className="text-left p-3">Officer</th><th className="p-3 text-right">Sales (₹)</th><th className="p-3 text-right">Money collected (₹)</th><th className="p-3 text-left">Status</th></tr></thead>
          <tbody>
            {sellers.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400">No officers work in Sales or Both mode.</td></tr>}
            {sellers.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="p-3"><span className="font-semibold text-slate-800">{o.name}</span><span className="block text-[11px] text-slate-400">{o.employee_id ?? "no employee ID"}</span></td>
                {(["sales", "collection"] as const).map((k) => (
                  <td key={k} className="p-2 text-right"><input type="number" min={0} value={cur(o.id, k)} onChange={(e) => setE(o.id, k, e.target.value)}
                    className={`w-36 p-1.5 border rounded-md text-right ${edits[o.id]?.[k] !== undefined ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} /></td>
                ))}
                <td className="p-3 text-xs text-slate-500">{figs[o.id] ? (figs[o.id]?.source === "import" ? "Imported" : "Entered") : <span className="text-amber-700 font-semibold">Waiting for figures</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 sticky bottom-3 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 shadow-sm">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason / source (optional, saved in history)" className="flex-1 min-w-[220px] p-2 border rounded-lg text-sm" />
        <span className="text-sm text-slate-500">{dirty ? `${dirty} officer${dirty === 1 ? "" : "s"} changed` : "No unsaved changes"}</span>
        <button onClick={save} disabled={busy || !dirty} className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-700 disabled:opacity-40 rounded-lg px-4 py-2"><Save className="w-4 h-4" /> Save figures</button>
      </div>
      {check && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
            <div className="p-5 border-b"><h3 className="font-bold text-lg">Check before saving</h3>
              <p className="text-sm text-slate-600 mt-1">{check.result.new} new · {check.result.changed} changed · {check.result.same} unchanged · <span className={check.result.errors ? "text-red-600 font-bold" : ""}>{check.result.errors} with problems</span></p></div>
            <div className="overflow-auto p-5 text-sm">
              {check.result.rows.filter((r) => r.status !== "same" && r.status !== "skipped").map((r) => (
                <div key={r.row} className={`py-1.5 border-b border-slate-50 ${r.status === "error" ? "text-red-700" : "text-slate-700"}`}>
                  Row {r.row}: {r.officer ?? "—"} · {r.status === "error" ? r.error : `sales ₹${r.sales?.toLocaleString("en-IN")}, collected ₹${r.collection?.toLocaleString("en-IN")}${r.old ? ` (was ₹${r.old.sales.toLocaleString("en-IN")} / ₹${r.old.collection.toLocaleString("en-IN")})` : ""}`}
                </div>))}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button onClick={() => setCheck(null)} className="px-4 py-2 text-sm border rounded-lg">Cancel</button>
              <button onClick={confirm} disabled={busy || check.result.errors > 0 || check.result.new + check.result.changed === 0}
                className="px-4 py-2 text-sm font-semibold text-white bg-green-700 rounded-lg disabled:opacity-40">{check.result.errors ? "Fix the problems and upload again" : "Save figures"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
