"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { todayIST } from "@/lib/dates";
import type { Place, RawHistoryRow, Stop, TimelineEvent } from "./types";
import { analyzeDay } from "./routeAnalysis";
import { addDays, fmtDate, fmtDistance } from "./format";
import { buildCsv, downloadText } from "./exportUtils";
import FilterBar, { OfficerOption } from "./FilterBar";
import SummaryCards from "./SummaryCards";
import RouteMap, { MapFocus } from "./RouteMap";
import Timeline, { placeKey } from "./Timeline";
import QualityReport from "./QualityReport";
import { ErrorCard, InfoBanner, NoDataState, PickOfficerState } from "./EmptyState";

/** Most positions the server names in one request. */
const NAME_BATCH = 60;
const SEARCH_DAYS = 14;

export interface RouteReplayScreenProps {
  officers: OfficerOption[];
  /** Dealers, farmers, clinics ... used to name stops. */
  places?: Place[];
  officerId: string;
  onOfficerChange: (id: string) => void;
  date: string;
  onDateChange: (date: string) => void;
  /** Replace the real API (used by the demo page). */
  fetchDay?: (officerId: string, date: string) => Promise<RawHistoryRow[]>;
  fetchDiagnostics?: (officerId: string, date: string) => Promise<any>;
  demo?: boolean;
}

async function defaultFetchDay(officerId: string, date: string): Promise<RawHistoryRow[]> {
  const rows = await apiFetch(`/location/history/${officerId}?date=${encodeURIComponent(date)}`);
  return Array.isArray(rows) ? (rows as RawHistoryRow[]) : [];
}

async function defaultFetchDiagnostics(officerId: string, date: string): Promise<any> {
  return apiFetch(`/location/diagnostics/${officerId}?date=${encodeURIComponent(date)}`);
}

