/**
 * Turns a day's raw GPS points into something an admin can read:
 * distance, time on the road, stops, and gaps with no signal.
 * Same rules as the web Route Replay (frontend/components/route-replay):
 *   stop = within 50 m for at least 5 minutes
 *   gap  = more than 10 minutes between two points
 *   bad fix = accuracy worse than 100 m, or faster than 120 km/h
 */
export type RawPoint = {
  lat: number;
  lng: number;
  recorded_at: string;
  speed: number | null;
  accuracy?: number | null;
};

export type Stop = { start: number; end: number; lat: number; lng: number; minutes: number };
export type Gap = { start: number; end: number; minutes: number };

export type DaySummary = {
  points: { lat: number; lng: number; t: number }[];
  distanceKm: number;
  firstAt: number | null;
  lastAt: number | null;
  movingMinutes: number;
  stops: Stop[];
  gaps: Gap[];
  badFixes: number;
};

export const STOP_RADIUS_M = 50;
export const STOP_MIN_MS = 5 * 60_000;
export const GAP_MS = 10 * 60_000;
export const MAX_ACCURACY_M = 100;
export const MAX_SPEED_KMH = 120;

export function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The server sends microseconds ("...:30.123456+00:00"); trim to milliseconds
// so every JS engine parses it.
export function parseTime(iso: string): number {
  return Date.parse(String(iso).replace(/(\.\d{3})\d+/, '$1'));
}

export function analyzeDay(raw: RawPoint[]): DaySummary {
  const sorted = (Array.isArray(raw) ? raw : [])
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), t: parseTime(p.recorded_at), acc: p.accuracy == null ? null : Number(p.accuracy) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => a.t - b.t);

  // Drop poor fixes and impossible jumps. A fix is only judged against the
  // last point we kept, so one stray point cannot hide the ones after it.
  const kept: { lat: number; lng: number; t: number }[] = [];
  let badFixes = 0;
  for (const p of sorted) {
    // 9999 is what the server stores when the phone gave no accuracy.
    if (p.acc != null && p.acc < 9999 && p.acc > MAX_ACCURACY_M) {
      badFixes++;
      continue;
    }
    const prev = kept[kept.length - 1];
    if (prev) {
      const dt = (p.t - prev.t) / 3_600_000;
      const km = haversineM(prev.lat, prev.lng, p.lat, p.lng) / 1000;
      if (dt > 0 && km / dt > MAX_SPEED_KMH && p.t - prev.t < GAP_MS) {
        badFixes++;
        continue;
      }
    }
    kept.push({ lat: p.lat, lng: p.lng, t: p.t });
  }

  let distanceM = 0;
  const gaps: Gap[] = [];
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1]!;
    const b = kept[i]!;
    if (b.t - a.t > GAP_MS) {
      gaps.push({ start: a.t, end: b.t, minutes: Math.round((b.t - a.t) / 60_000) });
    } else {
      distanceM += haversineM(a.lat, a.lng, b.lat, b.lng);
    }
  }

  // Stops: walk forward while every point stays within the radius of the
  // anchor and there is no gap.
  const stops: Stop[] = [];
  let i = 0;
  while (i < kept.length) {
    const anchor = kept[i]!;
    let j = i;
    while (j + 1 < kept.length) {
      const next = kept[j + 1]!;
      if (next.t - kept[j]!.t > GAP_MS) break;
      if (haversineM(anchor.lat, anchor.lng, next.lat, next.lng) > STOP_RADIUS_M) break;
      j++;
    }
    const last = kept[j]!;
    if (j > i && last.t - anchor.t >= STOP_MIN_MS) {
      const slice = kept.slice(i, j + 1);
      stops.push({
        start: anchor.t,
        end: last.t,
        lat: slice.reduce((s, p) => s + p.lat, 0) / slice.length,
        lng: slice.reduce((s, p) => s + p.lng, 0) / slice.length,
        minutes: Math.round((last.t - anchor.t) / 60_000),
      });
    }
    // After a real stop carry on past it; otherwise try the next point as the
    // anchor, so a short pause cannot hide a stop that begins inside it.
    i = j > i && last.t - anchor.t >= STOP_MIN_MS ? j + 1 : i + 1;
  }

  const first = kept[0]?.t ?? null;
  const last = kept[kept.length - 1]?.t ?? null;
  const trackedMs = first != null && last != null ? last - first : 0;
  const stoppedMs = stops.reduce((s, x) => s + (x.end - x.start), 0);
  const gapMs = gaps.reduce((s, g) => s + (g.end - g.start), 0);
  const movingMinutes = Math.max(0, Math.round((trackedMs - stoppedMs - gapMs) / 60_000));

  return {
    points: kept,
    distanceKm: Math.round(distanceM / 10) / 100,
    firstAt: first,
    lastAt: last,
    movingMinutes,
    stops,
    gaps,
    badFixes,
  };
}

