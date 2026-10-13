"use client";

import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api/client";

// "Stock left in the dealer's shop" - the dropdown version of the
// company's stock sheet. Every pack size is already its own row in the
// products table, named like "V-NITRO (Liquid 5 Lit)". The dropdowns
// Category > Product > Properties > Pack just split that name, so the
// admin keeps managing ONE product list (Products page) and this sheet
// follows it automatically.

type CatalogProduct = { id: string; name: string; category: string };
export type StockLine = { product_id: string; quantity_left: number };

type Parsed = { id: string; category: string; base: string; props: string; pack: string };

const parseProduct = (p: CatalogProduct): Parsed => {
  const m = p.name.match(/^(.*?)\s*\((.*)\)\s*$/);
  const base = (m?.[1] ?? p.name).trim();
  const variant = (m?.[2] ?? "").trim();
  const v = variant.match(/^([A-Za-z]+)\s+(\d.*)$/);
  return {
    id: p.id,
    category: p.category || "Other",
    base,
    props: v?.[1] ?? "Standard",
    pack: v?.[2] ?? (variant || "Single pack"),
  };
};

type Row = { key: number; category: string; base: string; props: string; productId: string; qty: string };

const selectCls =
  "w-full px-2 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-600";

export default function DealerStockSheet({
  onChange,
}: {
  onChange: (lines: StockLine[], problem: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<Parsed[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [nextKey, setNextKey] = useState(1);

  useEffect(() => {
    apiFetch<CatalogProduct[]>("/dealers/products/catalog")
      .then((list) => setCatalog(list.map(parseProduct)))
      .catch(() => setLoadError("Couldn't load the product list. You can still submit without the stock sheet."));
  }, []);

  const categories = useMemo(() => Array.from(new Set(catalog.map((c) => c.category))).sort(), [catalog]);

  const bases = (cat: string) =>
    Array.from(new Set(catalog.filter((c) => c.category === cat).map((c) => c.base))).sort();
  const propsFor = (cat: string, base: string) =>
    Array.from(new Set(catalog.filter((c) => c.category === cat && c.base === base).map((c) => c.props)));
  const packsFor = (cat: string, base: string, props: string) =>
    catalog.filter((c) => c.category === cat && c.base === base && c.props === props);

  // Tell the parent what the sheet holds: valid lines, plus the first
  // problem (half-filled or duplicated row) so submit can stop with a
  // clear message instead of the server rejecting it.
  useEffect(() => {
    const lines: StockLine[] = [];
    const seen = new Set<string>();
    let problem: string | null = null;
    for (const r of rows) {
      if (!r.productId && r.qty === "") continue; // untouched row
      if (!r.productId) { problem = "Pick the product pack in every stock sheet row."; break; }
      if (r.qty === "" || Number.isNaN(Number(r.qty)) || Number(r.qty) < 0) {
        problem = "Enter the quantity left (0 if none) in every stock sheet row."; break;
      }
      if (seen.has(r.productId)) { problem = "The same product pack is listed twice in the stock sheet."; break; }
      seen.add(r.productId);
      lines.push({ product_id: r.productId, quantity_left: Math.floor(Number(r.qty)) });
    }
    onChange(problem ? [] : lines, problem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const addRow = () => {
    setRows((r) => [...r, { key: nextKey, category: "", base: "", props: "", productId: "", qty: "" }]);
    setNextKey((k) => k + 1);
  };
  const patch = (key: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));

  const pickCategory = (key: number, category: string) =>
    patch(key, { category, base: "", props: "", productId: "" });
  const pickBase = (key: number, cat: string, base: string) => {
    const props = propsFor(cat, base);
    const only = props.length === 1 ? (props[0] ?? "") : "";
    const packs = only ? packsFor(cat, base, only) : [];
    patch(key, { base, props: only, productId: packs.length === 1 ? (packs[0]?.id ?? "") : "" });
  };
  const pickProps = (key: number, cat: string, base: string, props: string) => {
    const packs = packsFor(cat, base, props);
    patch(key, { props, productId: packs.length === 1 ? (packs[0]?.id ?? "") : "" });
  };

  return (
    <div className="space-y-3">
      {loadError && <p className="text-xs text-amber-700">{loadError}</p>}
      {rows.length === 0 && (
        <p className="text-xs text-slate-500">
          Add each product you saw in the dealer&apos;s shop and the quantity still left there.
        </p>
      )}
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end p-3 border border-slate-200 rounded-lg bg-white">
          <label className="text-xs text-slate-500">Category
            <select className={selectCls} value={r.category} onChange={(e) => pickCategory(r.key, e.target.value)}>
              <option value="">-- Select --</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Product
            <select className={selectCls} value={r.base} disabled={!r.category}
              onChange={(e) => pickBase(r.key, r.category, e.target.value)}>
              <option value="">-- Select --</option>
              {r.category && bases(r.category).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Properties
            <select className={selectCls} value={r.props} disabled={!r.base}
              onChange={(e) => pickProps(r.key, r.category, r.base, e.target.value)}>
              <option value="">-- Select --</option>
              {r.base && propsFor(r.category, r.base).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Pack size
            <select className={selectCls} value={r.productId} disabled={!r.props}
              onChange={(e) => patch(r.key, { productId: e.target.value })}>
              <option value="">-- Select --</option>
              {r.props && packsFor(r.category, r.base, r.props).map((p) => <option key={p.id} value={p.id}>{p.pack}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Qty left in shop
            <input type="number" min={0} inputMode="numeric" className={selectCls} value={r.qty}
              onChange={(e) => patch(r.key, { qty: e.target.value })} placeholder="0" />
          </label>
          <button type="button" onClick={() => remove(r.key)}
            className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50">
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={addRow}
        className="text-sm font-semibold text-green-700 border border-green-300 rounded-lg px-4 py-2 hover:bg-green-50">
        + Add product
      </button>
    </div>
  );
}
