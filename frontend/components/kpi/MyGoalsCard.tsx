"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api/client";
import { C, Overview, Ring, colorOf, elapsedShare, getOverview, itemLine, rupees, status } from "./officer/common";

/** Officer Dashboard card: one ring per goal, one line of advice, incentive so far. */
export default function MyGoalsCard() {
  const [o, setO] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"field" | "sales">("field");

  useEffect(() => {
    getOverview("month").then((d) => { setO(d); setTab(d.mode === "sales" ? "sales" : "field"); }).catch(() => setFailed(true));
  }, []);

  if (failed) return null;                     // the rest of the dashboard still works
  if (!o) return <div className="bg-white rounded-2xl border border-slate-100 p-5 text-sm text-slate-400">Loading your goals…</div>;

  const el = elapsedShare(o.period);
  const dismiss = () => {
    const id = o.nudge?.id;
    setO({ ...o, nudge: null });
    if (id) apiFetch(`/notifications/${id}/read`, { method: "POST" }).catch(() => undefined);
  };
  const block = tab === "sales" ? o.sales : o.field;
  const items = (block?.items ?? []).filter((i) => !i.skipped && i.goal > 0);
  const sales = o.sales;
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold text-slate-800">My Goals · this month</h3>
        <Link href="/dashboard/my-goals" className="text-sm font-semibold text-primary-700">See all</Link>
      </div>
      {o.nudge && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
          <p className="text-sm text-blue-900">{o.nudge.message}</p>
          <button onClick={dismiss} className="text-xs font-semibold text-blue-700 shrink-0">Got it</button>
        </div>
      )}
      {o.mode === "both" && (
        <div className="flex gap-2 mb-3">
          {(["field", "sales"] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1 rounded-full text-sm font-semibold ${tab === k ? "bg-primary-700 text-white" : "bg-slate-100 text-slate-600"}`}>
              {k === "field" ? "Field" : "Sales"}
            </button>
          ))}
        </div>
      )}
      {!o.ready || items.length === 0 ? (
        <p className="text-sm text-slate-500">{o.advice || "Your goals will show here once the office has set them."}</p>
      ) : (
        <div className="space-y-3">
          {items.slice(0, 4).map((i) => (
            <div key={i.code} className="flex items-center gap-3">
              <Ring pct={i.pct ?? 0} color={colorOf(status(i.pct, el))} size={60} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">{i.name}</p>
                <p className="text-xs text-slate-500">{itemLine(i, o.period)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {o.ready && <p className="mt-3 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{o.advice}</p>}
      {tab === "sales" && sales && (
        <div className="mt-3">
          {sales.waiting_for_figures ? (
            <p className="text-sm text-slate-500">Waiting for sales figures.</p>
          ) : sales.incentive ? (
            <>
              <p className="text-lg font-bold" style={{ color: C.done }}>{rupees(sales.incentive.earned_so_far_paise)} earned so far</p>
              <p className="text-xs text-slate-500">Level {sales.incentive.sales_level} sales · Level {sales.incentive.collection_level} collection</p>
              {sales.what_if?.message && <p className="text-xs text-slate-600 mt-1">{sales.what_if.message}</p>}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
