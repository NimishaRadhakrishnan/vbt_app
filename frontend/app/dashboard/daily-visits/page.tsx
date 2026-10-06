"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Filter, X, Download } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { downloadAuthenticatedFile, datedFilename } from "@/lib/api/download";
import { useAuth } from "@/lib/auth-context";
import SectionTabs from "@/components/SectionTabs";
import { VisitDetailPanel } from "@/components/VisitDetailPanel";

type VisitListItem = {
  visit_id: string;
  visit_date: string;
  officer_name: string;
  employee_id: string | null;
  district: string | null;
  village: string | null;
  farmer_name: string | null;
  crop_name: string | null;
  farming_type: string | null;
  crop_status: string | null;
  is_trial: boolean;
  demo_status: string | null;
  purchased: boolean | null;
  conversion_status: string | null;
  order_value: number | null;
};

type Filters = {
  date_from: string;
  date_to: string;
  district: string;
  village: string;
  farming_type: string;
  crop_status: string;
  is_trial: string;
  conversion_status: string;
  officer_id: string;
  employee_id: string;
  manager_id: string;
  crop_category_id: string;
  crop_id: string;
  pest_id: string;
  disease_id: string;
  demo_status: string;
  product_id: string;
  order_value_min: string;
  order_value_max: string;
};

const EMPTY_FILTERS: Filters = {
  date_from: "",
  date_to: "",
  district: "",
  village: "",
  farming_type: "",
  crop_status: "",
  is_trial: "",
  conversion_status: "",
  officer_id: "",
  employee_id: "",
  manager_id: "",
  crop_category_id: "",
  crop_id: "",
  pest_id: "",
  disease_id: "",
  demo_status: "",
  product_id: "",
  order_value_min: "",
  order_value_max: "",
};

const FARMING_TYPE_LABELS: Record<string, string> = {
  certified_organic: "Certified Organic",
  natural_farming: "Natural Farming",
  transitioning: "Transitioning",
  conventional: "Conventional",
};

const CROP_STATUS_LABELS: Record<string, string> = {
  healthy: "Healthy",
  mild_stress: "Mild Stress",
  pest_disease_affected: "Pest/Disease Affected",
  drought: "Drought",
  waterlogged: "Waterlogged",
};

const DEMO_STATUS_LABELS: Record<string, string> = {
  agreed: "Agreed",
  started_today: "Started Today",
  running: "Running",
  success: "Success",
  failed: "Failed",
  converted: "Converted",
};

type Option = { id: string; name: string };
type CropOption = Option & { crop_category_id: string };

