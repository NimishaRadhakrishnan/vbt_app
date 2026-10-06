"use client";

import { AlertTriangle, X } from "lucide-react";

interface Props {
  title: string;
  data: any | null;
  error: string | null;
  onClose: () => void;
}

/** The existing GET /location/diagnostics report, shown under the filter bar. */
export default function QualityReport({ title, data, error, onClose }: Props) {
  return (
    <section aria-label="Data quality report" className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close data quality report"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      {data && !error && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Pings recorded", data.ping_count ?? "—"],
              ["Delivery rate", data.delivery_rate_pct != null ? `${data.delivery_rate_pct}%` : "—"],
              ["Accuracy (avg)", data.accuracy_summary?.avg != null ? `${data.accuracy_summary.avg} m` : "—"],
              ["Low-accuracy pings", data.low_accuracy_pct != null ? `${data.low_accuracy_pct}%` : "—"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs font-medium text-slate-500">{label}</div>
                <div className="text-lg font-semibold text-slate-900">{value}</div>
              </div>
            ))}
          </div>
          {Array.isArray(data.suspect_jumps) && data.suspect_jumps.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              <span>
                <b>{data.suspect_jumps.length} suspicious jump{data.suspect_jumps.length === 1 ? "" : "s"}</b> flagged: a point moved more than 2 km in under a minute, which usually means a GPS glitch or a spoofed location.
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No suspicious jumps found for this day.</p>
          )}
        </>
      )}
    </section>
  );
}
