"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import BulkImportPanel from "@/components/products/BulkImportPanel";
import PriceTierPanel, { DealerOption } from "@/components/products/PriceTierPanel";

type Product = {
  id: string;
  name: string;
  category: string;
  sku_code: string;
  price: number;
  description: string | null;
  is_active: boolean;
  updated_by: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

type FormState = {
  name: string;
  category: string;
  sku_code: string;
  price: string;
  description: string;
};

const EMPTY_FORM: FormState = { name: "", category: "", sku_code: "", price: "", description: "" };

// Products (master catalog) admin CRUD - previously read-only
// (GET /dealers/products/catalog only, no write surface anywhere). Mirrors
// /dashboard/master-data's table-with-inline-edit layout since products are
// a similarly-shaped lookup table, but with the richer field set (category,
// SKU, price, description) and the "Last updated by {name} on {date}"
// attribution row that section 0a requires on every entity detail view -
// master-data's simpler name-only tables don't show this, but products has
// real audit history worth surfacing.
export default function ProductsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") router.replace("/dashboard");
  }, [authLoading, user, router]);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [includeInactive, setIncludeInactive] = useState(true);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editError, setEditError] = useState("");

  const [showBulk, setShowBulk] = useState(false);
  // Which product's price bands are open. One at a time: two open panels would
  // put two "Add a band" forms on screen with no indication which product each
  // belongs to.
  const [openTiersFor, setOpenTiersFor] = useState<string | null>(null);
  const [dealers, setDealers] = useState<DealerOption[]>([]);

  const loadProducts = useCallback(() => {
    setLoading(true);
    setError("");
    apiFetch<Product[]>(`/admin/products?include_inactive=${includeInactive}`)
      .then(setProducts)
      .catch((err) => setError(err.message || "Could not load products."))
      .finally(() => setLoading(false));
  }, [includeInactive]);

  useEffect(() => {
    if (user?.role === "admin") loadProducts();
  }, [user, loadProducts]);

  // Dealers are needed only to name one in a price band. Loaded once, and a
  // failure here must not take the products table down with it - the page's
  // main job still works without the dealer dropdown.
  useEffect(() => {
    if (user?.role !== "admin") return;
    apiFetch<{ id: string; name: string }[]>("/dealers/search?limit=500")
      .then((rows) => setDealers(rows.map((d) => ({ id: d.id, name: d.name }))))
      .catch(() => setDealers([]));
  }, [user]);

  const handleCreate = async () => {
    if (!createForm.name.trim() || !createForm.category.trim() || !createForm.sku_code.trim() || !createForm.price.trim()) {
      setCreateError("Name, category, SKU, and price are all required.");
      return;
    }
    const price = Number(createForm.price);
    if (!Number.isFinite(price) || price <= 0) {
      setCreateError("Price must be a positive number.");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      await apiFetch("/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name: createForm.name.trim(),
          category: createForm.category.trim(),
          sku_code: createForm.sku_code.trim(),
          price,
          description: createForm.description.trim() || undefined,
        }),
      });
      setCreateForm(EMPTY_FORM);
      setShowCreateForm(false);
      loadProducts();
    } catch (err: any) {
      setCreateError(err.message || "Could not create product.");
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditForm({
      name: p.name,
      category: p.category,
      sku_code: p.sku_code,
      price: String(p.price),
      description: p.description ?? "",
    });
    setEditError("");
  };

  const saveEdit = async (p: Product) => {
    const price = Number(editForm.price);
    if (!Number.isFinite(price) || price <= 0) {
      setEditError("Price must be a positive number.");
      return;
    }
    try {
      await apiFetch(`/admin/products/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          category: editForm.category.trim(),
          sku_code: editForm.sku_code.trim(),
          price,
          description: editForm.description.trim() || null,
        }),
      });
      setEditingId(null);
      loadProducts();
    } catch (err: any) {
      setEditError(err.message || "Could not update product.");
    }
  };

  const handleDeactivate = async (p: Product) => {
    if (!confirm(`Deactivate "${p.name}"? It will stop appearing in dealer stock/order pickers going forward, but existing orders and stock history that reference it are unaffected.`)) return;
    try {
      await apiFetch(`/admin/products/${p.id}`, { method: "DELETE" });
      loadProducts();
    } catch (err: any) {
      setError(err.message || "Could not deactivate product.");
    }
  };

  const handleReactivate = async (p: Product) => {
    try {
      await apiFetch(`/admin/products/${p.id}`, { method: "PATCH", body: JSON.stringify({ is_active: true }) });
      loadProducts();
    } catch (err: any) {
      setError(err.message || "Could not reactivate product.");
    }
  };

  const formatDateTime = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#1b2a4a] text-white px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push("/dashboard")} className="hover:text-slate-300">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">Products</h1>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{error}</div>}

        <div className="flex items-center justify-between mb-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="accent-primary-700 w-4 h-4"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Show inactive products
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBulk((v) => !v)}
              className="flex items-center gap-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-100"
            >
              <Upload className="w-4 h-4" /> Bulk entry
            </button>
            <button
              onClick={() => {
                setShowCreateForm((v) => !v);
                setCreateError("");
              }}
              className="flex items-center gap-1 px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" /> New Product
            </button>
          </div>
        </div>

        {showBulk && <BulkImportPanel onImported={loadProducts} />}

        {showCreateForm && (
          <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
            {createError && <div className="text-red-600 text-xs mb-2">{createError}</div>}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="md:col-span-1">
                <label className="text-xs font-semibold text-slate-500">Name</label>
                <input
                  className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Category</label>
                <input
                  className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                  value={createForm.category}
                  onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">SKU Code</label>
                <input
                  className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                  value={createForm.sku_code}
                  onChange={(e) => setCreateForm({ ...createForm, sku_code: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                  value={createForm.price}
                  onChange={(e) => setCreateForm({ ...createForm, price: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">Description</label>
                <input
                  className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-1.5 text-sm text-slate-500 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-1.5 bg-green-700 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create Product"}
              </button>
            </div>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Last Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No products yet - add one above.</td></tr>
              ) : (
                products.map((p) => (
                  <React.Fragment key={p.id}>
                  <tr className={!p.is_active ? "opacity-50" : ""}>
                    {editingId === p.id ? (
                      <>
                        <td className="px-4 py-3">
                          <input
                            className="px-2 py-1 border border-slate-200 rounded text-sm w-full bg-slate-50 text-slate-900"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            autoFocus
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="px-2 py-1 border border-slate-200 rounded text-sm w-full bg-slate-50 text-slate-900"
                            value={editForm.category}
                            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            className="px-2 py-1 border border-slate-200 rounded text-sm w-full bg-slate-50 text-slate-900"
                            value={editForm.sku_code}
                            onChange={(e) => setEditForm({ ...editForm, sku_code: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="px-2 py-1 border border-slate-200 rounded text-sm w-24 text-right bg-slate-50 text-slate-900"
                            value={editForm.price}
                            onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">—</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">—</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-3">
                            <button onClick={() => saveEdit(p)} className="text-green-700"><Check className="w-4 h-4" /></button>
                            <button onClick={() => setEditingId(null)} className="text-slate-400"><X className="w-4 h-4" /></button>
                          </div>
                          {editError && <div className="text-red-600 text-xs mt-1 text-right">{editError}</div>}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                        <td className="px-4 py-3 text-slate-500">{p.category}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{p.sku_code}</td>
                        <td className="px-4 py-3 text-right">₹{p.price.toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                            {p.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">
                          {p.updated_by_name ? (
                            <>Last updated by {p.updated_by_name} on {formatDateTime(p.updated_at)}</>
                          ) : (
                            <>Created {formatDateTime(p.created_at)}</>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end items-center gap-3">
                            <button
                              onClick={() => setOpenTiersFor((current) => (current === p.id ? null : p.id))}
                              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
                              aria-expanded={openTiersFor === p.id}
                              title="Price bands by quantity and dealer"
                            >
                              {openTiersFor === p.id ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                              )}
                              <Layers className="w-4 h-4" />
                              Prices
                            </button>
                            <button onClick={() => startEdit(p)} className="text-slate-400 hover:text-slate-700" aria-label={`Edit ${p.name}`}><Pencil className="w-4 h-4" /></button>
                            {p.is_active ? (
                              <button onClick={() => handleDeactivate(p)} className="text-red-400 hover:text-red-600" aria-label={`Deactivate ${p.name}`}>
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ) : (
                              <button onClick={() => handleReactivate(p)} className="text-green-600 hover:text-green-800" aria-label={`Reactivate ${p.name}`}>
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                  {openTiersFor === p.id && editingId !== p.id && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <PriceTierPanel
                          productId={p.id}
                          listPrice={p.price}
                          dealers={dealers}
                        />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
