"use client";

import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";

type Deleted = {
  id: string;
  date: string;
  kind: "farmer" | "dealer" | "no_activity";
  officer_name: string;
  summary: string;
};

const KIND_LABEL: Record<Deleted["kind"], string> = {
  farmer: "Farmer visit",
  dealer: "Dealer visit",
  no_activity: "No activity",
};

/**
 * Deleted day closures (farmer and dealer). Submitted closures cannot be
 * edited; a wrong one is deleted, then either restored here or removed for
 * good. Permanent delete asks the admin to type DELETE first.
 */
export default function DeletedClosuresPanel({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Deleted[]>([]);
  const [filter, setFilter] = useState<"all" | Deleted["kind"]>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [purging, setPurging] = useState<Deleted | null>(null);
  const [typed, setTyped] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<Deleted[]>("/admin/day-closures/deleted");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setMessage({ ok: false, text: e.message || "Couldn't load deleted closures." });
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const restore = async (r: Deleted) => {
    setBusy(r.id); setMessage(null);
    try {
      await apiFetch(`/admin/day-closures/${r.id}/restore`, { method: "POST" });
      setMessage({ ok: true, text: "Closure restored." });
      await load();
      onChanged?.();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message || "Couldn't restore." });
    } finally { setBusy(null); }
  };

  const purge = async () => {
    if (!purging) return;
    setBusy(purging.id); setMessage(null);
    try {
      await apiFetch(`/admin/day-closures/${purging.id}/permanent`, { method: "DELETE" });
      setMessage({ ok: true, text: "Closure deleted permanently." });
      setPurging(null); setTyped("");
      await load();
    } catch (e: any) {
      setMessage({ ok: false, text: e.message || "Couldn't delete." });
    } finally { setBusy(null); }
  };

  const shown = rows.filter((r) => filter === "all" || r.kind === filter);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-bold text-slate-800">Deleted closures</span>
        <span className="text-xs text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-slate-500">
            Submitted closures can&apos;t be edited. Restore one to bring it back, or delete it permanently.
            If the officer files a new closure for the same day, the deleted copy is cleared automatically.
          </p>
          {message && (
            <p className={`text-xs font-semibold ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
          )}
          <div className="flex gap-2">
            {(["all", "farmer", "dealer"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border ${filter === k ? "bg-primary-700 text-white border-primary-700" : "bg-white text-slate-600 border-slate-200"}`}
              >
                {k === "all" ? "All" : k === "farmer" ? "Farmer visits" : "Dealer visits"}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No deleted closures.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Officer</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Dealer / farmer</th>
                    <th className="px-3 py-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.date}</td>
                      <td className="px-3 py-2 text-slate-600">{r.officer_name}</td>
                      <td className="px-3 py-2 text-slate-600">{KIND_LABEL[r.kind]}</td>
                      <td className="px-3 py-2 text-slate-600">{r.summary}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <button
                            disabled={busy === r.id}
                            onClick={() => restore(r)}
                            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2.5 py-1 rounded-lg"
                          >
                            Restore
                          </button>
                          <button
                            disabled={busy === r.id}
                            onClick={() => { setPurging(r); setTyped(""); }}
                            className="text-xs bg-red-600 hover:bg-red-700 text-white font-semibold px-2.5 py-1 rounded-lg"
                          >
                            Delete permanently
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {purging && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-red-700">Delete permanently?</h3>
            <p className="text-sm text-slate-600">
              {KIND_LABEL[purging.kind]} closure of <b>{purging.officer_name}</b> on <b>{purging.date}</b>
              {purging.summary !== "-" ? <> ({purging.summary})</> : null} will be removed for good, with its photos and
              stock rows. This cannot be undone.
              {purging.kind === "farmer" && " The visit record itself is kept."}
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Type DELETE to confirm</label>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPurging(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
              <button
                disabled={typed.trim() !== "DELETE" || busy === purging.id}
                onClick={purge}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg"
              >
                {busy === purging.id ? "Deleting..." : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
