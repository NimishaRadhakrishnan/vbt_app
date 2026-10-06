"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { Quality } from "./types";
import { avatarColor, initials, roleLabel } from "./avatar";
import { addDays } from "./format";

export interface OfficerOption {
  id: string;
  name: string;
  role: string;
  employeeId?: string | null;
  territory?: string | null;
}

interface Props {
  officers: OfficerOption[];
  officerId: string;
  onOfficerChange: (id: string) => void;
  date: string;
  onDateChange: (date: string) => void;
  /** Latest selectable day (today in IST). */
  today: string;
  quality: Quality | null;
  summaryLine: string | null;
  canExport: boolean;
  onExport: (kind: "csv" | "print") => void;
  onQualityReport: () => void;
  qualityReportBusy: boolean;
}

const QUALITY_STYLE = {
  good: "bg-emerald-50 text-emerald-800 border-emerald-200",
  fair: "bg-amber-50 text-amber-800 border-amber-200",
  poor: "bg-rose-50 text-rose-800 border-rose-200",
} as const;
const QUALITY_DOT = { good: "bg-emerald-500", fair: "bg-amber-500", poor: "bg-rose-500" } as const;
const QUALITY_LABEL = { good: "Good", fair: "Fair", poor: "Poor" } as const;

export default function FilterBar({
  officers,
  officerId,
  onOfficerChange,
  date,
  onDateChange,
  today,
  quality,
  summaryLine,
  canExport,
  onExport,
  onQualityReport,
  qualityReportBusy,
}: Props) {
  const selected = officers.find((o) => o.id === officerId) ?? null;
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  const atToday = date >= today;
  const iconBtn =
    "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_4px_12px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[21px] font-semibold leading-tight text-slate-900">Historical Route Replay</h2>
          <p className="mt-1 min-h-[20px] text-sm text-slate-500" aria-live="polite">
            {summaryLine ?? "Pick an officer and a day to see where they went."}
          </p>
        </div>
        <div className="route-print-hide flex flex-wrap items-center gap-2">
          {quality && (
            <span
              title={quality.reasons.join("\n")}
              className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${QUALITY_STYLE[quality.level]}`}
            >
              <span className={`h-2 w-2 rounded-full ${QUALITY_DOT[quality.level]}`} aria-hidden />
              GPS quality: {QUALITY_LABEL[quality.level]}
              <span className="text-xs font-normal opacity-75">{quality.score}/100</span>
            </span>
          )}
          <div className="relative" ref={exportRef}>
            <button
              type="button"
              disabled={!canExport}
              onClick={() => setExportOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-4 w-4" aria-hidden />
              Export
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            {exportOpen && (
              <div
                role="menu"
                className="absolute right-0 z-[1000] mt-2 w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    onExport("csv");
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-700" aria-hidden />
                  <span>
                    Excel (.csv)
                    <span className="block text-xs text-slate-400">Timeline and every GPS point</span>
                  </span>
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    onExport("print");
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                >
                  <Printer className="h-4 w-4 text-primary-700" aria-hidden />
                  <span>
                    PDF
                    <span className="block text-xs text-slate-400">Opens print: choose Save as PDF</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onQualityReport}
            disabled={!officerId || qualityReportBusy}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {qualityReportBusy ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
            Data quality report
          </button>
        </div>
      </div>

      <div className="route-print-hide mt-4 flex flex-wrap items-end gap-4 border-t border-slate-100 pt-4">
        <div>
          <label htmlFor="route-officer" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Officer
          </label>
          <div className="relative flex h-11 min-w-[280px] items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 pl-2 pr-9 transition-colors duration-150 focus-within:border-blue-500 focus-within:bg-white hover:border-slate-300">
            {selected ? (
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: avatarColor(selected.id) }}
                aria-hidden
              >
                {initials(selected.name)}
              </span>
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-500" aria-hidden>
                ?
              </span>
            )}
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-slate-900">
                {selected ? selected.name : "Select an officer"}
              </span>
              <span className="block truncate text-xs text-slate-500">
                {selected
                  ? [roleLabel(selected.role), selected.territory, selected.employeeId].filter(Boolean).join(" · ")
                  : "Nobody selected"}
              </span>
            </span>
            <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-slate-400" aria-hidden />
            <select
              id="route-officer"
              value={officerId}
              onChange={(e) => onOfficerChange(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              <option value="">Select an officer</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} - {roleLabel(o.role)}
                  {o.territory ? ` - ${o.territory}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="route-date" className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Date
          </label>
          <div className="flex items-center gap-2">
            <button type="button" className={iconBtn} aria-label="Previous day" title="Previous day" onClick={() => onDateChange(addDays(date, -1))}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                id="route-date"
                type="date"
                value={date}
                max={today}
                onChange={(e) => e.target.value && onDateChange(e.target.value)}
                className="h-9 rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-800 transition-colors duration-150 hover:border-slate-300 focus-visible:border-blue-500 focus-visible:bg-white focus-visible:outline-none"
              />
            </div>
            <button
              type="button"
              className={iconBtn}
              aria-label="Next day"
              title="Next day"
              disabled={atToday}
              onClick={() => onDateChange(addDays(date, 1))}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              disabled={atToday}
              onClick={() => onDateChange(today)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Today
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
