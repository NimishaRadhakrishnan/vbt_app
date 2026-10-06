"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Package, AlertTriangle, RefreshCw } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import SectionTabs from "@/components/SectionTabs";

// "My stock" previously pushed to /dashboard/field-network - the same
// destination as the Dealers tile, the Collections tile AND the
// "Register dealer" button. Four controls, one page, so stock was
// effectively unreachable.
//
// Backed by the existing GET /stock/my-stock endpoint (no new
// backend work); the response shape here matches MyStockItem exactly.

type StockItem = {
  product_id: string;
  product_name: string;
  sku_code: string;
  current_quantity: number;
  unit: string | null;
  last_movement_at: string | null;
};

// Matches the "Low stock items" figure on the Overview card so the two
// screens can never disagree about what "low" means.
const LOW_STOCK_THRESHOLD = 5;

export default function MyStockPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchStock = async () => {
    setLoading(true);
    setError("");
    try {
      const data: any = await apiFetch("/stock/my-stock");
      setItems(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || "Couldn't load your stock.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchStock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (authLoading) return <main className="p-6 text-sm text-slate-400">Loading…</main>;

  const lowStock = items.filter((i) => i.current_quantity <= LOW_STOCK_THRESHOLD);
  const totalUnits = items.reduce((sum, i) => sum + (i.current_quantity || 0), 0);

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <SectionTabs showSections />
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">My Stock</h1>
            <p className="text-sm text-slate-500 mt-1">
              Product stock currently allocated to you.
            </p>
          </div>
          <button
            onClick={fetchStock}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-100 p-4">
            <p className="text-xs text-slate-500 font-medium">Products held</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{items.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4">
            <p className="text-xs text-slate-500 font-medium">Low stock items</p>
            <p className={`text-2xl font-bold mt-1 ${lowStock.length > 0 ? "text-red-600" : "text-slate-800"}`}>
              {lowStock.length}
            </p>
          </div>
        </div>

        {lowStock.length > 0 && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-xl">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              {lowStock.length} product{lowStock.length === 1 ? "" : "s"} at or below{" "}
              {LOW_STOCK_THRESHOLD} units — request a top-up before your next dealer visit.
            </span>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          {loading ? (
            <p className="p-8 text-center text-sm text-slate-400">Loading your stock…</p>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-sm text-red-600 mb-3">{error}</p>
              <button onClick={fetchStock} className="text-xs font-semibold text-green-700 hover:underline">
                Try again
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center">
              <Package className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm text-slate-400 mt-2">
                No stock allocated to you yet. An admin assigns stock from the Products page.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">SKU</th>
                    <th className="px-4 py-3 font-semibold text-right">Quantity</th>
                    <th className="px-4 py-3 font-semibold">Last updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((i) => {
                    const low = i.current_quantity <= LOW_STOCK_THRESHOLD;
                    return (
                      <tr key={i.product_id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{i.product_name}</td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{i.sku_code}</td>
                        <td className={`px-4 py-3 text-right font-bold ${low ? "text-red-600" : "text-slate-700"}`}>
                          {i.current_quantity}
                          {i.unit ? ` ${i.unit}` : ""}
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">
                          {i.last_movement_at ? new Date(i.last_movement_at).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {items.length > 0 && (
          <p className="text-xs text-slate-400 text-center">
            {totalUnits} units across {items.length} product{items.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </main>
  );
}
