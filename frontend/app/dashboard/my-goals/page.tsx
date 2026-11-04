"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { C, EntriesModal, Item, Overview, Panel, Ring, Sentence, colorOf, elapsedShare, getOverview, itemLine, rupees, status } from "@/components/kpi/officer/common";
import { LevelLadder, MyBest, PaceLine, PastList, ScoreBars, TrialFunnel, WorkCalendar } from "@/components/kpi/officer/charts";

const PACE_ITEMS = ["farmers_visited", "villages_covered", "demo_agreed", "trial_area"];

export default function MyGoalsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"month" | "quarter" | "past">("month");
  const [pastKind, setPastKind] = useState<"month" | "quarter">("month");
  const [mode, setMode] = useState<"field" | "sales">("field");
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Item | null>(null);
  const kind = tab === "quarter" ? "quarter" : "month";

  useEffect(() => {
    if (tab === "past") return;
    setO(null); setErr("");
    getOverview(kind).then((d) => { setO(d); if (d.mode === "sales") setMode("sales"); else if (d.mode === "field") setMode("field"); })
      .catch(() => setErr("Could not load your goals. Please check your connection and try again."));
  }, [tab, kind]);

  if (user && user.role !== "field_officer") return <p className="p-6 text-slate-500">My Goals is for field officers.</p>;

  const el = o ? elapsedShare(o.period) : 0;
  const block = o ? (mode === "sales" ? o.sales : o.field) : undefined;
  const counted = (block?.items ?? []).filter((i) => !i.skipped && i.goal > 0);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/dashboard" className="p-1 text-slate-500"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold text-slate-800">My Goals</h1>
      </div>
      <div className="flex gap-2">
        {([["month", "This month"], ["quarter", "This quarter"], ["past", "Past"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${tab === k ? "bg-primary-700 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>{l}</button>
        ))}
      </div>

      {tab === "past" ? (
        <>
          <div className="flex gap-2">{(["month", "quarter"] as const).map((k) => (
            <button key={k} onClick={() => setPastKind(k)} className={`px-3 py-1 rounded-full text-xs font-semibold ${pastKind === k ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}>{k === "month" ? "Months" : "Quarters"}</button>
          ))}</div>
          <Panel title="Past periods"><PastList period={pastKind} /><Sentence>Your money for a quarter shows here once the office has finished and approved it.</Sentence></Panel>
          <Panel title="My best"><MyBest /><Sentence>Your best month for each goal. The only person to beat is you.</Sentence></Panel>
        </>
      ) : err ? (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-3">{err}</p>
      ) : !o ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !o.ready ? (
        <Panel title="Your goals"><p className="text-sm text-slate-600">{o.advice}</p></Panel>
      ) : (
        <>
          {o.mode === "both" && (
            <div className="flex gap-2">{(["field", "sales"] as const).map((k) => (
              <button key={k} onClick={() => setMode(k)} className={`px-3 py-1 rounded-full text-sm font-semibold ${mode === k ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}>{k === "field" ? "Field" : "Sales"}</button>
            ))}</div>
          )}
          <p className="text-sm bg-white border border-slate-100 rounded-xl px-4 py-3 text-slate-700">{o.advice}</p>

          <Panel title="Goal rings">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {counted.map((i) => (
                <button key={i.code} onClick={() => setOpen(i)} className="flex flex-col items-center text-center gap-1">
                  <Ring pct={i.pct ?? 0} color={colorOf(status(i.pct, el))} />
                  <span className="text-sm font-semibold text-slate-800">{i.name}</span>
                  <span className="text-xs text-slate-500">{itemLine(i, o.period)}</span>
                </button>
              ))}
            </div>
            <Sentence>Green is done, blue is on track, amber needs a push. Tap a ring to see the entries behind it.</Sentence>
          </Panel>

          {mode === "field" && o.field && (
            <>
              {counted.filter((i) => PACE_ITEMS.includes(i.code)).slice(0, 2).map((i) => (
                <Panel key={i.code} title={`On-track line · ${i.name}`}><PaceLine code={i.code} period={kind} /></Panel>
              ))}
              <Panel title="Trial funnel"><TrialFunnel f={o.field.trial_funnel} /><Sentence>How many farmers moved from a visit to a demo, a trial and a purchase.</Sentence></Panel>
            </>
          )}

          {mode === "sales" && o.sales && (
            <Panel title="Level ladder">
              {o.sales.waiting_for_figures ? <p className="text-sm text-slate-600">Waiting for sales figures. They will show here as soon as the office adds them.</p>
                : o.sales.ladder && o.sales.incentive ? (
                  <>
                    <p className="text-lg font-bold mb-2" style={{ color: C.done }}>{rupees(o.sales.incentive.earned_so_far_paise)} earned so far</p>
                    <LevelLadder ladder={o.sales.ladder} earned={o.sales.incentive.earned_so_far_paise} />
                    {o.sales.what_if?.message && <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 mt-3">{o.sales.what_if.message}</p>}
                    <Sentence>Each step shows the money needed to climb and what you would earn there, at today&apos;s score.</Sentence>
                  </>
                ) : <p className="text-sm text-slate-600">No sales goal has been set yet.</p>}
            </Panel>
          )}

          {tab === "month" && <Panel title="Work calendar"><WorkCalendar /></Panel>}

          <Panel title={`My score · ${block ? Math.round(block.score) : 0} marks`}>
            <ScoreBars items={block?.items ?? []} onOpen={(i) => setOpen(i)} />
            <Sentence>Each bar is the marks earned out of the marks it carries. &quot;Max&quot; means you have earned the most it can give.</Sentence>
          </Panel>
          <Panel title="My best"><MyBest /><Sentence>Your best month for each goal. The only person to beat is you.</Sentence></Panel>
        </>
      )}
      {open && <EntriesModal item={open} period={kind} onClose={() => setOpen(null)} />}
    </div>
  );
}
