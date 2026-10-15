"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Smartphone, ShieldCheck, ShieldX, RotateCcw, UserCheck, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import SectionTabs from "@/components/SectionTabs";

type Issue = {
  id: string; ref: string; user_id: string; officer_name: string; employee_id?: string | null;
  email?: string | null; phone?: string | null; issue_type: string; status: string;
  description?: string | null; attempted_device_id?: string | null; device_name?: string | null;
  registered_device_id?: string | null; account_active: boolean; login_status: string;
  ip_address?: string | null; attempt_count: number; last_attempt_at: string; created_at: string;
  resolution_action?: string | null; resolution_note?: string | null; resolved_by_name?: string | null;
  resolved_at?: string | null;
};
type Ev = { id: string; ref: string; officer_name: string; event_type: string; actor_name?: string | null; detail?: string | null; created_at: string };

const TYPE_LABEL: Record<string, string> = {
  device_mismatch: "Signing in from a different phone",
  account_inactive: "Account is deactivated",
  other: "Other sign-in problem",
};
const ACTION_LABEL: Record<string, string> = {
  approve_device: "Approved new phone", authorize_login: "Allowed sign-in", rectify: "Reset phone",
  reject: "Declined", created: "Request raised", attempt_again: "Tried again",
  attempt_after_reject: "Tried again after decline", admins_notified: "Admins notified", officer_notified: "Officer notified",
};
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");

