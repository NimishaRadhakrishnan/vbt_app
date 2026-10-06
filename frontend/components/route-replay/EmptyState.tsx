"use client";

import { AlertTriangle, CalendarSearch, Info, RefreshCw, MapPinOff } from "lucide-react";

function Illustration() {
  return (
    <svg viewBox="0 0 160 110" className="h-28 w-40" role="img" aria-label="No route recorded">
      <rect x="6" y="14" width="148" height="86" rx="12" fill="#f1f5f9" />
      <path d="M22 78 C 44 40, 70 92, 96 54 S 134 38, 140 30" fill="none" stroke="#cbd5e1" strokeWidth="4" strokeDasharray="2 9" strokeLinecap="round" />
      <circle cx="22" cy="78" r="7" fill="#e2e8f0" />
      <circle cx="140" cy="30" r="9" fill="#fecaca" />
      <circle cx="140" cy="30" r="3.5" fill="#9f1d1d" />
    </svg>
  );
}

export function NoDataState({
  officerName,
  dateLabel,
  onJump,
  jumping,
  jumpMessage,
}: {
  officerName: string;
  dateLabel: string;
  onJump: () => void;
  jumping: boolean;
  jumpMessage: string | null;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <Illustration />
      <h3 className="mt-4 text-lg font-semibold text-slate-900">No tracking data for {officerName} on {dateLabel}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        The phone did not send any location that day. They may have been off duty, on leave, or not checked in.
      </p>
      <button
        type="button"
        onClick={onJump}
        disabled={jumping}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-primary-700 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
      >
        {jumping ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarSearch className="h-4 w-4" aria-hidden />}
        {jumping ? "Searching nearby days..." : "Jump to the nearest day with data"}
      </button>
      {jumpMessage && <p className="mt-3 text-sm text-slate-500" role="status">{jumpMessage}</p>}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-4 rounded-xl border border-rose-200 bg-rose-50 p-5">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-rose-900">Could not load the route</h3>
        <p className="mt-1 text-sm text-rose-800">{message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 text-sm font-medium text-rose-800 transition-colors duration-150 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        Retry
      </button>
    </div>
  );
}

export function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function PickOfficerState() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <MapPinOff className="h-10 w-10 text-slate-300" aria-hidden />
      <h3 className="mt-3 text-lg font-semibold text-slate-900">Choose an officer</h3>
      <p className="mt-1 text-sm text-slate-500">Their route, stops and timeline for the day will appear here.</p>
    </div>
  );
}
