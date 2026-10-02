"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, User, Activity, ClipboardList, MapPin, Calendar,
  TrendingUp, Mail, CheckCircle,
} from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import MomentumWidget from "@/components/MomentumWidget";

type TabKey = "overview" | "activity" | "tasks" | "visits" | "attendance" | "analytics";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: User },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "tasks", label: "Tasks", icon: ClipboardList },
  { key: "visits", label: "Visits", icon: MapPin },
  { key: "attendance", label: "Attendance", icon: Calendar },
  { key: "analytics", label: "Analytics", icon: TrendingUp },
];

function StatusPill({ children, tone }: { children: React.ReactNode; tone: "green" | "amber" | "slate" | "red" }) {
  const toneClasses = {
    green: "bg-green-50 text-green-700 border-green-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    red: "bg-red-50 text-red-600 border-red-100",
  }[tone];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full border ${toneClasses}`}>
      {children}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="p-10 text-center text-sm text-slate-400 italic">{text}</div>;
}

export default function OfficerProfilePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const officerId = params?.id as string;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const isSelf = user?.id === officerId;
  const isPrivileged = user?.role === "admin" || user?.role === "manager";

  const [activeTab, setActiveTab] = useState<TabKey>("overview");

  const [officer, setOfficer] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [visits, setVisits] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [momentum, setMomentum] = useState<any | null>(null);
  const [productivity, setProductivity] = useState<any | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !officerId) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    const momentumPath = isSelf ? "/momentum/me" : `/momentum/officers/${officerId}`;
    const productivityPath = isSelf ? "/productivity/me" : `/productivity?officer_id=${officerId}`;

    Promise.allSettled([
      apiFetch<any>(`/users/${officerId}`),
      apiFetch<any[]>(`/tasks?assigned_to=${officerId}`),
      apiFetch<any[]>(`/visits/history?officer_id=${officerId}&limit=30`),
      apiFetch<any[]>(`/attendance/officer/${officerId}?limit=30`),
      (isSelf || isPrivileged) ? apiFetch<any>(momentumPath) : Promise.resolve(null),
      (isSelf || isPrivileged) ? apiFetch<any>(productivityPath) : Promise.resolve(null),
    ]).then(([officerRes, tasksRes, visitsRes, attendanceRes, momentumRes, productivityRes]) => {
      if (cancelled) return;

      if (officerRes.status === "fulfilled") setOfficer(officerRes.value);
      else setError((officerRes.reason as ApiError)?.message || "Couldn't load this officer's profile.");

      setTasks(tasksRes.status === "fulfilled" ? tasksRes.value || [] : []);
      setVisits(visitsRes.status === "fulfilled" ? visitsRes.value || [] : []);
      setAttendance(attendanceRes.status === "fulfilled" ? attendanceRes.value || [] : []);

      if (momentumRes.status === "fulfilled") setMomentum(momentumRes.value);
      if (productivityRes.status === "fulfilled") {
        // /productivity (list, admin/manager) returns an array; /productivity/me returns one object.
        const val = productivityRes.value;
        setProductivity(Array.isArray(val) ? (val[0] ?? null) : val);
      }

      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [user, officerId, isSelf, isPrivileged]);

  // Merged, chronological Activity feed from visits + tasks — no separate
  // "activity log" endpoint exists yet, so this composes from what's
  // already fetched rather than adding a new backend concept.
  const activityFeed = useMemo(() => {
    const visitEvents = visits.map((v) => ({
      kind: "visit" as const,
      timestamp: v.end_time || v.start_time,
      title: `${v.visit_type === "farmer" ? "Farmer" : v.visit_type === "dealer" ? "Dealer" : "Field"} visit`,
      detail: v.crop ? `Crop: ${v.crop}` : v.purpose || "",
      done: !!v.end_time,
    }));
    const taskEvents = tasks
      .filter((t) => t.status === "done")
      .map((t) => ({
        kind: "task" as const,
        timestamp: t.completed_at || t.updated_at,
        title: t.title,
        detail: "Task completed",
        done: true,
      }));
    return [...visitEvents, ...taskEvents]
      .filter((e) => e.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 25);
  }, [visits, tasks]);

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {loading ? (
          <div className="bg-white rounded-xl border border-slate-100 p-10 text-center text-slate-400 text-sm">
            Loading officer profile...
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-red-100 p-6 text-sm text-red-600">{error}</div>
        ) : (
          <>
            {/* Header card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6 flex flex-col md:flex-row md:items-center gap-4 md:justify-between">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold text-xl flex-shrink-0">
                  {(officer?.full_name || "?").split(" ").map((p: string) => p[0]).slice(0, 2).join("")}
                </div>
                <div>
                  <h1 className="text-lg font-bold text-slate-800">{officer?.full_name || "Officer"}</h1>
                  <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <Mail className="w-3.5 h-3.5" /> {officer?.email}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="slate">{(officer?.role || "").replace("_", " ")}</StatusPill>
                {officer?.employee_id && <StatusPill tone="slate">ID: {officer.employee_id}</StatusPill>}
                <StatusPill tone={officer?.is_active ? "green" : "red"}>
                  {officer?.is_active ? "Active" : "Disabled"}
                </StatusPill>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-white p-1.5 rounded-xl border border-slate-100 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${
                    activeTab === t.key ? "bg-green-700 text-white" : "text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <t.icon className="w-4 h-4" /> {t.label}
                </button>
              ))}
            </div>

            {/* Overview */}
            {activeTab === "overview" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-100 p-5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">This month</p>
                  <p className="text-2xl font-bold text-slate-800">
                    {momentum ? `${momentum.monthly_tasks_completed}/${momentum.monthly_task_target}` : "—"}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">tasks completed vs. target</p>
                </div>
                <div className="bg-white rounded-xl border border-slate-100 p-5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Recent visits</p>
                  <p className="text-2xl font-bold text-slate-800">{visits.length}</p>
                  <p className="text-xs text-slate-500 mt-1">in the last 30 records</p>
                </div>
                <div className="bg-white rounded-xl border border-slate-100 p-5">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Days present</p>
                  <p className="text-2xl font-bold text-slate-800">{productivity?.days_present ?? "—"}</p>
                  <p className="text-xs text-slate-500 mt-1">this {productivity?.period || "period"}</p>
                </div>
                {momentum?.trend_label && (
                  <div className="md:col-span-3 bg-white rounded-xl border border-slate-100 p-5 flex items-center gap-3">
                    <TrendingUp className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <p className="text-sm font-medium text-slate-700">{momentum.trend_label}</p>
                  </div>
                )}
                {!isSelf && !isPrivileged && (
                  <div className="md:col-span-3 bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-700">
                    Momentum and productivity figures are only shown to the officer themselves, or to an admin/manager.
                  </div>
                )}
              </div>
            )}

            {/* Activity */}
            {activeTab === "activity" && (
              <div className="bg-white rounded-xl border border-slate-100 divide-y divide-slate-100">
                {activityFeed.length === 0 ? (
                  <EmptyState text="No recent activity to show yet." />
                ) : (
                  activityFeed.map((e, i) => (
                    <div key={i} className="p-4 flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${e.kind === "visit" ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-700"}`}>
                        {e.kind === "visit" ? <MapPin className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{e.title}</p>
                        {e.detail && <p className="text-xs text-slate-500 mt-0.5">{e.detail}</p>}
                      </div>
                      <p className="text-xs text-slate-400 flex-shrink-0">
                        {e.timestamp ? new Date(e.timestamp).toLocaleDateString() : ""}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tasks */}
            {activeTab === "tasks" && (
              <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
                {tasks.length === 0 ? (
                  <EmptyState text="No tasks assigned." />
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs font-semibold border-b border-slate-100">
                        <th className="p-4">Title</th>
                        <th className="p-4">Due</th>
                        <th className="p-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {tasks.map((t) => (
                        <tr key={t.id}>
                          <td className="p-4 font-medium text-slate-800">{t.title}</td>
                          <td className="p-4 text-slate-500">{t.due_date}</td>
                          <td className="p-4">
                            <StatusPill tone={t.status === "done" ? "green" : t.is_overdue ? "red" : "amber"}>
                              {t.status.replace("_", " ")}
                            </StatusPill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Visits */}
            {activeTab === "visits" && (
              <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
                {visits.length === 0 ? (
                  <EmptyState text="No visit history." />
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs font-semibold border-b border-slate-100">
                        <th className="p-4">Type</th>
                        <th className="p-4">Start</th>
                        <th className="p-4">Duration</th>
                        <th className="p-4">Purpose</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {visits.map((v) => (
                        <tr key={v.id}>
                          <td className="p-4 font-medium text-slate-800 capitalize">{v.visit_type}</td>
                          <td className="p-4 text-slate-500">{v.start_time ? new Date(v.start_time).toLocaleString() : "-"}</td>
                          <td className="p-4 text-slate-500">
                            {v.duration_seconds ? `${Math.round(v.duration_seconds / 60)} min` : "In progress"}
                          </td>
                          <td className="p-4 text-slate-500">{v.purpose || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Attendance */}
            {activeTab === "attendance" && (
              <div className="bg-white rounded-xl border border-slate-100 overflow-x-auto">
                {attendance.length === 0 ? (
                  <EmptyState text="No attendance records." />
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs font-semibold border-b border-slate-100">
                        <th className="p-4">Date</th>
                        <th className="p-4">Check-in</th>
                        <th className="p-4">Check-out</th>
                        <th className="p-4">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {attendance.map((a) => (
                        <tr key={a.id}>
                          <td className="p-4 font-medium text-slate-800">{a.date}</td>
                          <td className="p-4 text-slate-500">
                            {a.check_in_time ? new Date(a.check_in_time).toLocaleTimeString() : "-"}
                          </td>
                          <td className="p-4 text-slate-500">
                            {a.check_out_time ? new Date(a.check_out_time).toLocaleTimeString() : "-"}
                          </td>
                          <td className="p-4">
                            {(a.is_fake_gps || a.is_gps_disabled) ? (
                              <StatusPill tone="amber">GPS flag</StatusPill>
                            ) : (
                              <StatusPill tone="green">Clean</StatusPill>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* Analytics */}
            {activeTab === "analytics" && (
              <div className="space-y-6">
                {!isSelf && !isPrivileged ? (
                  <div className="bg-white rounded-xl border border-slate-100 p-10 text-center text-sm text-slate-400">
                    Analytics are only visible to the officer themselves, or to an admin/manager.
                  </div>
                ) : (
                  <>
                    <MomentumWidget momentumData={momentum} />
                    {productivity && (
                      <div className="bg-white rounded-xl border border-slate-100 p-6">
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4">
                          Productivity — {productivity.period}
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          {[
                            ["Tasks", `${productivity.tasks_completed}/${productivity.tasks_assigned}`],
                            ["Days present", productivity.days_present],
                            ["Visits completed", productivity.visits_completed],
                            ["Crop issues resolved", productivity.crop_issues_resolved],
                          ].map(([label, value]) => (
                            <div key={label as string} className="bg-slate-50 rounded-lg p-3">
                              <p className="text-xs text-slate-500">{label}</p>
                              <p className="text-lg font-bold text-slate-800">{value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
