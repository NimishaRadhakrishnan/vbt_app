"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { todayIST } from "@/lib/dates";
import type { Place, RawHistoryRow, Stop, TimelineEvent } from "./types";
import { analyzeDay, DEFAULT_OPTIONS, positionAt } from "./routeAnalysis";
import { addDays, fmtDate, fmtDistance, fmtDuration } from "./format";
import { buildCsv, downloadText } from "./exportUtils";
import FilterBar, { OfficerOption } from "./FilterBar";
import SummaryCards from "./SummaryCards";
import RouteMap, { MapFocus } from "./RouteMap";
import Timeline from "./Timeline";
import PlaybackControls from "./PlaybackControls";
import QualityReport from "./QualityReport";
import { ErrorCard, InfoBanner, NoDataState, PickOfficerState } from "./EmptyState";

/** 1x plays one minute of the day per real second. */
const SIM_SECONDS_PER_SECOND = 60;
/** Days shorter than this get a notice instead of a replay bar. */
const MIN_REPLAY_MS = 10 * 60_000;
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

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return el.type !== "range" && el.type !== "checkbox" && el.type !== "radio";
  return false;
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

  const [currentT, setCurrentT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(5);
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
    setPlaying(false);

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

  // New day: playhead back to the start.
  useEffect(() => {
    setPlaying(false);
    setFocus(null);
    setCurrentT(analysis ? analysis.startT : 0);
  }, [analysis]);

  const t = analysis ? Math.max(analysis.startT, Math.min(analysis.endT, currentT || analysis.startT)) : 0;
  const tRef = useRef(t);
  tRef.current = t;

  const playable = !!analysis && analysis.points.length > 1 && analysis.summary.spanMs >= MIN_REPLAY_MS;
  const position = useMemo(
    () => (analysis && playable ? positionAt(analysis.points, t, DEFAULT_OPTIONS.gapMs) : null),
    [analysis, playable, t],
  );
  const activeStopId = useMemo(() => {
    if (!analysis || !playable) return null;
    return analysis.stops.find((s) => t >= s.arrival && t <= s.departure)?.id ?? null;
  }, [analysis, playable, t]);

  // ---- playback -----------------------------------------------------------
  useEffect(() => {
    if (!playing || !analysis) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const next = tRef.current + dt * SIM_SECONDS_PER_SECOND * speed;
      if (next >= analysis.endT) {
        setCurrentT(analysis.endT);
        setPlaying(false);
      } else {
        tRef.current = next;
        setCurrentT(next);
      }
    }, 100);
    return () => clearInterval(id);
  }, [playing, speed, analysis]);

  const seek = useCallback(
    (to: number, opts?: { focus?: { lat: number; lng: number } | "position" }) => {
      if (!analysis) return;
      const c = Math.max(analysis.startT, Math.min(analysis.endT, to));
      setCurrentT(c);
      if (opts?.focus) {
        const target =
          opts.focus === "position" ? positionAt(analysis.points, c, DEFAULT_OPTIONS.gapMs) : opts.focus;
        if (target) setFocus({ lat: target.lat, lng: target.lng, nonce: Date.now() });
      }
    },
    [analysis],
  );

  const togglePlay = useCallback(() => {
    if (!analysis || !playable) return;
    if (!playing && tRef.current >= analysis.endT - 1000) seek(analysis.startT);
    setPlaying((p) => !p);
  }, [analysis, playable, playing, seek]);

  const stops = analysis?.stops ?? [];
  const prevStopTarget = useMemo(() => {
    if (!analysis) return null;
    const before = [...stops].reverse().find((s) => s.arrival < t - 1000);
    return before ?? null;
  }, [analysis, stops, t]);
  const nextStopTarget = useMemo(() => stops.find((s) => s.arrival > t + 1000) ?? null, [stops, t]);

  const goToStop = useCallback(
    (s: Stop) => {
      setPlaying(false);
      seek(s.arrival, { focus: { lat: s.lat, lng: s.lng } });
    },
    [seek],
  );
  const onPrevStop = useCallback(() => {
    if (!analysis) return;
    if (prevStopTarget) goToStop(prevStopTarget);
    else {
      setPlaying(false);
      seek(analysis.startT, { focus: "position" });
    }
  }, [analysis, prevStopTarget, goToStop, seek]);
  const onNextStop = useCallback(() => {
    if (!analysis) return;
    if (nextStopTarget) goToStop(nextStopTarget);
    else {
      setPlaying(false);
      seek(analysis.endT, { focus: "position" });
    }
  }, [analysis, nextStopTarget, goToStop, seek]);

  const onSelectEvent = useCallback(
    (e: TimelineEvent) => {
      setPlaying(false);
      if (e.kind === "stop") goToStop(e.stop);
      else seek(e.at, { focus: "position" });
    },
    [goToStop, seek],
  );

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    if (!analysis || !playable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const onButton = e.target instanceof HTMLElement && (e.target.tagName === "BUTTON" || e.target.tagName === "A");
      switch (e.key) {
        case " ":
          if (onButton) return; // let the focused button handle its own Space
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(tRef.current + (e.shiftKey ? 10 : 1) * 60_000);
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(tRef.current - (e.shiftKey ? 10 : 1) * 60_000);
          break;
        case "]":
          e.preventDefault();
          onNextStop();
          break;
        case "[":
          e.preventDefault();
          onPrevStop();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analysis, playable, togglePlay, seek, onNextStop, onPrevStop]);

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
  const short = !!analysis && analysis.points.length > 1 && analysis.summary.spanMs < MIN_REPLAY_MS;

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
              Only one GPS point was recorded on this day, so there is no route to replay. The marker shows where it was.
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
                currentT={t}
                position={position}
                activeStopId={activeStopId}
                focus={focus}
                fitNonce={fitNonce}
                follow={playing}
                onFit={() => setFitNonce((n) => n + 1)}
                onStopClick={goToStop}
              />
            )}
            <Timeline analysis={analysis} loading={loading || !analysis} currentT={t} highlight={playable} onSelect={onSelectEvent} />
          </div>

          {analysis && short && (
            <InfoBanner>
              Only {fmtDuration(analysis.summary.spanMs)} of tracking on this day, which is too short to replay. The route and timeline above show everything that was recorded.
            </InfoBanner>
          )}

          {analysis && playable && (
            <PlaybackControls
              analysis={analysis}
              currentT={t}
              position={position}
              playing={playing}
              speed={speed}
              hasPrevStop={true}
              hasNextStop={true}
              onToggle={togglePlay}
              onSeek={(to) => seek(to)}
              onSpeed={setSpeed}
              onPrevStop={onPrevStop}
              onNextStop={onNextStop}
            />
          )}
        </>
      )}
    </div>
  );
}
