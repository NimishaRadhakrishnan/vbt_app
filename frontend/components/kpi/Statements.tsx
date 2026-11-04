"use client";

import React, { useCallback, useEffect, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/api/client";
import { downloadAuthenticatedFile } from "@/lib/api/download";
import { errMsg } from "./shared";

type Period = { id: string; start: string; end: string; status: string; statements: number; finished: boolean };
type Row = {
  officer_id: string; name: string; employee_id: string | null; work_mode: string; statement_id: string | null;
  sales_level: number | null; collection_level: number | null; level_match_applied: boolean; score: number | null; grade: string | null;
  final_paise: number | null; waiting_for_figures: boolean; status: "draft" | "approved" | "paid"; status_label: string; paid_on: string | null; has_incentive: boolean;
};
type List = { period: { id: string; start: string; end: string; closed: boolean; finished: boolean }; rows: Row[]; total_paise: number };
type Section = { title: string; rows: string[][]; table?: boolean };

const inr = (p: number | null) => (p == null ? "–" : "₹" + Math.round(p / 100).toLocaleString("en-IN"));
const BADGE: Record<string, string> = { draft: "bg-slate-100 text-slate-600", approved: "bg-blue-100 text-blue-700", paid: "bg-emerald-100 text-emerald-700" };
const post = <T,>(path: string, body: unknown) => apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });

export function BreakdownModal({ officerId, name, periodId, onClose }: { officerId: string; name: string; periodId: string; onClose: () => void }) {
  const [d, setD] = useState<{ sections: Section[]; status_label: string; frozen: boolean } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    apiFetch<any>(`/kpi/statements/officer/${officerId}?period_id=${periodId}`).then(setD).catch((e) => setErr(errMsg(e)));
  }, [officerId, periodId]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b flex justify-between items-center">
          <div><p className="font-bold text-slate-800">{name}</p>
            <p className="text-xs text-slate-500">{d ? (d.frozen ? "Frozen when the quarter was closed" : "Live figures - the quarter is still open") : ""}</p></div>
          <button onClick={onClose} className="text-sm font-semibold text-primary-700">Close</button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4">
          {err && <p className="text-sm text-amber-700">{err}</p>}
          {!d && !err && <p className="text-sm text-slate-400">Loading…</p>}
          {d?.sections.map((s) => (
            <div key={s.title}>
              <p className="font-semibold text-slate-700 text-sm mb-1">{s.title}</p>
              <table className="w-full text-sm border border-slate-100">
                <tbody>{s.rows.map((r, i) => (
                  <tr key={i} className={s.table && i === 0 ? "bg-emerald-50 font-semibold" : "border-t border-slate-50"}>
                    {r.map((c, j) => <td key={j} className={`px-2 py-1 ${j === 0 ? "text-slate-700" : "text-right text-slate-800"}`}>{c}</td>)}
                  </tr>))}</tbody>
              </table>
            </div>))}
        </div>
      </div>
    </div>
  );
}

