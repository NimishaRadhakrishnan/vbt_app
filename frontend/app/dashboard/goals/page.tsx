"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import SectionTabs from "@/components/SectionTabs";
import GoalsGrid from "@/components/kpi/GoalsGrid";
import RulesPanel from "@/components/kpi/RulesPanel";
import SalesFigures from "@/components/kpi/SalesFigures";
import FocusProducts from "@/components/kpi/FocusProducts";
import History from "@/components/kpi/History";
import { Item, Officer, Region, api, errMsg } from "@/components/kpi/shared";

const TABS = [
  { id: "goals", label: "Goals" },
  { id: "rules", label: "Rules" },
  { id: "sales", label: "Sales & collection" },
  { id: "focus", label: "Focus products" },
  { id: "history", label: "Change history" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function GoalsAdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("goals");
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
    if (!isLoading && user && user.role !== "admin") router.replace("/dashboard");
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user || user.role !== "admin") return;
    Promise.all([api<Officer[]>("/officers"), api<Item[]>("/items")])
      .then(([o, i]) => { setOfficers(o); setItems(i); setReady(true); })
      .catch((e) => setError(errMsg(e)));
  }, [user]);

  // Regions are the territories the officers are assigned to.
  const regions: Region[] = useMemo(() => {
    const m = new Map<string, string>();
    officers.forEach((o) => o.region_ids.forEach((id, i) => m.set(id, o.regions[i] ?? "Region")));
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [officers]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <SectionTabs showSections />
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Goals &amp; Incentive</h1>
          <p className="text-sm text-slate-500 mt-1">Set goals, marks and incentive levels, enter sales figures, and choose focus products. Everything is calculated automatically from the officers&apos; daily entries.</p>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${tab === t.id ? "border-green-700 text-green-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{t.label}</button>
          ))}
        </div>
        {error && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}
        {!ready ? (!error && <p className="text-sm text-slate-400">Loading…</p>) : (
          <>
            {tab === "goals" && <GoalsGrid officers={officers} items={items} regions={regions} />}
            {tab === "rules" && <RulesPanel items={items} />}
            {tab === "sales" && <SalesFigures officers={officers} />}
            {tab === "focus" && <FocusProducts officers={officers} />}
            {tab === "history" && <History officers={officers} />}
          </>
        )}
      </div>
    </main>
  );
}
