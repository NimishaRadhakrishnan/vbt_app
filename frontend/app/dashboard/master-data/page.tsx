"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Pencil, X, Check } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";

type DataTypeDef = { key: string; label: string; hasParent: boolean; parentType?: string };

// Section 35: one generic screen for all 9 master-data lists, matching
// the single generic backend router behind it - a type selector instead
// of 9 near-identical pages, since every one of these tables is shaped
// the same way (name + is_active[+ parent]).
const DATA_TYPES: DataTypeDef[] = [
  { key: "crop-categories", label: "Crop Categories", hasParent: false },
  { key: "crops", label: "Crops", hasParent: true, parentType: "crop-categories" },
  { key: "crop-varieties", label: "Crop Varieties", hasParent: true, parentType: "crops" },
  { key: "pests", label: "Pests", hasParent: false },
  { key: "diseases", label: "Diseases", hasParent: false },
  { key: "chemicals", label: "Chemicals", hasParent: false },
  { key: "micronutrients", label: "Micronutrients", hasParent: false },
  { key: "farm-operations", label: "Farm Operations", hasParent: false },
  { key: "organic-solutions", label: "Organic / IPM Solutions", hasParent: false },
];

type Item = { id: string; name: string; is_active: boolean; parent_id: string | null };

export default function MasterDataPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") router.replace("/dashboard");
  }, [authLoading, user, router]);

  const [activeType, setActiveType] = useState(DATA_TYPES[0]!.key);
  const [items, setItems] = useState<Item[]>([]);
  const [parentItems, setParentItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newParentId, setNewParentId] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const activeDef = DATA_TYPES.find((d) => d.key === activeType)!;

  const loadItems = useCallback(() => {
    setLoading(true);
    setError("");
    apiFetch<Item[]>(`/master-data/${activeType}/admin`)
      .then(setItems)
      .catch((err) => setError(err.message || "Could not load list."))
      .finally(() => setLoading(false));

    if (activeDef.hasParent && activeDef.parentType) {
      apiFetch<Item[]>(`/master-data/${activeDef.parentType}/admin`).then(setParentItems).catch(() => setParentItems([]));
    } else {
      setParentItems([]);
    }
  }, [activeType, activeDef]);

  useEffect(() => {
    if (user?.role === "admin") loadItems();
  }, [user, loadItems]);

  const switchType = (key: string) => {
    setActiveType(key);
    setNewName("");
    setNewParentId("");
    setEditingId(null);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    if (activeDef.hasParent && !newParentId) {
      setError(`Select a ${DATA_TYPES.find((d) => d.key === activeDef.parentType)?.label.replace(/s$/, "")} first.`);
      return;
    }
    setCreating(true);
    setError("");
    try {
      await apiFetch(`/master-data/${activeType}`, {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), parent_id: activeDef.hasParent ? newParentId : undefined }),
      });
      setNewName("");
      setNewParentId("");
      loadItems();
    } catch (err: any) {
      setError(err.message || "Could not add item.");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (item: Item) => {
    try {
      await apiFetch(`/master-data/${activeType}/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !item.is_active }),
      });
      loadItems();
    } catch (err: any) {
      setError(err.message || "Could not update item.");
    }
  };

  const startEdit = (item: Item) => {
    setEditingId(item.id);
    setEditingName(item.name);
  };

  const saveEdit = async (item: Item) => {
    if (!editingName.trim()) return;
    try {
      await apiFetch(`/master-data/${activeType}/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editingName.trim() }),
      });
      setEditingId(null);
      loadItems();
    } catch (err: any) {
      setError(err.message || "Could not rename item.");
    }
  };

  const handleDeactivate = async (item: Item) => {
    if (!confirm(`Deactivate "${item.name}"? It will stop appearing as an option going forward, but past visits that used it are unaffected.`)) return;
    try {
      await apiFetch(`/master-data/${activeType}/${item.id}`, { method: "DELETE" });
      loadItems();
    } catch (err: any) {
      setError(err.message || "Could not deactivate item.");
    }
  };

  const parentLabel = (item: Item) => {
    if (!activeDef.hasParent) return null;
    return parentItems.find((p) => p.id === item.parent_id)?.name ?? "—";
  };

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#1b2a4a] text-white px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push("/dashboard")} className="hover:text-slate-300">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">Master Data</h1>
      </header>

      <div className="flex max-w-6xl mx-auto">
        <nav className="w-56 p-4 border-r border-slate-200 bg-white min-h-[calc(100vh-64px)]">
          {DATA_TYPES.map((d) => (
            <button
              key={d.key}
              onClick={() => switchType(d.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 ${activeType === d.key ? "bg-green-700 text-white font-medium" : "hover:bg-slate-100 text-slate-700"}`}
            >
              {d.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 p-6">
          <h2 className="text-base font-bold text-slate-800 mb-4">{activeDef.label}</h2>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>}

          <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex gap-2 items-end">
            {activeDef.hasParent && (
              <div>
                <label className="text-xs font-semibold text-slate-500">
                  {DATA_TYPES.find((d) => d.key === activeDef.parentType)?.label.replace(/s$/, "")}
                </label>
                <select
                  className="mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm min-w-[160px] bg-slate-50 text-slate-900"
                  value={newParentId}
                  onChange={(e) => setNewParentId(e.target.value)}
                >
                  <option value="">Select...</option>
                  {parentItems.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-500">Name</label>
              <input
                className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                placeholder={`New ${activeDef.label.replace(/s$/, "").toLowerCase()} name`}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="flex items-center gap-1 px-4 py-1.5 bg-green-700 text-white rounded text-sm font-medium disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Name</th>
                  {activeDef.hasParent && <th className="px-4 py-3 text-left">Parent</th>}
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No items yet - add one above.</td></tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className={!item.is_active ? "opacity-50" : ""}>
                      <td className="px-4 py-3">
                        {editingId === item.id ? (
                          <input
                            className="px-2 py-1 border border-slate-200 rounded text-sm w-full bg-slate-50 text-slate-900"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && saveEdit(item)}
                            autoFocus
                          />
                        ) : (
                          item.name
                        )}
                      </td>
                      {activeDef.hasParent && <td className="px-4 py-3 text-slate-500">{parentLabel(item)}</td>}
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                          {item.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-3">
                          {editingId === item.id ? (
                            <>
                              <button onClick={() => saveEdit(item)} className="text-green-700"><Check className="w-4 h-4" /></button>
                              <button onClick={() => setEditingId(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(item)} className="text-slate-400 hover:text-slate-700"><Pencil className="w-4 h-4" /></button>
                              <button
                                onClick={() => handleToggleActive(item)}
                                className="text-xs font-medium text-slate-500 hover:text-slate-800"
                              >
                                {item.is_active ? "Deactivate" : "Reactivate"}
                              </button>
                              {item.is_active && (
                                <button onClick={() => handleDeactivate(item)} className="text-red-400 hover:text-red-600">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
