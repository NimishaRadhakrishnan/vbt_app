"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import SectionTabs from "@/components/SectionTabs";
import TeamOverview from "@/components/kpi/TeamOverview";
import Statements from "@/components/kpi/Statements";

const TABS = [{ id: "overview", label: "Team overview" }, { id: "statements", label: "Incentive statements" }] as const;

export default function TeamGoalsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("overview");
  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
    if (!isLoading && user && user.role === "field_officer") router.replace("/dashboard");
  }, [isLoading, user, router]);
  if (!user || user.role === "field_officer") return null;
  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <SectionTabs showSections />
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Team goals &amp; incentive</h1>
          <p className="text-sm text-slate-500 mt-1">{user.role === "admin" ? "See how every officer is doing, close the quarter, approve and mark incentives paid." : "See how your team is doing and their incentive statements."}</p>
        </div>
        <div className="flex gap-1 border-b border-slate-200" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 ${tab === t.id ? "border-green-700 text-green-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{t.label}</button>
          ))}
        </div>
        {tab === "overview" ? <TeamOverview /> : <Statements canWrite={user.role === "admin"} />}
      </div>
    </main>
  );
}
