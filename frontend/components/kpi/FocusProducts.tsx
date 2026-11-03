"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Officer, api, errMsg, quarterOptions, rupees, send } from "./shared";

type Product = { id: string; name: string; sku: string };
type Line = { id: string; officer_id: string; product_id: string; product: string; expected: number; unit: string; actual: number; done: boolean };

export default function FocusProducts({ officers }: { officers: Officer[] }) {
  const quarters = useMemo(() => quarterOptions(4), []);
  const [qi, setQi] = useState(2);
  const on = (quarters[qi]?.months[0] ?? "2026-04") + "-01";
  const [products, setProducts] = useState<Product[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [closed, setClosed] = useState(false);
  const [product, setProduct] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [expected, setExpected] = useState("");
  const [unit, setUnit] = useState<"rupees" | "units">("rupees");
  const [officerFilter, setOfficerFilter] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sellers = officers.filter((o) => o.work_mode !== "field");
  const name = (id: string) => officers.find((o) => o.id === id)?.name ?? "—";

  useEffect(() => { api<Product[]>("/products").then(setProducts).catch((e) => setMsg({ ok: false, text: errMsg(e) })); }, []);
  const load = useCallback(async () => {
    try {
      const r = await api<{ period: { status: string }; rows: Line[] }>(`/focus-products?on=${on}`);
      setLines(r.rows); setClosed(r.period.status === "closed");
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  }, [on]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setMsg(null);
    try {
      const r = await send<{ changed: number }>("/focus-products", "PUT", { on, product_id: product, officer_ids: picked, expected: Number(expected), unit });
      setMsg({ ok: true, text: `Saved for ${r.changed} officer${r.changed === 1 ? "" : "s"}.` }); setExpected(""); await load();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Remove this focus product line?")) return;
    try { await api(`/focus-products/${id}`, { method: "DELETE" }); await load(); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };

  const shown = officerFilter ? lines.filter((l) => l.officer_id === officerFilter) : lines;
  const expTotal = shown.reduce((s, l) => s + l.expected, 0);
  const actTotal = shown.reduce((s, l) => s + l.actual, 0);
  const fmt = (n: number, u: string) => (u === "rupees" ? rupees(n) : `${n.toLocaleString("en-IN")} units`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-slate-100">
        <label className="text-xs font-bold text-slate-600">Quarter
          <select value={qi} onChange={(e) => setQi(Number(e.target.value))} className="block mt-1 p-2 border rounded-lg text-sm">
            {quarters.map((q, i) => <option key={i} value={i}>{q.label}{i === 2 ? " · this quarter" : ""}</option>)}</select></label>
        <p className="text-sm text-slate-500 flex-1 min-w-[220px]">Pick a focus product and the expected sales for each officer. Actual sales fill in by themselves from orders.</p>
      </div>
      {msg && <div className={`p-3 rounded-lg text-sm border ${msg.ok ? "bg-success-50 text-success-800 border-success-200" : "bg-red-50 text-red-700 border-red-200"}`}>{msg.text}</div>}
      {closed && <div className="p-3 rounded-lg text-sm bg-amber-50 border border-amber-200 text-amber-900">This quarter is closed. Reopen it before changing the plan.</div>}

      {!closed && (
        <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
          <h3 className="font-bold text-slate-800">Add a focus product</h3>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-bold text-slate-600">Product (from the product list)
              <select value={product} onChange={(e) => setProduct(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm min-w-[220px]">
                <option value="">Choose…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="text-xs font-bold text-slate-600">Expected sales per officer
              <input type="number" min={0} value={expected} onChange={(e) => setExpected(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm w-40" /></label>
            <label className="text-xs font-bold text-slate-600">In
              <select value={unit} onChange={(e) => setUnit(e.target.value as "rupees" | "units")} className="block mt-1 p-2 border rounded-lg text-sm">
                <option value="rupees">Rupees (₹)</option><option value="units">Units</option></select></label>
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <p className="text-xs font-bold text-slate-600">Officers</p>
              <button className="text-xs text-green-700 font-semibold" onClick={() => setPicked(sellers.map((o) => o.id))}>Select all</button>
              <button className="text-xs text-slate-500 font-semibold" onClick={() => setPicked([])}>Clear</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {sellers.map((o) => (
                <label key={o.id} className={`text-sm px-3 py-1.5 rounded-full border cursor-pointer ${picked.includes(o.id) ? "bg-green-700 text-white border-green-700" : "bg-white text-slate-600 border-slate-200"}`}>
                  <input type="checkbox" className="hidden" checked={picked.includes(o.id)} onChange={() => setPicked(picked.includes(o.id) ? picked.filter((x) => x !== o.id) : [...picked, o.id])} />{o.name}</label>
              ))}
              {sellers.length === 0 && <p className="text-sm text-slate-400">No officers work in Sales or Both mode.</p>}
            </div>
          </div>
          <button onClick={add} disabled={!product || !picked.length || expected === ""}
            className="flex items-center gap-1.5 text-sm font-semibold text-white bg-green-700 disabled:opacity-40 rounded-lg px-4 py-2"><Plus className="w-4 h-4" /> Save for {picked.length} officer{picked.length === 1 ? "" : "s"}</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
        <label className="font-bold text-xs text-slate-600">Show
          <select value={officerFilter} onChange={(e) => setOfficerFilter(e.target.value)} className="ml-2 p-1.5 border rounded-lg text-sm font-normal">
            <option value="">All officers</option>{sellers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <span>{shown.length} lines · {shown.filter((l) => l.done).length} done · expected {fmt(expTotal, "rupees")} · actual {fmt(actTotal, "rupees")} · {expTotal ? Math.round((actTotal / expTotal) * 100) : 0}% overall</span>
      </div>
      <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr>
            <th className="text-left p-3">Product</th><th className="text-left p-3">Officer</th><th className="p-3 text-right">Expected</th><th className="p-3 text-right">Actual</th><th className="p-3 text-right">Left / Extra</th><th className="p-3">Status</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No focus products planned for this quarter yet.</td></tr>}
            {shown.map((l) => {
              const diff = l.actual - l.expected;
              return (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="p-3 font-semibold text-slate-800">{l.product}</td><td className="p-3">{name(l.officer_id)}</td>
                  <td className="p-3 text-right">{fmt(l.expected, l.unit)}</td><td className="p-3 text-right">{fmt(l.actual, l.unit)}</td>
                  <td className={`p-3 text-right ${diff >= 0 ? "text-success-700" : "text-slate-600"}`}>{diff >= 0 ? `${fmt(diff, l.unit)} extra` : `${fmt(-diff, l.unit)} left`}</td>
                  <td className="p-3 text-center">{l.done ? <span className="text-success-700 font-semibold">Done</span> : <span className="text-blue-700">On the way</span>}</td>
                  <td className="p-3 text-right">{!closed && <button onClick={() => remove(l.id)} aria-label="Remove" className="text-red-600"><Trash2 className="w-4 h-4" /></button>}</td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