// Daily Visit Reports (sections 29-31). This is its own route, matching
// how Field Network already lives at its own /dashboard/field-network
// path rather than being crammed into the already 3600+ line main
// dashboard page.tsx - a filters+table+detail feature of this size
// deserves the same treatment.
export default function DailyVisitReportsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin" && user.role !== "manager") {
      router.replace("/dashboard");
    }
  }, [authLoading, user, router]);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Option lists for the extra filters (Field Officer, Employee ID's
  // implied officer, Manager, Crop Category/Crop, Pest, Disease, Product)
  // - fetched once on mount from the same master-data and users endpoints
  // the rest of the app already uses, not duplicated here.
  const [officers, setOfficers] = useState<Option[]>([]);
  const [managers, setManagers] = useState<Option[]>([]);
  const [cropCategories, setCropCategories] = useState<Option[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [pests, setPests] = useState<Option[]>([]);
  const [diseases, setDiseases] = useState<Option[]>([]);
  const [products, setProducts] = useState<Option[]>([]);

  useEffect(() => {
    if (!user || (user.role !== "admin" && user.role !== "manager")) return;
    apiFetch<{ items: any[] }>("/users?limit=200")
      .then((res) => {
        const items = res.items || [];
        setOfficers(items.filter((u) => u.role === "field_officer" || u.role === "sales_officer").map((u) => ({ id: u.id, name: `${u.full_name}${u.employee_id ? ` (${u.employee_id})` : ""}` })));
        setManagers(items.filter((u) => u.role === "manager").map((u) => ({ id: u.id, name: u.full_name })));
      })
      .catch(() => {});
    apiFetch<Option[]>("/master-data/crop-categories").then(setCropCategories).catch(() => {});
    apiFetch<CropOption[]>("/master-data/crops").then(setCrops).catch(() => {});
    apiFetch<Option[]>("/master-data/pests").then(setPests).catch(() => {});
    apiFetch<Option[]>("/master-data/diseases").then(setDiseases).catch(() => {});
    apiFetch<Option[]>("/dealers/products/catalog").then((res: any[]) => setProducts((res || []).map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
  }, [user]);

  const [items, setItems] = useState<VisitListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    if (filters.district) params.set("district", filters.district);
    if (filters.village) params.set("village", filters.village);
    if (filters.farming_type) params.set("farming_type", filters.farming_type);
    if (filters.crop_status) params.set("crop_status", filters.crop_status);
    if (filters.is_trial) params.set("is_trial", filters.is_trial);
    if (filters.conversion_status) params.set("conversion_status", filters.conversion_status);
    if (filters.officer_id) params.set("officer_id", filters.officer_id);
    if (filters.employee_id) params.set("employee_id", filters.employee_id);
    if (filters.manager_id) params.set("manager_id", filters.manager_id);
    if (filters.crop_category_id) params.set("crop_category_id", filters.crop_category_id);
    if (filters.crop_id) params.set("crop_id", filters.crop_id);
    if (filters.pest_id) params.set("pest_id", filters.pest_id);
    if (filters.disease_id) params.set("disease_id", filters.disease_id);
    if (filters.demo_status) params.set("demo_status", filters.demo_status);
    if (filters.product_id) params.set("product_id", filters.product_id);
    if (filters.order_value_min) params.set("order_value_min", filters.order_value_min);
    if (filters.order_value_max) params.set("order_value_max", filters.order_value_max);
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    return params.toString();
  }, [filters, searchQuery, page]);

  const loadVisits = useCallback(() => {
    setLoading(true);
    setLoadError("");
    apiFetch<{ total: number; items: VisitListItem[] }>(`/admin/daily-visits?${buildQuery()}`)
      .then((res) => {
        setItems(res.items || []);
        setTotal(res.total || 0);
      })
      .catch((err) => setLoadError(err.message || "Could not load visit reports."))
      .finally(() => setLoading(false));
  }, [buildQuery]);

  useEffect(() => {
    if (user && (user.role === "admin" || user.role === "manager")) {
      loadVisits();
    }
  }, [user, loadVisits]);

  const applyFilters = () => {
    setPage(0);
    loadVisits();
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setSearchQuery("");
    setPage(0);
  };

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadAuthenticatedFile(exportUrl, datedFilename("daily-visits", "xlsx"));
    } catch (err: any) {
      alert(err.message || "Couldn't export.");
    } finally {
      setExporting(false);
    }
  };

  const exportUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1"}/admin/daily-visits/export/excel?${buildQuery()}`;

  if (authLoading || !user) return null;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#1b2a4a] text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/dashboard")} className="hover:text-slate-300">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-bold">Daily Visit Reports</h1>
        </div>
        <span className="text-sm text-slate-300">{total} visit{total === 1 ? "" : "s"}</span>
      </header>

      <div className="max-w-7xl mx-auto px-6 pt-4">
        <SectionTabs showSections />
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex gap-3 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-900"
              placeholder="Search farmer, phone, officer, visit ID, crop, village, product..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            />
          </div>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-100"
          >
            <Filter className="w-4 h-4" /> Filters
          </button>
          <button onClick={applyFilters} className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800">
            Search
          </button>
          {/* Was <a href={exportUrl}>. A browser navigation sends no
              Authorization header, so this returned
              {"detail":"Not authenticated"} instead of a file. */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-100 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> {exporting ? "Exporting…" : "Export Excel"}
          </button>
        </div>

        {showFilters && (
          <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500">Date From</label>
              <input type="date" className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.date_from} onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Date To</label>
              <input type="date" className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.date_to} onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">District / Region</label>
              <input className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900" placeholder="e.g. Coimbatore"
                value={filters.district} onChange={(e) => setFilters((f) => ({ ...f, district: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Farming Type</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.farming_type} onChange={(e) => setFilters((f) => ({ ...f, farming_type: e.target.value }))}>
                <option value="">Any</option>
                {Object.entries(FARMING_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Crop Health</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.crop_status} onChange={(e) => setFilters((f) => ({ ...f, crop_status: e.target.value }))}>
                <option value="">Any</option>
                {Object.entries(CROP_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Trial</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.is_trial} onChange={(e) => setFilters((f) => ({ ...f, is_trial: e.target.value }))}>
                <option value="">Any</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Sales Conversion</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.conversion_status} onChange={(e) => setFilters((f) => ({ ...f, conversion_status: e.target.value }))}>
                <option value="">Any</option>
                <option value="interested">Interested</option>
                <option value="order_placed">Order Placed</option>
                <option value="converted">Converted</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Village / Block</label>
              <input className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900" placeholder="e.g. Perur"
                value={filters.village} onChange={(e) => setFilters((f) => ({ ...f, village: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Field Officer</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.officer_id} onChange={(e) => setFilters((f) => ({ ...f, officer_id: e.target.value }))}>
                <option value="">Any</option>
                {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Employee ID</label>
              <input className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900" placeholder="e.g. VB-1042"
                value={filters.employee_id} onChange={(e) => setFilters((f) => ({ ...f, employee_id: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Manager</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.manager_id} onChange={(e) => setFilters((f) => ({ ...f, manager_id: e.target.value }))}>
                <option value="">Any</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Crop Category</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.crop_category_id}
                onChange={(e) => setFilters((f) => ({ ...f, crop_category_id: e.target.value, crop_id: "" }))}>
                <option value="">Any</option>
                {cropCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Crop</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.crop_id} onChange={(e) => setFilters((f) => ({ ...f, crop_id: e.target.value }))}>
                <option value="">Any</option>
                {crops
                  .filter((c) => !filters.crop_category_id || c.crop_category_id === filters.crop_category_id)
                  .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Pest</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.pest_id} onChange={(e) => setFilters((f) => ({ ...f, pest_id: e.target.value }))}>
                <option value="">Any</option>
                {pests.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Disease</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.disease_id} onChange={(e) => setFilters((f) => ({ ...f, disease_id: e.target.value }))}>
                <option value="">Any</option>
                {diseases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Demo Status</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.demo_status} onChange={(e) => setFilters((f) => ({ ...f, demo_status: e.target.value }))}>
                <option value="">Any</option>
                {Object.entries(DEMO_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Product</label>
              <select className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.product_id} onChange={(e) => setFilters((f) => ({ ...f, product_id: e.target.value }))}>
                <option value="">Any</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Order Value Min (₹)</label>
              <input type="number" className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.order_value_min} onChange={(e) => setFilters((f) => ({ ...f, order_value_min: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500">Order Value Max (₹)</label>
              <input type="number" className="w-full mt-1 px-2 py-1.5 border border-slate-200 rounded text-sm bg-slate-50 text-slate-900"
                value={filters.order_value_max} onChange={(e) => setFilters((f) => ({ ...f, order_value_max: e.target.value }))} />
            </div>
            <div className="flex items-end gap-2">
              <button onClick={applyFilters} className="px-3 py-1.5 bg-green-700 text-white rounded text-sm font-medium">Apply</button>
              <button onClick={clearFilters} className="px-3 py-1.5 border border-slate-200 rounded text-sm font-medium flex items-center gap-1">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
          </div>
        )}

        {loadError && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">{loadError}</div>
        )}

        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Officer</th>
                <th className="px-4 py-3 text-left">Farmer</th>
                <th className="px-4 py-3 text-left">Village / District</th>
                <th className="px-4 py-3 text-left">Crop</th>
                <th className="px-4 py-3 text-left">Health</th>
                <th className="px-4 py-3 text-left">Trial</th>
                <th className="px-4 py-3 text-left">Sales</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No visits match these filters.</td></tr>
              ) : (
                items.map((v) => (
                  <tr key={v.visit_id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedVisitId(v.visit_id)}>
                    <td className="px-4 py-3">{v.visit_date}</td>
                    <td className="px-4 py-3">{v.officer_name}{v.employee_id ? ` (${v.employee_id})` : ""}</td>
                    <td className="px-4 py-3">{v.farmer_name ?? "—"}</td>
                    <td className="px-4 py-3">{v.village ?? "—"}{v.district ? `, ${v.district}` : ""}</td>
                    <td className="px-4 py-3">{v.crop_name ?? "—"}</td>
                    <td className="px-4 py-3">{v.crop_status ? (CROP_STATUS_LABELS[v.crop_status] ?? v.crop_status) : "—"}</td>
                    <td className="px-4 py-3">{v.is_trial ? (v.demo_status ?? "Yes") : "No"}</td>
                    <td className="px-4 py-3">
                      {v.purchased ? `${v.conversion_status ?? "Converted"}${v.order_value ? ` · ₹${v.order_value}` : ""}` : "No"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
          <span>{total === 0 ? "0" : `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)}`} of {total}</span>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-3 py-1.5 border border-slate-200 rounded disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={(page + 1) * pageSize >= total}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1.5 border border-slate-200 rounded disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {selectedVisitId && (
        <VisitDetailPanel visitId={selectedVisitId} onClose={() => setSelectedVisitId(null)} />
      )}
    </div>
  );
}