export default function RouteReplayScreen({
  officers,
  places = [],
  officerId,
  onOfficerChange,
  date,
  onDateChange,
  fetchDay = defaultFetchDay,
  fetchDiagnostics = defaultFetchDiagnostics,
  demo = false,
}: RouteReplayScreenProps) {
  const today = todayIST();

  // Callers often pass fresh function/array objects on every render. Keep the
  // latest in refs so a parent re-render never restarts a fetch or re-fits the map.
  const fetchDayRef = useRef(fetchDay);
  fetchDayRef.current = fetchDay;
  const fetchDiagRef = useRef(fetchDiagnostics);
  fetchDiagRef.current = fetchDiagnostics;
  const placesRef = useRef(places);
  placesRef.current = places;
  const placesSig = places.map((p) => p.id).join("|");

  const [rows, setRows] = useState<RawHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  const [jumping, setJumping] = useState(false);
  const [jumpMessage, setJumpMessage] = useState<string | null>(null);
  const searchToken = useRef(0);

  const [diagOpen, setDiagOpen] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diag, setDiag] = useState<any | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);

  const officer = officers.find((o) => o.id === officerId) ?? null;

  // ---- load the day -------------------------------------------------------
  useEffect(() => {
    searchToken.current++; // abandon any "nearest day" search
    setJumping(false);
    setJumpMessage(null);
    setDiagOpen(false);
    setDiag(null);
    setDiagError(null);
    setSelectedId(null);

    if (!officerId || !date) {
      setRows(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows(null);
    fetchDayRef
      .current(officerId, date)
      .then((r) => {
        if (!cancelled) setRows(Array.isArray(r) ? r : []);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "The server did not answer. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [officerId, date, reloadKey]);

  const analysis = useMemo(
    () => (rows ? analyzeDay(rows, placesRef.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, placesSig],
  );

  // New day: nothing selected, map shows the whole route.
  useEffect(() => {
    setFocus(null);
    setSelectedId(null);
  }, [analysis]);

  // Names for the places on the timeline. Stops that match a dealer, farmer or
  // clinic already have one; every other stop, plus the first and last
  // position of the day, is looked up (and cached) by the server.
  useEffect(() => {
    if (!analysis || demo) return;
    const wanted = new Map<string, { lat: number; lng: number }>();
    const want = (lat: number, lng: number) => {
      const key = placeKey(lat, lng);
      if (!wanted.has(key)) wanted.set(key, { lat, lng });
    };
    for (const s of analysis.stops) if (!s.placeName) want(s.lat, s.lng);
    const first = analysis.points[0];
    const last = analysis.points[analysis.points.length - 1];
    if (first) want(first.lat, first.lng);
    if (last) want(last.lat, last.lng);
    // Where the signal was lost and where it came back (the first 20 gaps).
    for (const g of analysis.gaps.slice(0, 20)) {
      const a = analysis.points[g.fromIdx];
      const b = analysis.points[g.toIdx];
      if (a) want(a.lat, a.lng);
      if (b) want(b.lat, b.lng);
    }
    const entries = [...wanted.entries()];
    if (entries.length === 0) return;

    let cancelled = false;
    (async () => {
      for (let i = 0; i < entries.length; i += NAME_BATCH) {
        const chunk = entries.slice(i, i + NAME_BATCH);
        try {
          const res: any = await apiFetch("/location/place-names", {
            method: "POST",
            body: JSON.stringify({ points: chunk.map(([, p]) => ({ lat: p.lat, lng: p.lng })) }),
          });
          if (cancelled) return;
          const found: Record<string, string> = {};
          (res?.names ?? []).forEach((n: string | null, j: number) => {
            if (n) found[chunk[j]![0]] = n;
          });
          setNames((prev) => ({ ...prev, ...found }));
        } catch {
          return; // names are a nicety: the coordinates are shown instead
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysis, demo]);

  const goToStop = useCallback((s: Stop) => {
    setSelectedId(s.id);
    setFocus({ lat: s.lat, lng: s.lng, nonce: Date.now() });
  }, []);

  const onSelectEvent = useCallback(
    (e: TimelineEvent) => {
      if (!analysis) return;
      if (e.kind === "stop") {
        goToStop(e.stop);
        return;
      }
      const idx = e.kind === "gap" ? e.gap.fromIdx : e.kind === "travel" ? e.fromIdx : e.idx;
      const p = analysis.points[idx];
      setSelectedId(e.id);
      if (p) setFocus({ lat: p.lat, lng: p.lng, nonce: Date.now() });
    },
    [analysis, goToStop],
  );

  // ---- actions ------------------------------------------------------------
  const jumpToNearest = async () => {
    const token = ++searchToken.current;
    setJumping(true);
    setJumpMessage(null);
    try {
      for (let k = 1; k <= SEARCH_DAYS; k++) {
        for (const d of [addDays(date, -k), addDays(date, k)]) {
          if (d > today) continue;
          const r = await fetchDayRef.current(officerId, d);
          if (token !== searchToken.current) return;
          if (Array.isArray(r) && analyzeDay(r) !== null) {
            setJumping(false);
            onDateChange(d);
            return;
          }
        }
      }
      if (token === searchToken.current) {
        setJumpMessage(`No tracking data in the ${SEARCH_DAYS} days either side of ${fmtDate(date)}.`);
      }
    } catch {
      if (token === searchToken.current) setJumpMessage("Could not search other days. Please try again.");
    } finally {
      if (token === searchToken.current) setJumping(false);
    }
  };

  const runQualityReport = async () => {
    if (!officerId) return;
    setDiagOpen(true);
    setDiagBusy(true);
    setDiagError(null);
    try {
      setDiag(await fetchDiagRef.current(officerId, date));
    } catch (e: any) {
      setDiag(null);
      setDiagError(e?.message || "Could not run the data quality check.");
    } finally {
      setDiagBusy(false);
    }
  };

  const onExport = (kind: "csv" | "print") => {
    if (!analysis) return;
    if (kind === "print") {
      window.print();
      return;
    }
    const safe = (officer?.name ?? "officer").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    downloadText(`route-${safe}-${date}.csv`, buildCsv(analysis, officer?.name ?? "Officer", date));
  };

  // ---- render -------------------------------------------------------------
  const summaryLine = analysis
    ? `${officer?.name ?? "Officer"} · ${fmtDate(date)} · ${analysis.stops.length} stop${analysis.stops.length === 1 ? "" : "s"} · ${fmtDistance(analysis.summary.distanceM)}`
    : officer
      ? `${officer.name} · ${fmtDate(date)}`
      : null;

  const empty = !loading && !error && rows !== null && analysis === null;
  const single = !!analysis && analysis.points.length === 1;

  return (
    <div className="space-y-4">
      {demo && (
        <InfoBanner>
          <b>Demo data.</b> Nothing here is real. Pick an officer to see each state: full day, signal gaps, a 2-minute day, one point, no data, and an API error.
        </InfoBanner>
      )}

      <FilterBar
        officers={officers}
        officerId={officerId}
        onOfficerChange={onOfficerChange}
        date={date}
        onDateChange={onDateChange}
        today={today}
        quality={analysis?.quality ?? null}
        summaryLine={summaryLine}
        canExport={!!analysis}
        onExport={onExport}
        onQualityReport={runQualityReport}
        qualityReportBusy={diagBusy}
      />

      {diagOpen && (diag || diagError) && (
        <QualityReport
          title={`GPS data quality${diag?.date ? ` - ${diag.date}` : ""}`}
          data={diag}
          error={diagError}
          onClose={() => setDiagOpen(false)}
        />
      )}

      {!officerId ? (
        <PickOfficerState />
      ) : error ? (
        <ErrorCard message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : empty ? (
        <NoDataState
          officerName={officer?.name ?? "this officer"}
          dateLabel={fmtDate(date)}
          onJump={jumpToNearest}
          jumping={jumping}
          jumpMessage={jumpMessage}
        />
      ) : (
        <>
          <SummaryCards analysis={analysis} loading={loading || !analysis} />

          {single && (
            <InfoBanner>
              Only one GPS point was recorded on this day, so there is no route to show. The marker shows where it was.
            </InfoBanner>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
            {loading || !analysis ? (
              <div className="flex h-[540px] items-center justify-center rounded-xl border border-slate-200 bg-slate-100" aria-busy aria-label="Loading map">
                <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary-700" />
                  Loading route...
                </div>
              </div>
            ) : (
              <RouteMap
                analysis={analysis}
                currentT={analysis.endT}
                position={null}
                activeStopId={selectedId}
                focus={focus}
                fitNonce={fitNonce}
                follow={false}
                onFit={() => setFitNonce((n) => n + 1)}
                onStopClick={goToStop}
              />
            )}
            <Timeline analysis={analysis} loading={loading || !analysis} names={names} selectedId={selectedId} onSelect={onSelectEvent} />
          </div>
        </>
      )}
    </div>
  );
}
