"use client";

import React, { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, Download, Check } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import SectionTabs, { usePageTab } from "@/components/SectionTabs";

type Product = { id: string; name: string; sku_code: string; unit: string; is_active: boolean };
type User = { id: string; full_name: string; employee_id: string; role: string; email: string };
type ReconRow = { officer_id: string; officer_name: string; product_id: string; product_name: string; allocated: number; trial_given: number; sold: number; other: number; on_hand: number; };
type LedgerRow = { id: string; product_name: string; officer_name: string; qty_delta: number; movement_type: string; remarks: string; created_at: string; };

export default function AdminStockPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  
  const [tab, setTab] = useState<"issue"|"recon"|"ledger">("issue");
  const pageTab = usePageTab();
  useEffect(() => {
    if (pageTab === "issue" || pageTab === "recon" || pageTab === "ledger") setTab(pageTab);
  }, [pageTab]);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [officers, setOfficers] = useState<User[]>([]);
  
  // Issue Stock state
  const [selectedOfficer, setSelectedOfficer] = useState("");
  const [issueInputs, setIssueInputs] = useState<Record<string, string>>({});
  const [productSearch, setProductSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<any[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  
  // Recon state
  const [reconData, setReconData] = useState<ReconRow[]>([]);
  const [reconFilter, setReconFilter] = useState("");
  
  // Ledger state
  const [ledgerData, setLedgerData] = useState<LedgerRow[]>([]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    if (user.role !== "admin" && user.role !== "manager") {
      router.push("/dashboard");
      return;
    }
    fetchBaseData();
    fetchRecon();
    fetchLedger();
  }, [user]);

  const fetchBaseData = async () => {
    try {
      const pData: any = await apiFetch("/admin/products");
      setProducts(pData.items || pData);
      
      const uData: any = await apiFetch("/users");
      const list = uData.items || uData;
      setOfficers(list.filter((u: any) => u.role === "field_officer" || u.role === "sales_officer"));
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRecon = async () => {
    try {
      const d: any = await apiFetch("/stock/reconciliation");
      setReconData(d);
    } catch(e) {}
  };

  const fetchLedger = async () => {
    try {
      const d: any = await apiFetch("/stock/ledger?limit=200");
      setLedgerData(d);
    } catch(e) {}
  };

  const handleIssueSubmit = async () => {
    if (!selectedOfficer) return alert("Select an officer first.");
    const allocations = Object.keys(issueInputs)
      .map(pid => ({ product_id: pid, quantity: parseFloat(issueInputs[pid] || "0") }))
      .filter(x => x.quantity > 0 && !isNaN(x.quantity));
      
    if (allocations.length === 0) return alert("No valid quantities to issue.");
    
    try {
      await apiFetch("/stock/allocations", {
        method: "POST",
        body: JSON.stringify({ allocations: allocations.map(a => ({ ...a, officer_id: selectedOfficer })) })
      });
      alert("Stock issued successfully!");
      setIssueInputs({});
      fetchRecon();
      fetchLedger();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const lines = text.split("\n").map(l => l.trim()).filter(l => l);
      if (lines.length < 2) return alert("File seems empty.");
      
      const headers = (lines[0] || "").split(",").map(h => h.trim().toLowerCase());
      const empIdx = headers.indexOf("officer_employee_id");
      const skuIdx = headers.indexOf("sku_code");
      const qtyIdx = headers.indexOf("quantity");
      
      if (empIdx < 0 || skuIdx < 0 || qtyIdx < 0) {
        return alert("Missing required columns: officer_employee_id, sku_code, quantity");
      }
      
      const preview = [];
      const errs = [];
      
      for (let i = 1; i < lines.length; i++) {
        const cols = (lines[i] || "").split(",").map(c => c.trim());
        const empId = cols[empIdx];
        const sku = cols[skuIdx];
        const qty = parseFloat(cols[qtyIdx] || "0");
        
        const officer = officers.find(o => o.employee_id === empId);
        const prod = products.find(p => p.sku_code === sku);
        
        if (!officer) { errs.push(`Row ${i+1}: Officer employee_id ${empId} not found.`); continue; }
        if (!prod) { errs.push(`Row ${i+1}: Product sku_code ${sku} not found.`); continue; }
        if (isNaN(qty) || qty <= 0) { errs.push(`Row ${i+1}: Invalid quantity ${cols[qtyIdx]}.`); continue; }
        
        preview.push({ officer_id: officer.id, product_id: prod.id, quantity: qty, officer_name: officer.full_name, product_name: prod.name });
      }
      
      setUploadPreview(preview);
      setUploadErrors(errs);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };
  
  const handleUploadConfirm = async () => {
    if (uploadPreview.length === 0) return;
    try {
      setUploading(true);
      await apiFetch("/stock/allocations", {
        method: "POST",
        body: JSON.stringify({ allocations: uploadPreview.map(p => ({ officer_id: p.officer_id, product_id: p.product_id, quantity: p.quantity })) })
      });
      alert("Stock allocated from CSV!");
      setUploadPreview([]);
      setUploadErrors([]);
      fetchRecon();
      fetchLedger();
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  const exportReconCSV = () => {
    let csv = "Officer,Product,Allocated,Given as trials,Sold,Other,In hand\n";
    reconData.forEach(r => {
      csv += `"${r.officer_name}","${r.product_name}",${r.allocated},${r.trial_given},${r.sold},${r.other},${r.on_hand}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "stock_reconciliation.csv";
    a.click();
  };

  if (authLoading) return <main className="p-6">Loading...</main>;

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <SectionTabs showSections />
        <button onClick={() => router.push("/dashboard")} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>

        <h1 className="text-2xl font-bold text-slate-900">Stock Management</h1>

        <div className="flex border-b border-slate-200">
          {(["issue", "recon", "ledger"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 font-medium text-sm ${tab === t ? "text-primary-700 border-b-2 border-primary-700" : "text-slate-500 hover:text-slate-700"}`}>
              {t === "issue" ? "Issue Stock" : t === "recon" ? "Stock with Officers" : "History"}
            </button>
          ))}
        </div>

        {tab === "issue" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
            <div className="bg-white p-6 rounded-xl border border-slate-200">
              <h2 className="text-lg font-semibold mb-4">Manual Allocation</h2>
              <div className="flex flex-wrap gap-3 mb-4">
                <select className="border border-slate-300 rounded p-2 w-full max-w-sm" value={selectedOfficer} onChange={e => setSelectedOfficer(e.target.value)}>
                  <option value="">-- Select Officer --</option>
                  {officers.map(o => <option key={o.id} value={o.id}>{o.full_name} ({o.employee_id || o.email})</option>)}
                </select>
                <input
                  type="search"
                  placeholder="Search product or SKU..."
                  className="border border-slate-300 rounded p-2 w-full max-w-sm"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                />
              </div>

              <table className="w-full text-left text-sm mb-4 border">
                <thead className="bg-slate-50 border-b">
                  <tr><th className="p-3">Product</th><th className="p-3">Quantity to Issue</th></tr>
                </thead>
                <tbody>
                  {products
                    .filter(p => p.is_active)
                    .filter(p => {
                      const q = productSearch.trim().toLowerCase();
                      return !q || p.name.toLowerCase().includes(q) || (p.sku_code || "").toLowerCase().includes(q);
                    })
                    .map(p => (
                    <tr key={p.id} className={`border-b ${parseFloat(issueInputs[p.id] || "0") > 0 ? "bg-green-50" : ""}`}>
                      <td className="p-3">{p.name} ({p.sku_code})</td>
                      <td className="p-3">
                        <input type="number" min="0" className="border rounded p-1 w-24" value={issueInputs[p.id] || ""} onChange={e => setIssueInputs({...issueInputs, [p.id]: e.target.value})} />
                      </td>
                    </tr>
                  ))}
                  {products.filter(p => p.is_active).every(p => {
                    const q = productSearch.trim().toLowerCase();
                    return q && !(p.name.toLowerCase().includes(q) || (p.sku_code || "").toLowerCase().includes(q));
                  }) && (
                    <tr><td colSpan={2} className="p-4 text-center text-slate-400">No product matches &quot;{productSearch}&quot;.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {(() => {
              const picked = products.filter(p => parseFloat(issueInputs[p.id] || "0") > 0);
              const officer = officers.find(o => o.id === selectedOfficer);
              return (
                <div className="bg-white p-5 rounded-xl border border-slate-200 lg:sticky lg:top-4 space-y-3">
                  <h3 className="text-base font-semibold">Allocation Summary</h3>
                  <p className="text-sm text-slate-600">
                    Officer: <b>{officer ? officer.full_name : "not selected"}</b>
                  </p>
                  <div className="max-h-[50vh] overflow-y-auto divide-y border rounded">
                    {picked.length === 0 ? (
                      <p className="p-3 text-sm text-slate-400">No products selected yet. Type a quantity next to a product.</p>
                    ) : picked.map(p => (
                      <div key={p.id} className="flex items-center justify-between gap-2 p-2 text-sm">
                        <span className="min-w-0 truncate" title={p.name}>{p.name}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <b>{issueInputs[p.id]}</b>
                          <button
                            onClick={() => { const n = { ...issueInputs }; delete n[p.id]; setIssueInputs(n); }}
                            className="text-slate-400 hover:text-red-600"
                            aria-label={`Remove ${p.name}`}
                          >✕</button>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">{picked.length} product{picked.length === 1 ? "" : "s"} selected</p>
                  <button
                    onClick={handleIssueSubmit}
                    disabled={picked.length === 0 || !selectedOfficer}
                    className="w-full bg-primary-700 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-800 disabled:opacity-40 transition"
                  >
                    Submit Allocation
                  </button>
                </div>
              );
            })()}
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200">
              <h2 className="text-lg font-semibold mb-4">Bulk Upload via CSV</h2>
              <p className="text-sm text-slate-600 mb-4">CSV format must have headers: <code>officer_employee_id, sku_code, quantity</code></p>
              <input type="file" accept=".csv" onChange={handleFileUpload} ref={fileInputRef} className="mb-4" />
              
              {uploadErrors.length > 0 && (
                <div className="text-red-600 text-sm mb-4 p-4 bg-red-50 rounded">
                  <p className="font-bold mb-2">Errors in CSV:</p>
                  <ul className="list-disc pl-4">{uploadErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
              
              {uploadPreview.length > 0 && (
                <div className="mb-4">
                  <p className="font-bold mb-2">Ready to Allocate:</p>
                  <table className="w-full text-left text-sm border">
                    <thead className="bg-slate-50 border-b"><tr><th className="p-2">Officer</th><th className="p-2">Product</th><th className="p-2">Quantity</th></tr></thead>
                    <tbody>
                      {uploadPreview.map((p, i) => (
                        <tr key={i} className="border-b"><td className="p-2">{p.officer_name}</td><td className="p-2">{p.product_name}</td><td className="p-2">{p.quantity}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={handleUploadConfirm} disabled={uploading} className="mt-4 bg-green-600 text-white px-4 py-2 rounded font-medium hover:bg-green-700">Confirm & Save All</button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "recon" && (
          <div className="bg-white p-6 rounded-xl border border-slate-200">
            <div className="flex justify-between mb-4">
              <input type="text" placeholder="Filter officer or product..." className="border p-2 rounded text-sm w-64" value={reconFilter} onChange={e => setReconFilter(e.target.value)} />
              <button onClick={exportReconCSV} className="flex items-center gap-2 text-sm bg-slate-100 px-3 py-1.5 rounded font-medium hover:bg-slate-200"><Download className="w-4 h-4"/> Export CSV</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border whitespace-nowrap">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="p-3">Officer</th><th className="p-3">Product</th>
                    <th className="p-3 text-right text-blue-600">Issued</th>
                    <th className="p-3 text-right text-orange-600">Trials</th>
                    <th className="p-3 text-right text-green-600">Sold</th>
                    <th className="p-3 text-right text-slate-500">Other</th>
                    <th className="p-3 text-right font-bold">In hand</th>
                  </tr>
                </thead>
                <tbody>
                  {reconData.filter(r => (r.officer_name + r.product_name).toLowerCase().includes(reconFilter.toLowerCase())).map((r, i) => (
                    <tr key={i} className="border-b hover:bg-slate-50">
                      <td className="p-3 font-medium">{r.officer_name}</td><td className="p-3">{r.product_name}</td>
                      <td className="p-3 text-right">{r.allocated}</td><td className="p-3 text-right">{r.trial_given}</td>
                      <td className="p-3 text-right">{r.sold}</td><td className="p-3 text-right">{r.other}</td>
                      <td className="p-3 text-right font-bold">{r.on_hand}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "ledger" && (
          <div className="bg-white p-6 rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-left text-sm border whitespace-nowrap">
              <thead className="bg-slate-50 border-b">
                <tr><th className="p-3">Date</th><th className="p-3">Officer</th><th className="p-3">Product</th><th className="p-3">Movement</th><th className="p-3">Delta</th><th className="p-3">Remarks</th></tr>
              </thead>
              <tbody>
                {ledgerData.map((l, i) => (
                  <tr key={i} className="border-b hover:bg-slate-50">
                    <td className="p-3 text-slate-500">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="p-3 font-medium">{l.officer_name}</td>
                    <td className="p-3">{l.product_name}</td>
                    <td className="p-3">{l.movement_type}</td>
                    <td className={`p-3 font-bold ${l.qty_delta > 0 ? "text-green-600" : "text-red-600"}`}>{l.qty_delta > 0 ? "+" : ""}{l.qty_delta}</td>
                    <td className="p-3 text-slate-500">{l.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