export default function LoginRequestsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "handled" | "audit">("pending");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
    if (!authLoading && user && user.role !== "admin") router.replace("/dashboard");
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    try {
      if (tab === "audit") {
        setEvents((await apiFetch("/login-issues/audit?limit=300")) as Ev[]);
      } else {
        const q = tab === "pending" ? "?status_filter=pending" : "";
        const all = (await apiFetch(`/login-issues${q}`)) as Issue[];
        setIssues(tab === "pending" ? all : all.filter((i) => i.status !== "pending"));
      }
      setError("");
      setLoadedAt(new Date());
    } catch (e: any) {
      setError(e?.message || "Could not load requests.");
    }
  }, [tab]);

  // New requests appear on their own: refresh every 15 seconds.
  useEffect(() => {
    if (!user || user.role !== "admin") return;
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [user, load]);

  const act = async (i: Issue, action: string) => {
    const note = (notes[i.id] || "").trim();
    if ((action === "reject" || action === "rectify") && !note) {
      setError("Please write a short note first — the officer is shown it.");
      return;
    }
    setBusy(i.id + action);
    try {
      await apiFetch(`/login-issues/${i.id}/action`, { method: "POST", body: JSON.stringify({ action, note: note || null }) });
      setNotes((n) => ({ ...n, [i.id]: "" }));
      setError("");
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not complete that action.");
    } finally {
      setBusy(null);
    }
  };

  if (authLoading || !user) return <main className="p-6">Loading...</main>;

  const Btn = ({ i, action, icon, label, tone }: { i: Issue; action: string; icon: React.ReactNode; label: string; tone: string }) => (
    <button
      onClick={() => act(i, action)}
      disabled={busy !== null}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 ${tone}`}
    >
      {icon} {busy === i.id + action ? "Working…" : label}
    </button>
  );

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <SectionTabs showSections />
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Login Requests</h1>
            <p className="text-sm text-slate-500 mt-1">
              Officers who could not sign in (new phone, deactivated account). Decide here; the officer is told straight away.
            </p>
          </div>
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-slate-600 border rounded-lg px-3 py-2 bg-white">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
        {loadedAt && <p className="text-xs text-slate-400 -mt-4">Updated {loadedAt.toLocaleTimeString()} · refreshes every 15 seconds</p>}

        <div className="flex border-b border-slate-200">
          {([["pending", "Needs action"], ["handled", "Handled"], ["audit", "Audit log"]] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 font-medium text-sm ${tab === t ? "text-primary-700 border-b-2 border-primary-700" : "text-slate-500 hover:text-slate-700"}`}>
              {label}{t === "pending" && tab === "pending" && issues.length > 0 ? ` (${issues.length})` : ""}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 text-sm">{error}</div>}

        {tab !== "audit" && issues.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
            {tab === "pending" ? "Nothing waiting. New requests show up here by themselves." : "No handled requests yet."}
          </div>
        )}

        {tab !== "audit" && issues.map((i) => (
          <div key={i.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900 text-lg">{i.officer_name}</p>
                <p className="text-sm text-slate-500">
                  ID {i.employee_id || "—"} · {i.email || ""}{i.phone ? ` · ${i.phone}` : ""}
                </p>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${i.status === "pending" ? "bg-amber-100 text-amber-800" : i.status === "rejected" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                {i.status === "pending" ? "Waiting" : i.status === "rejected" ? "Declined" : "Resolved"} · ref {i.ref}
              </span>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Problem</p>
                <p className="font-medium text-slate-800">{TYPE_LABEL[i.issue_type] || i.issue_type}</p>
                {i.description && <p className="text-slate-500 mt-0.5">{i.description}</p>}
                <p className="text-slate-500 mt-1">Tried {i.attempt_count}× · last {fmt(i.last_attempt_at)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400 mb-1 flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" /> Device</p>
                <p className="font-medium text-slate-800">{i.device_name || "Name not sent"}</p>
                <p className="text-slate-500 break-all">Tried: <span className="font-mono text-xs">{i.attempted_device_id || "—"}</span></p>
                <p className="text-slate-500 break-all">Registered: <span className="font-mono text-xs">{i.registered_device_id || "none"}</span></p>
                {i.ip_address && <p className="text-slate-500">IP {i.ip_address}</p>}
              </div>
            </div>

            {i.status === "pending" ? (
              <>
                <input
                  value={notes[i.id] || ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))}
                  placeholder="Note for the officer (needed to decline or reset)"
                  maxLength={500}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  {i.issue_type === "device_mismatch" && (
                    <Btn i={i} action="approve_device" icon={<Smartphone className="w-4 h-4" />} label="Approve this phone" tone="bg-primary-700 text-white" />
                  )}
                  {i.issue_type !== "device_mismatch" && (
                    <Btn i={i} action="authorize_login" icon={<UserCheck className="w-4 h-4" />} label={i.issue_type === "account_inactive" ? "Switch account on" : "Allow sign-in"} tone="bg-primary-700 text-white" />
                  )}
                  <Btn i={i} action="rectify" icon={<RotateCcw className="w-4 h-4" />} label="Reset phone" tone="bg-slate-100 text-slate-800 border border-slate-300" />
                  <Btn i={i} action="reject" icon={<ShieldX className="w-4 h-4" />} label="Decline" tone="bg-red-50 text-red-700 border border-red-200" />
                </div>
                <p className="text-xs text-slate-400">
                  Approve this phone: registers it for the officer. Reset phone: clears the registered phone so the next sign-in registers whichever phone is used.
                </p>
              </>
            ) : (
              <div className="text-sm text-slate-600 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 mt-0.5 text-slate-400" />
                <span>
                  {ACTION_LABEL[i.resolution_action || ""] || i.resolution_action} by {i.resolved_by_name || "admin"} on {fmt(i.resolved_at)}
                  {i.resolution_note ? ` — “${i.resolution_note}”` : ""}
                </span>
              </div>
            )}
          </div>
        ))}

        {tab === "audit" && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 border-b">
                <tr><th className="p-3">When</th><th className="p-3">Officer</th><th className="p-3">Ref</th><th className="p-3">What happened</th><th className="p-3">By</th><th className="p-3">Detail</th></tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b hover:bg-slate-50">
                    <td className="p-3 text-slate-500">{fmt(e.created_at)}</td>
                    <td className="p-3 font-medium">{e.officer_name}</td>
                    <td className="p-3 font-mono text-xs">{e.ref}</td>
                    <td className="p-3">{ACTION_LABEL[e.event_type] || e.event_type}</td>
                    <td className="p-3">{e.actor_name || "System"}</td>
                    <td className="p-3 text-slate-500 whitespace-normal">{e.detail || "—"}</td>
                  </tr>
                ))}
                {events.length === 0 && <tr><td className="p-6 text-center text-slate-400" colSpan={6}>No activity yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
