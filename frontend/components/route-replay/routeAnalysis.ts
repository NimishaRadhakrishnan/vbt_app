/**
 * Everything the Route Replay screen derives from raw GPS points.
 * Pure functions only (no React, no Leaflet) so they can be unit tested.
 */
import type {
  Analysis,
  AnalysisOptions,
  Gap,
  Place,
  Position,
  Quality,
  RawHistoryRow,
  Stop,
  Summary,
  TimelineEvent,
  TrackPoint,
} from "./types";

export const DEFAULT_OPTIONS: AnalysisOptions = {
  stopRadiusM: 50,
  stopMinMs: 5 * 60_000,
  maxAccuracyM: 100,
  maxSpeedKmh: 120,
  gapMs: 10 * 60_000,
  placeMatchM: 150,
};

/** The server stores 9999 when the phone gave no accuracy figure. */
const UNKNOWN_ACCURACY = 9999;

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Compass bearing from a to b in degrees (0 = north, clockwise). */
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const y = Math.sin(rad(bLng - aLng)) * Math.cos(rad(bLat));
  const x =
    Math.cos(rad(aLat)) * Math.sin(rad(bLat)) -
    Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng - aLng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Parse rows, drop unusable ones, sort by time, collapse identical timestamps. */
export function toTrackPoints(rows: RawHistoryRow[]): { points: TrackPoint[]; invalid: number } {
  let invalid = 0;
  const out: TrackPoint[] = [];
  for (const r of rows) {
    const t = Date.parse(r?.recorded_at);
    const lat = Number(r?.lat);
    const lng = Number(r?.lng);
    const ok =
      Number.isFinite(t) &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0);
    if (!ok) {
      invalid++;
      continue;
    }
    const acc = typeof r.accuracy === "number" && Number.isFinite(r.accuracy) ? r.accuracy : null;
    out.push({
      lat,
      lng,
      t,
      speed: typeof r.speed === "number" && Number.isFinite(r.speed) ? r.speed : null,
      accuracy: acc !== null && acc >= UNKNOWN_ACCURACY ? null : acc,
      battery: typeof r.battery_level === "number" ? r.battery_level : null,
    });
  }
  out.sort((a, b) => a.t - b.t);
  const deduped: TrackPoint[] = [];
  for (const p of out) {
    const last = deduped[deduped.length - 1];
    if (last && last.t === p.t) continue;
    deduped.push(p);
  }
  return { points: deduped, invalid };
}

/**
 * Remove points that cannot be real: accuracy worse than the limit, or a
 * jump that would need more than maxSpeedKmh. If three points in a row are
 * "impossible" the next one is accepted, so one bad first fix cannot make
 * the whole day disappear.
 */
export function filterBadFixes(
  points: TrackPoint[],
  opts: Pick<AnalysisOptions, "maxAccuracyM" | "maxSpeedKmh">,
): { points: TrackPoint[]; badAccuracy: number; impossible: number } {
  let badAccuracy = 0;
  let impossible = 0;
  const kept: TrackPoint[] = [];
  let streak = 0;
  for (const p of points) {
    if (p.accuracy !== null && p.accuracy > opts.maxAccuracyM) {
      badAccuracy++;
      continue;
    }
    const prev = kept[kept.length - 1];
    if (prev) {
      const hours = (p.t - prev.t) / 3_600_000;
      if (hours > 0) {
        const kmh = haversineM(prev.lat, prev.lng, p.lat, p.lng) / 1000 / hours;
        if (kmh > opts.maxSpeedKmh && streak < 3) {
          impossible++;
          streak++;
          continue;
        }
      }
    }
    streak = 0;
    kept.push(p);
  }
  return { points: kept, badAccuracy, impossible };
}

export function detectGaps(points: TrackPoint[], gapMs: number): Gap[] {
  const gaps: Gap[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (b.t - a.t > gapMs) {
      gaps.push({
        id: `gap-${i}`,
        from: a.t,
        to: b.t,
        durationMs: b.t - a.t,
        fromIdx: i - 1,
        toIdx: i,
      });
    }
  }
  return gaps;
}

interface RawStop {
  lat: number;
  lng: number;
  startIdx: number;
  endIdx: number;
}

/**
 * A stop is a run of points that stay within stopRadiusM of the run's centre
 * for at least stopMinMs. A silent stretch longer than gapMs always ends a
 * run (we cannot know the officer stayed). One stray point outside the
 * radius, followed by a point back inside it, is treated as GPS noise and
 * does not split the stop.
 */
