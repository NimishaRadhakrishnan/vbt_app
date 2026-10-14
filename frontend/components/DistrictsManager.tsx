"use client";

import React, { useEffect, useState } from "react";
import { X, Plus, Pencil, Trash2, Check } from "lucide-react";
import { apiFetch } from "@/lib/api/client";

// Admin: add, rename and delete the districts offered on every officer form
// (web and mobile). Old records keep the district name they were saved with.
export default function DistrictsManager({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<{ id: string; name: string }[]>([]);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    apiFetch<any[]>("/districts").then(setRows).catch((e) => setError(e.message || "Could not load districts."));
  useEffect(() => { void load(); }, []);

  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      if (!newName.trim()) return;
      await apiFetch("/admin/districts", { method: "POST", body: JSON.stringify({ name: newName.trim() }) });
      setNewName("");
    });
  const save = (id: string) =>
    run(async () => {
      await apiFetch(`/admin/districts/${id}`, { method: "PUT", body: JSON.stringify({ name: editName.trim() }) });
      setEditId(null);
    });
  const remove = (id: string, name: string) => {
    if (!confirm(`Delete district "${name}"? Existing records keep their district name.`)) return;
    void run(() => apiFetch(`/admin/districts/${id}`, { method: "DELETE" }));
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Districts</h3>
            <p className="text-xs text-slate-400">Shown on all officer forms (web and mobile).</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          {error && <p className="text-xs font-bold text-red-600">{error}</p>}
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
              placeholder="New district name"
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
            <button onClick={add} disabled={busy || !newName.trim()} className="flex items-center gap-1 px-3 py-2 text-sm bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white rounded-lg">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {rows.length === 0 && <li className="p-4 text-sm text-slate-400 text-center">No districts yet.</li>}
            {rows.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                {editId === d.id ? (
                  <>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 px-2 py-1 border border-slate-200 rounded" autoFocus />
                    <button onClick={() => save(d.id)} disabled={busy} className="text-green-700"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditId(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-slate-800">{d.name}</span>
                    <button onClick={() => { setEditId(d.id); setEditName(d.name); }} className="text-slate-500 hover:text-slate-800"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(d.id, d.name)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
