"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, RefreshCw, Trash2 } from "lucide-react";
import { API_BASE_URL, apiFetch } from "@/lib/api/client";
import { tokenStorage } from "@/lib/api/token-storage";
import { useAuth } from "@/lib/auth-context";
import SectionTabs from "@/components/SectionTabs";

type Reading = { id: string; km: number; is_late: boolean; created_at: string; uploaded_by: string };
type Day = {
  date: string; user_id: string; officer_name: string; employee_id?: string;
  check_in: Reading | null; check_out: Reading | null; distance_km: number | null;
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtTime = (s: string) => new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function SpeedometerPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const today = iso(new Date());
  const weekAgo = iso(new Date(Date.now() - 6 * 86400000));
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [officer, setOfficer] = useState("");
  const [rows, setRows] = useState<Day[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
    if (!authLoading && user && user.role !== "admin" && user.role !== "manager") router.replace("/dashboard");
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows((await apiFetch(`/odometer?date_from=${from}&date_to=${to}`)) as Day[]);
      setError("");
    } catch (e: any) {
      setError(e?.message || "Could not load speedometer photos.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { if (user) load(); }, [user, load]);

  const media = (path: string) => {
    const sep = path.includes("?") ? "&" : "?";
    return `${API_BASE_URL}${path}${sep}token=${encodeURIComponent(tokenStorage.getAccessToken() ?? "")}`;
  };

  const remove = async (id: string) => {
    if (!window.confirm("Remove this reading? The officer will be able to submit it again.")) return;
    try {
      await apiFetch(`/odometer/${id}`, { method: "DELETE" });
      load();
    } catch (e: any) {
      alert(e?.message || "Could not remove.");
    }
  };

  const names = Array.from(new Map(rows.map((r) => [r.user_id, r.officer_name])).entries());
  const shown = officer ? rows.filter((r) => r.user_id === officer) : rows;

  const cell = (label: string, r: Reading | null) => (
    <div className="flex-1 min-w-[150px]">
      <p className="text-[11px] font-bold uppercase text-slate-500 mb-1">{label}</p>
      {r ? (
        <div className="space-y-1">
          <a href={media(`/odometer/${r.id}/photo`)} target="_blank" rel="noreferrer">
            <img src={media(`/odometer/${r.id}/photo`)} alt={label} className="w-full h-32 object-cover rounded-lg bg-slate-100" />
          </a>
          <p className="text-sm font-bold text-slate-800">{r.km} km</p>
          <p className="text-[11px] text-slate-500">
            {fmtTime(r.created_at)} · by {r.uploaded_by}{r.is_late ? " · after 6 PM" : ""}
          </p>
          <div className="flex gap-3">
            <a href={media(`/odometer/${r.id}/photo?download=1`)} className="text-xs font-semibold text-green-700 inline-flex items-center gap-1">
              <Download className="w-3 h-3" /> Download
            </a>
            {user?.role === "admin" && (
              <button onClick={() => remove(r.id)} className="text-xs font-semibold text-red-600 inline-flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            )}
          </div>
        </div>
      ) : <p className="text-sm font-semibold text-red-600">Not submitted</p>}
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <SectionTabs showSections />
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Speedometer Photos</h1>
          <p className="text-sm text-slate-500 mt-1">
            Each officer uploads a speedometer photo and the km shown, at check-in and again at check-out. Kept for 60 days.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-slate-100">
          <label className="text-xs font-bold text-slate-600">From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm" />
          </label>
          <label className="text-xs font-bold text-slate-600">To
            <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm" />
          </label>
          <label className="text-xs font-bold text-slate-600">Officer
            <select value={officer} onChange={(e) => setOfficer(e.target.value)} className="block mt-1 p-2 border rounded-lg text-sm">
              <option value="">All officers</option>
              {names.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </label>
          <button onClick={load} className="flex items-center gap-1.5 text-sm text-slate-600 border rounded-lg px-3 py-2 bg-white">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <a
            href={media(`/odometer/download/all.zip?date_from=${from}&date_to=${to}${officer ? `&user_id=${officer}` : ""}`)}
            className="ml-auto flex items-center gap-1.5 text-sm font-semibold text-white bg-green-700 hover:bg-green-800 rounded-lg px-4 py-2"
          >
            <Download className="w-4 h-4" /> Download all (ZIP + CSV)
          </a>
        </div>

        {error && <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>}
        {loading ? <p className="text-sm text-slate-400">Loading…</p> : shown.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 p-10 text-center text-sm text-slate-400">No speedometer photos in this period.</div>
        ) : (
          <div className="space-y-3">
            {shown.map((d) => (
              <div key={d.date + d.user_id} className="bg-white rounded-xl border border-slate-100 p-4">
                <div className="flex flex-wrap justify-between gap-2 mb-3">
                  <p className="font-bold text-slate-800">{d.officer_name}{d.employee_id ? ` (${d.employee_id})` : ""}</p>
                  <p className="text-sm text-slate-500">
                    {d.date}{d.distance_km !== null ? ` · ${d.distance_km} km travelled` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4">
                  {cell("Start of day (check-in)", d.check_in)}
                  {cell("End of day (check-out)", d.check_out)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