export function detectStopRanges(
  points: TrackPoint[],
  opts: Pick<AnalysisOptions, "stopRadiusM" | "stopMinMs" | "gapMs">,
): RawStop[] {
  const stops: RawStop[] = [];
  if (points.length === 0) return stops;

  let startIdx = 0;
  let lastIdx = 0;
  let sumLat = points[0]!.lat;
  let sumLng = points[0]!.lng;
  let n = 1;

  const close = () => {
    const a = points[startIdx]!;
    const b = points[lastIdx]!;
    if (b.t - a.t >= opts.stopMinMs) {
      stops.push({ lat: sumLat / n, lng: sumLng / n, startIdx, endIdx: lastIdx });
    }
  };
  const begin = (i: number) => {
    startIdx = i;
    lastIdx = i;
    sumLat = points[i]!.lat;
    sumLng = points[i]!.lng;
    n = 1;
  };

  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1]!;
    if (p.t - prev.t > opts.gapMs) {
      close();
      begin(i);
      continue;
    }
    const cLat = sumLat / n;
    const cLng = sumLng / n;
    if (haversineM(cLat, cLng, p.lat, p.lng) <= opts.stopRadiusM) {
      sumLat += p.lat;
      sumLng += p.lng;
      n++;
      lastIdx = i;
      continue;
    }
    // Outside the radius: noise or a real departure?
    const next = points[i + 1];
    if (
      next &&
      next.t - p.t <= opts.gapMs &&
      haversineM(cLat, cLng, next.lat, next.lng) <= opts.stopRadiusM
    ) {
      continue; // one stray fix, ignore it
    }
    close();
    begin(i);
  }
  close();
  return stops;
}

export function matchPlace(
  lat: number,
  lng: number,
  places: Place[],
  radiusM: number,
): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const pl of places) {
    if (!Number.isFinite(pl.lat) || !Number.isFinite(pl.lng)) continue;
    const d = haversineM(lat, lng, pl.lat, pl.lng);
    if (d <= radiusM && d < bestD) {
      best = pl;
      bestD = d;
    }
  }
  return best;
}

export function cumulativeDistance(points: TrackPoint[]): number[] {
  const cum: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const a = points[i - 1]!;
      const b = points[i]!;
      total += haversineM(a.lat, a.lng, b.lat, b.lng);
    }
    cum.push(total);
  }
  return cum;
}

export function medianIntervalMs(points: TrackPoint[], gapMs: number): number | null {
  const dts: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i]!.t - points[i - 1]!.t;
    if (dt > 0 && dt <= gapMs) dts.push(dt);
  }
  if (dts.length === 0) return null;
  dts.sort((a, b) => a - b);
  return dts[Math.floor(dts.length / 2)] ?? null;
}

