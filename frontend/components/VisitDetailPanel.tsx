"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import { downloadAuthenticatedFile } from "@/lib/api/download";
import PhotoGallery from "@/components/PhotoViewer";

// Extracted from app/dashboard/daily-visits/page.tsx (where it was
// previously a page-local, non-exported component) so the Day Closure
// Reports page can reuse it instead of building a second detail view -
// both pages ultimately show the same underlying `visits` record via the
// same GET /admin/daily-visits/{visit_id} endpoint, a day closure's
// "detail" IS a visit's detail. Behavior unchanged from the original.
export function VisitDetailPanel({ visitId, onClose }: { visitId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    apiFetch<any>(`/admin/daily-visits/${visitId}`)
      .then(setDetail)
      .catch((err) => setError(err.message || "Could not load visit detail."))
      .finally(() => setLoading(false));
  }, [visitId]);

  const pdfUrl = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1"}/admin/daily-visits/${visitId}/export/pdf`;

  return (
    <div className="fixed inset-0 bg-black/40 flex justify-end z-50">
      <div className="w-full max-w-2xl bg-white h-full overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">Visit Detail</h2>
          <div className="flex items-center gap-3">
            {/* Was <a href={pdfUrl}>. A browser navigation carries no
                Authorization header, so this returned
                {"detail":"Not authenticated"} instead of the PDF. This
                file lives in components/ rather than app/, which is why
                an earlier sweep of the page files missed it. */}
            <button
              onClick={async () => {
                setExporting(true);
                try {
                  await downloadAuthenticatedFile(pdfUrl, `visit-${visitId}.pdf`);
                } catch (e: any) {
                  alert(e.message || "Couldn't export.");
                } finally {
                  setExporting(false);
                }
              }}
              disabled={exporting}
              className="text-sm font-medium text-green-700 hover:underline disabled:opacity-50"
            >
              {exporting ? "Exporting…" : "Export PDF"}
            </button>
            <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {loading ? (
            <p className="text-slate-400 text-sm">Loading...</p>
          ) : error ? (
            <p className="text-red-600 text-sm">{error}</p>
          ) : detail ? (
            <>
              <DetailSection title="Officer" rows={[
                ["Name", detail.officer?.name],
                ["Employee ID", detail.officer?.employee_id],
                ["Manager", detail.officer?.manager],
                ["District", detail.officer?.district],
              ]} />
              <DetailSection title="Visit" rows={[
                ["Visit ID", detail.visit?.visit_id],
                ["Date", detail.visit?.date],
                ["Time", detail.visit?.time],
                ["Village/Block", detail.visit?.village_block],
                ["GPS", detail.visit?.gps ? `${detail.visit.gps.lat}, ${detail.visit.gps.lng}` : null],
              ]} />
              <DetailSection title="Farmer" rows={[
                ["Name", detail.farmer?.name],
                ["Contact", detail.farmer?.phone],
                ["Farm Size", detail.farmer?.farm_size],
              ]} />
              <DetailSection title="Crop" rows={[
                ["Category", detail.crop?.crop_category],
                ["Crop", detail.crop?.crop_name],
                ["Variety", detail.crop?.variety_name ?? detail.crop?.variety_text],
                ["Age", detail.crop?.crop_age_value ? `${detail.crop.crop_age_value} ${detail.crop.crop_age_unit}` : null],
                ["Sowing Date", detail.crop?.sowing_date],
                ["Previous Crop", detail.crop?.previous_crop_text],
              ]} />
              <DetailSection title="Crop Health" rows={[
                ["Status", detail.health?.status],
                ["Severity", detail.health?.severity],
                ["Pests", (detail.health?.pests ?? []).join(", ")],
                ["Diseases", (detail.health?.diseases ?? []).join(", ")],
              ]} />
              <DetailSection title="Trial / Demo" rows={[
                ["Trial", detail.trial?.is_trial ? "Yes" : "No"],
                ["Purpose", detail.trial?.purpose],
                ["Demo Status", detail.trial?.demo_status],
                ["Plot Size", detail.trial?.plot_size_cents ? `${detail.trial.plot_size_cents} cents` : null],
                ["Products", (detail.trial?.products ?? []).map((p: any) => `${p.product_name} (given ${p.quantity_given}, left ${p.quantity_leftover})`).join("; ")],
              ]} />
              <DetailSection title="Sales" rows={[
                ["Purchased", detail.sales?.purchased ? "Yes" : "No"],
                ["Order Value", detail.sales?.order_value ? `₹${detail.sales.order_value}` : null],
                ["Conversion Status", detail.sales?.conversion_status],
                ["Products Bought", (detail.sale_items ?? []).map((i: any) => `${i.product_name} x${i.quantity}`).join(", ")],
              ]} />
              <DetailSection title="Remarks" rows={[
                ["Officer Remarks", detail.remarks?.officer_remarks],
                ["Follow-up Date", detail.remarks?.follow_up_date],
                ["Follow-up Remarks", detail.remarks?.follow_up_remarks],
              ]} />
              {detail.photos?.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-green-700 mb-2">Photos</h3>
                  <PhotoGallery urls={detail.photos.map((p: any) => p.photo_url)} />
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, rows }: { title: string; rows: [string, any][] }) {
  const visibleRows = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div>
      <h3 className="text-sm font-bold text-green-700 mb-2">{title}</h3>
      {visibleRows.length === 0 ? (
        <p className="text-xs text-slate-400">Nothing recorded</p>
      ) : (
        <div className="space-y-1">
          {visibleRows.map(([label, value]) => (
            <div key={label} className="flex justify-between text-sm">
              <span className="text-slate-500">{label}</span>
              <span className="text-slate-800 font-medium text-right ml-4">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