export default function Statements({ canWrite }: { canWrite: boolean }) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [pid, setPid] = useState("");
  const [list, setList] = useState<List | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [offerForce, setOfferForce] = useState(false);

  useEffect(() => {
    apiFetch<{ periods: Period[] }>("/kpi/statements/periods").then((r) => { setPeriods(r.periods); if (r.periods[0]) setPid(r.periods[0].id); })
      .catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, []);
  const load = useCallback(() => {
    if (!pid) return;
    apiFetch<List>(`/kpi/statements?period_id=${pid}`).then(setList).catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, [pid]);
  useEffect(() => { setList(null); load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); setOfferForce(false); load(); }
    catch (e) { const t = errMsg(e); setMsg({ ok: false, text: t }); setOfferForce(/missing/i.test(t)); }
    finally { setBusy(false); }
  };
  const dl = (ext: "xlsx" | "pdf") => run(() => downloadAuthenticatedFile(`${API_BASE_URL}/kpi/statements/export.${ext}?period_id=${pid}`, `incentive-statements.${ext}`), "Download started.");

  const closed = !!list?.period.closed;
  const btn = "px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-sm text-slate-600">Quarter
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="block border border-slate-300 rounded-lg px-3 py-1.5 mt-1">
            {periods.map((p) => <option key={p.id} value={p.id}>{p.start} to {p.end}{p.status === "closed" ? " (closed)" : ""}</option>)}
          </select></label>
        <div className="flex flex-wrap gap-2 ml-auto">
          {canWrite && !closed && <button disabled={busy || !list?.period.finished} onClick={() => run(() => post("/kpi/statements/close", { period_id: pid }), "Quarter closed. Statements are frozen.")}
            title={list?.period.finished ? "" : "The quarter has not finished yet"} className={`${btn} bg-primary-700 text-white`}>Close quarter</button>}
          {canWrite && closed && <button disabled={busy} onClick={() => run(() => post("/kpi/statements/approve-all", { period_id: pid }), "All Draft statements approved.")} className={`${btn} bg-blue-700 text-white`}>Approve all</button>}
          {canWrite && closed && <button disabled={busy} onClick={() => setReopening(true)} className={`${btn} border border-slate-300 text-slate-700`}>Reopen</button>}
          <button disabled={busy || !pid} onClick={() => dl("xlsx")} className={`${btn} border border-slate-300 text-slate-700`}>Export Excel</button>
          <button disabled={busy || !pid} onClick={() => dl("pdf")} className={`${btn} border border-slate-300 text-slate-700`}>Export PDF</button>
        </div>
      </div>

      {msg && <div className={`p-3 rounded-lg text-sm border ${msg.ok ? "bg-success-50 text-success-800 border-success-200" : "bg-red-50 text-red-700 border-red-200"}`}>
        {msg.text}
        {offerForce && <button className="ml-3 underline font-semibold" onClick={() => run(() => post("/kpi/statements/close", { period_id: pid, allow_missing: true }), "Quarter closed. Officers without figures get no incentive.")}>Close anyway</button>}
      </div>}
      {!closed && list && <p className="text-sm text-slate-500">This quarter is still open, so these are live Draft figures and can change. {list.period.finished ? "You can close it now." : "You can close it after its last day."}</p>}

      {reopening && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 space-y-2">
          <p className="text-sm text-amber-900">Reopening removes the frozen statements so numbers can be corrected. Write the reason (it is saved in the change history).</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          <div className="flex gap-2">
            <button disabled={busy || !reason.trim()} className={`${btn} bg-amber-600 text-white`}
              onClick={() => run(async () => { await post("/kpi/statements/reopen", { period_id: pid, reason }); setReopening(false); setReason(""); }, "Quarter reopened.")}>Reopen quarter</button>
            <button className={`${btn} text-slate-600`} onClick={() => setReopening(false)}>Cancel</button>
          </div>
        </div>)}

      {!list ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs"><tr>
              {["Officer", "Sales level", "Collection level", "Level match applied", "Score", "Grade", "Final ₹", "Status", ""].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.officer_id} className="border-t border-slate-50 hover:bg-slate-50">
                  <td className="px-3 py-2 cursor-pointer text-slate-800" onClick={() => setOpen(r)}>{r.name}<span className="text-xs text-slate-400"> {r.employee_id}</span></td>
                  <td className="px-3 py-2">{r.has_incentive ? (r.sales_level ?? "–") : "–"}</td>
                  <td className="px-3 py-2">{r.has_incentive ? (r.collection_level ?? "–") : "–"}</td>
                  <td className="px-3 py-2">{r.has_incentive ? (r.level_match_applied ? "Yes" : "No") : "–"}</td>
                  <td className="px-3 py-2">{r.score == null ? "–" : Math.round(r.score)}</td>
                  <td className="px-3 py-2">{r.grade ?? "–"}</td>
                  <td className="px-3 py-2 font-semibold">{r.has_incentive ? (r.waiting_for_figures ? "Waiting for figures" : inr(r.final_paise)) : "No incentive (Field)"}</td>
                  <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${BADGE[r.status]}`}>{r.status_label}</span>{r.paid_on && <span className="text-xs text-slate-400"> {r.paid_on}</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {canWrite && r.statement_id && r.status === "draft" && <button className="text-blue-700 font-semibold mr-2" disabled={busy} onClick={() => run(() => post(`/kpi/statements/${r.statement_id}/approve`, {}), "Approved.")}>Approve</button>}
                    {canWrite && r.statement_id && r.status === "approved" && (payFor === r.statement_id ? (
                      <span className="inline-flex gap-1 items-center"><input type="date" value={payDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPayDate(e.target.value)} className="border border-slate-300 rounded px-1 py-0.5 text-xs" />
                        <button className="text-emerald-700 font-semibold" disabled={busy} onClick={() => run(async () => { await post(`/kpi/statements/${r.statement_id}/paid`, { paid_on: payDate }); setPayFor(null); }, "Marked as paid.")}>Save</button></span>
                    ) : <button className="text-emerald-700 font-semibold" onClick={() => setPayFor(r.statement_id)}>Mark paid</button>)}
                  </td>
                </tr>))}
            </tbody>
            <tfoot><tr className="border-t border-slate-200 font-bold"><td className="px-3 py-2" colSpan={6}>Total payable</td><td className="px-3 py-2">{inr(list.total_paise)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>)}
      {open && list && <BreakdownModal officerId={open.officer_id} name={open.name} periodId={list.period.id} onClose={() => setOpen(null)} />}
    </div>
  );
}