export function scoreQuality(args: {
  spanMs: number;
  noSignalMs: number;
  medianMs: number | null;
  rawCount: number;
  removedCount: number;
  pointCount: number;
}): Quality {
  const { spanMs, noSignalMs, medianMs, rawCount, removedCount, pointCount } = args;
  let score = 100;
  const reasons: string[] = [];

  if (pointCount < 2 || spanMs <= 0) {
    return { level: "poor", score: 20, reasons: ["Too few GPS points to judge the day"] };
  }

  const gapShare = Math.min(1, noSignalMs / spanMs);
  if (noSignalMs > 0) {
    score -= Math.min(50, gapShare * 100 * 1.5);
    reasons.push(`No signal for ${fmtMinutes(noSignalMs)} (${Math.round(gapShare * 100)}% of the day)`);
  }

  if (medianMs !== null) {
    const sec = Math.round(medianMs / 1000);
    if (medianMs > 120_000) score -= 25;
    else if (medianMs > 60_000) score -= 12;
    else if (medianMs > 30_000) score -= 5;
    reasons.push(`Typical gap between pings: ${sec}s`);
  }

  if (rawCount > 0 && removedCount > 0) {
    const share = removedCount / rawCount;
    score -= Math.min(25, share * 100 * 0.7);
    reasons.push(`${removedCount} poor or impossible point${removedCount === 1 ? "" : "s"} ignored (${Math.round(share * 100)}%)`);
  }

  // Too little tracking to vouch for the day, however clean it looks.
  if (spanMs < 10 * 60_000) {
    score = Math.min(score, 60);
    reasons.push(`Only ${fmtMinutes(Math.max(spanMs, 60_000))} of tracking`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 80 ? "good" : score >= 55 ? "fair" : "poor";
  if (reasons.length === 0) reasons.push("Steady pings and no gaps");
  return { level, score, reasons };
}

function fmtMinutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

function buildEvents(
  points: TrackPoint[],
  cum: number[],
  stops: Stop[],
  gaps: Gap[],
): TimelineEvent[] {
  const last = points.length - 1;
  const events: TimelineEvent[] = [];
  events.push({ kind: "start", id: "start", at: points[0]!.t, idx: 0 });

  type Marker = { startIdx: number; endIdx: number; stop?: Stop; gap?: Gap };
  const markers: Marker[] = [
    ...stops.map((s) => ({ startIdx: s.startIdx, endIdx: s.endIdx, stop: s })),
    ...gaps.map((g) => ({ startIdx: g.fromIdx, endIdx: g.toIdx, gap: g })),
  ].sort((a, b) => a.startIdx - b.startIdx || a.endIdx - b.endIdx);

  let cursor = 0;
  const travel = (fromIdx: number, toIdx: number) => {
    if (toIdx <= fromIdx) return;
    const a = points[fromIdx]!;
    const b = points[toIdx]!;
    const distanceM = (cum[toIdx] ?? 0) - (cum[fromIdx] ?? 0);
    if (b.t - a.t < 60_000 && distanceM < 50) return; // not worth a row
    events.push({ kind: "travel", id: `travel-${fromIdx}-${toIdx}`, at: a.t, endAt: b.t, distanceM, fromIdx, toIdx });
  };

  for (const m of markers) {
    if (m.startIdx < cursor) continue; // overlapping marker, skip defensively
    travel(cursor, m.startIdx);
    if (m.stop) {
      events.push({ kind: "stop", id: m.stop.id, at: m.stop.arrival, endAt: m.stop.departure, stop: m.stop });
    } else if (m.gap) {
      events.push({ kind: "gap", id: m.gap.id, at: m.gap.from, endAt: m.gap.to, gap: m.gap });
    }
    cursor = m.endIdx;
  }
  travel(cursor, last);
  if (last > 0) events.push({ kind: "end", id: "end", at: points[last]!.t, idx: last });
  return events;
}

/** Full pipeline: raw rows in, everything the screen needs out. */
export function analyzeDay(
  rows: RawHistoryRow[],
  places: Place[] = [],
  options: Partial<AnalysisOptions> = {},
): Analysis | null {
  const opts: AnalysisOptions = { ...DEFAULT_OPTIONS, ...options };
  const { points: parsed, invalid } = toTrackPoints(rows);
  const { points, badAccuracy, impossible } = filterBadFixes(parsed, opts);
  if (points.length === 0) return null;

  const cumM = cumulativeDistance(points);
  const gaps = detectGaps(points, opts.gapMs);

  const stops: Stop[] = detectStopRanges(points, opts).map((r, i) => {
    const place = matchPlace(r.lat, r.lng, places, opts.placeMatchM);
    const a = points[r.startIdx]!;
    const b = points[r.endIdx]!;
    return {
      id: `stop-${i + 1}`,
      number: i + 1,
      lat: r.lat,
      lng: r.lng,
      arrival: a.t,
      departure: b.t,
      dwellMs: b.t - a.t,
      startIdx: r.startIdx,
      endIdx: r.endIdx,
      placeName: place?.name ?? null,
      placeType: place?.type ?? null,
    };
  });

  const startT = points[0]!.t;
  const endT = points[points.length - 1]!.t;
  const spanMs = endT - startT;
  const noSignalMs = gaps.reduce((s, g) => s + g.durationMs, 0);
  const stationaryMs = stops.reduce((s, st) => s + st.dwellMs, 0);
  const trackedMs = Math.max(0, spanMs - noSignalMs);
  const movingMs = Math.max(0, trackedMs - stationaryMs);

  const summary: Summary = {
    distanceM: cumM[cumM.length - 1] ?? 0,
    movingMs,
    stationaryMs,
    noSignalMs,
    stopsCount: stops.length,
    spanMs,
  };

  const quality = scoreQuality({
    spanMs,
    noSignalMs,
    medianMs: medianIntervalMs(points, opts.gapMs),
    rawCount: rows.length,
    removedCount: badAccuracy + impossible + invalid,
    pointCount: points.length,
  });

  return {
    points,
    cumM,
    removed: { invalid, badAccuracy, impossible },
    rawCount: rows.length,
    stops,
    gaps,
    events: buildEvents(points, cumM, stops, gaps),
    summary,
    quality,
    startT,
    endT,
  };
}

/** Index of the last point with time <= t (0 if t is before the first). */
export function indexAtTime(points: TrackPoint[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0) return 0;
  if (t <= points[0]!.t) return 0;
  if (t >= points[hi]!.t) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Where the officer was at time t. Interpolates between pings. Inside a
 * signal gap the position is held at the last known point rather than drawn
 * moving in a straight line through time nobody tracked.
 */
export function positionAt(points: TrackPoint[], t: number, gapMs: number): Position | null {
  if (points.length === 0) return null;
  const i = indexAtTime(points, t);
  const a = points[i]!;
  const b = points[i + 1];
  if (!b) {
    const prev = points[i - 1];
    return {
      lat: a.lat,
      lng: a.lng,
      heading: prev ? bearingDeg(prev.lat, prev.lng, a.lat, a.lng) : 0,
      speedKmh: a.speed ?? 0,
      idx: i,
      inGap: false,
    };
  }
  const dt = b.t - a.t;
  const heading = bearingDeg(a.lat, a.lng, b.lat, b.lng);
  if (dt > gapMs) {
    return { lat: a.lat, lng: a.lng, heading, speedKmh: 0, idx: i, inGap: true };
  }
  const f = dt > 0 ? Math.min(1, Math.max(0, (t - a.t) / dt)) : 0;
  const implied = dt > 0 ? haversineM(a.lat, a.lng, b.lat, b.lng) / (dt / 1000) * 3.6 : 0;
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    heading,
    speedKmh: a.speed ?? implied,
    idx: i,
    inGap: false,
  };
}

export type RunClass = "slow" | "moving";
export interface SpeedRun {
  cls: RunClass;
  /** Index (in the cleaned points) of positions[0]. positions[k] is point startIdx + k. */
  startIdx: number;
  positions: [number, number][];
}

export const SLOW_KMH = 5;

/** The route split into runs of "slow" and "moving", never drawn across a gap. */
export function buildSpeedRuns(points: TrackPoint[], gapMs: number): SpeedRun[] {
  const runs: SpeedRun[] = [];
  let current: SpeedRun | null = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dt = b.t - a.t;
    if (dt > gapMs) {
      current = null;
      continue;
    }
    const kmh = dt > 0 ? haversineM(a.lat, a.lng, b.lat, b.lng) / (dt / 1000) * 3.6 : 0;
    const cls: RunClass = kmh < SLOW_KMH ? "slow" : "moving";
    if (!current || current.cls !== cls) {
      current = { cls, startIdx: i - 1, positions: [[a.lat, a.lng]] };
      runs.push(current);
    }
    current.positions.push([b.lat, b.lng]);
  }
  return runs;
}

/** The part of the speed runs the officer has already covered, up to point endIdx. */
export function traveledRuns(runs: SpeedRun[], endIdx: number, maxPerRun = 800): SpeedRun[] {
  const out: SpeedRun[] = [];
  for (const run of runs) {
    if (run.startIdx > endIdx) break;
    const count = Math.min(run.positions.length, endIdx - run.startIdx + 1);
    if (count < 1) continue;
    let positions = run.positions.slice(0, count);
    if (positions.length > maxPerRun) {
      const step = Math.ceil(positions.length / maxPerRun);
      const thinned = positions.filter((_, k) => k % step === 0);
      const lastPos = positions[positions.length - 1];
      if (lastPos) thinned.push(lastPos);
      positions = thinned;
    }
    out.push({ cls: run.cls, startIdx: run.startIdx, positions });
  }
  return out;
}

/** At most `max` evenly spaced positions from points[0..endIdx], always ending on endIdx. */
export function decimatedPath(points: TrackPoint[], endIdx: number, max = 1200): [number, number][] {
  const count = Math.min(points.length, endIdx + 1);
  if (count <= 0) return [];
  const step = Math.max(1, Math.ceil(count / max));
  const out: [number, number][] = [];
  for (let i = 0; i < count; i += step) {
    const p = points[i]!;
    out.push([p.lat, p.lng]);
  }
  const lastP = points[count - 1]!;
  const tail = out[out.length - 1];
  if (!tail || tail[0] !== lastP.lat || tail[1] !== lastP.lng) out.push([lastP.lat, lastP.lng]);
  return out;
}

/** Stop that is current at time t (inside it), or null. */
export function stopAt(stops: Stop[], t: number): Stop | null {
  return stops.find((s) => t >= s.arrival && t <= s.departure) ?? null;
}