export type JourneyItem =
  | { kind: 'place'; key: string; role: 'start' | 'stop' | 'end'; number: number | null; lat: number; lng: number; arrive: number; depart: number | null; minutes: number }
  | { kind: 'travel'; key: string; from: number; to: number; km: number }
  | { kind: 'gap'; key: string; from: number; to: number; minutes: number };

/**
 * The day as a list of places in time order, like a train timetable: where the
 * day started, each stop (arrival and departure), where the last location was
 * recorded, with the distance travelled and any no-signal period in between.
 */
export function buildJourney(day: DaySummary): JourneyItem[] {
  const pts = day.points;
  if (pts.length === 0) return [];
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;

  type Place = Extract<JourneyItem, { kind: 'place' }>;
  const places: Place[] = [];
  const startsInStop = day.stops[0] != null && day.stops[0].start <= first.t;
  const endsInStop = day.stops.length > 0 && day.stops[day.stops.length - 1]!.end >= last.t;
  if (!startsInStop) {
    places.push({ kind: 'place', key: 'start', role: 'start', number: null, lat: first.lat, lng: first.lng, arrive: first.t, depart: first.t, minutes: 0 });
  }
  day.stops.forEach((s, i) =>
    places.push({ kind: 'place', key: `stop${i}`, role: 'stop', number: i + 1, lat: s.lat, lng: s.lng, arrive: s.start, depart: s.end, minutes: s.minutes }),
  );
  if (!endsInStop && (pts.length > 1 || startsInStop)) {
    places.push({ kind: 'place', key: 'end', role: 'end', number: null, lat: last.lat, lng: last.lng, arrive: last.t, depart: null, minutes: 0 });
  }

  const out: JourneyItem[] = [];
  places.forEach((place, i) => {
    out.push(place);
    const next = places[i + 1];
    if (!next) return;
    const from = place.depart ?? place.arrive;
    const to = next.arrive;
    let metres = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!;
      const b = pts[k]!;
      if (a.t < from || b.t > to || b.t - a.t > GAP_MS) continue;
      metres += haversineM(a.lat, a.lng, b.lat, b.lng);
    }
    const gaps = day.gaps.filter((g) => g.start >= from && g.end <= to);
    if (metres >= 50 || (to > from && gaps.length === 0)) {
      out.push({ kind: 'travel', key: `travel${i}`, from, to, km: Math.round(metres / 10) / 100 });
    }
    gaps.forEach((g, j) => out.push({ kind: 'gap', key: `gap${i}-${j}`, from: g.start, to: g.end, minutes: g.minutes }));
  });
  return out;
}

export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtClock(t: number): string {
  if (!Number.isFinite(t)) return '-';
  return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** Evenly thin a path to at most `max` points, keeping the first and last. */
export function thin<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const out: T[] = [];
  const step = (items.length - 1) / (max - 1);
  for (let k = 0; k < max; k++) out.push(items[Math.round(k * step)]!);
  return out;
}
