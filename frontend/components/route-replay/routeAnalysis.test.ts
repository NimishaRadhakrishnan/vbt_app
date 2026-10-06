import { describe, it, expect } from "vitest";
import {
  analyzeDay,
  bearingDeg,
  buildSpeedRuns,
  traveledRuns,
  decimatedPath,
  detectGaps,
  detectStopRanges,
  filterBadFixes,
  haversineM,
  indexAtTime,
  matchPlace,
  positionAt,
  toTrackPoints,
  DEFAULT_OPTIONS,
} from "./routeAnalysis";
import { mockDay } from "./mockData";
import type { RawHistoryRow, TrackPoint } from "./types";

const T0 = Date.parse("2026-10-06T09:00:00+05:30");
const MIN = 60_000;

function pt(minute: number, lat: number, lng: number, extra: Partial<TrackPoint> = {}): TrackPoint {
  return { lat, lng, t: T0 + minute * MIN, speed: null, accuracy: null, battery: null, ...extra };
}
function row(minute: number, lat: number, lng: number, extra: Partial<RawHistoryRow> = {}): RawHistoryRow {
  return { lat, lng, recorded_at: new Date(T0 + minute * MIN).toISOString(), ...extra };
}

/** Points every 30s from minute a to b at a fixed place. */
function staying(a: number, b: number, lat: number, lng: number): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (let m = a; m <= b + 1e-9; m += 0.5) out.push(pt(m, lat, lng));
  return out;
}

describe("haversineM / bearingDeg", () => {
  it("one degree of latitude is about 111.2 km", () => {
    expect(haversineM(10, 77, 11, 77)).toBeGreaterThan(111_000);
    expect(haversineM(10, 77, 11, 77)).toBeLessThan(111_400);
  });
  it("is zero for the same point and symmetric", () => {
    expect(haversineM(11, 77, 11, 77)).toBe(0);
    expect(haversineM(11, 77, 11.5, 77.2)).toBeCloseTo(haversineM(11.5, 77.2, 11, 77), 6);
  });
  it("bearing: north is 0, east is 90", () => {
    expect(bearingDeg(11, 77, 12, 77)).toBeCloseTo(0, 3);
    expect(bearingDeg(0, 77, 0, 78)).toBeCloseTo(90, 3);
  });
});

describe("toTrackPoints", () => {
  it("drops bad rows, sorts by time and collapses duplicate timestamps", () => {
    const { points, invalid } = toTrackPoints([
      row(5, 11.1, 77.1),
      row(1, 11.0, 77.0),
      row(1, 11.0, 77.0),
      { lat: 0, lng: 0, recorded_at: new Date(T0).toISOString() },
      { lat: 11, lng: 77, recorded_at: "not a date" },
      { lat: 95, lng: 77, recorded_at: new Date(T0).toISOString() },
    ]);
    expect(points.map((p) => p.t)).toEqual([T0 + MIN, T0 + 5 * MIN]);
    expect(invalid).toBe(3);
  });
  it("treats accuracy 9999 as unknown", () => {
    const { points } = toTrackPoints([row(0, 11, 77, { accuracy: 9999 })]);
    expect(points[0]!.accuracy).toBeNull();
  });
});

describe("filterBadFixes", () => {
  const opts = { maxAccuracyM: 100, maxSpeedKmh: 120 };
  it("drops poor accuracy but keeps unknown accuracy", () => {
    const r = filterBadFixes([pt(0, 11, 77, { accuracy: 10 }), pt(1, 11, 77.0001, { accuracy: 450 }), pt(2, 11, 77.0002, { accuracy: null })], opts);
    expect(r.points).toHaveLength(2);
    expect(r.badAccuracy).toBe(1);
  });
  it("drops an impossible jump and carries on from the real point", () => {
    const r = filterBadFixes([pt(0, 11, 77), pt(1, 11.5, 77.5), pt(2, 11.0003, 77.0003)], opts);
    expect(r.points).toHaveLength(2);
    expect(r.impossible).toBe(1);
  });
  it("does not lose the whole day if the very first fix was the bad one", () => {
    const pts = [pt(0, 12, 78), ...Array.from({ length: 8 }, (_, i) => pt(1 + i, 11, 77 + i * 0.0001))];
    const r = filterBadFixes(pts, opts);
    expect(r.points.length).toBeGreaterThanOrEqual(5);
  });
});

describe("detectGaps", () => {
  it("flags silences longer than 10 minutes only", () => {
    const gaps = detectGaps([pt(0, 11, 77), pt(5, 11, 77), pt(16, 11, 77), pt(26, 11, 77)], 10 * MIN);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.durationMs).toBe(11 * MIN);
    expect(gaps[0]!.fromIdx).toBe(1);
    expect(gaps[0]!.toIdx).toBe(2);
  });
});

describe("detectStopRanges", () => {
  const o = { stopRadiusM: 50, stopMinMs: 5 * MIN, gapMs: 10 * MIN };
  it("finds a 10 minute stand between two walks", () => {
    const pts = [
      pt(0, 11.0, 77.0),
      pt(1, 11.001, 77.0),
      ...staying(2, 12, 11.002, 77.0),
      pt(13, 11.004, 77.0),
      pt(14, 11.006, 77.0),
    ];
    const stops = detectStopRanges(pts, o);
    expect(stops).toHaveLength(1);
    const s = stops[0]!;
    expect(pts[s.endIdx]!.t - pts[s.startIdx]!.t).toBeGreaterThanOrEqual(10 * MIN);
    expect(s.lat).toBeCloseTo(11.002, 4);
  });
  it("ignores a stand shorter than 5 minutes", () => {
    expect(detectStopRanges(staying(0, 4, 11, 77), o)).toHaveLength(0);
  });
  it("does not call steady driving a stop", () => {
    const pts = Array.from({ length: 30 }, (_, i) => pt(i, 11 + i * 0.002, 77));
    expect(detectStopRanges(pts, o)).toHaveLength(0);
  });
  it("one stray GPS point does not split a stop", () => {
    const pts = staying(0, 12, 11, 77);
    pts[10] = pt(5, 11.01, 77.01); // ~1.5 km off, then straight back
    expect(detectStopRanges(pts, o)).toHaveLength(1);
  });
  it("a signal gap ends a stop (we cannot know they stayed)", () => {
    const pts = [...staying(0, 8, 11, 77), ...staying(30, 38, 11, 77)];
    const stops = detectStopRanges(pts, o);
    expect(stops).toHaveLength(2);
  });
});

describe("matchPlace", () => {
  const places = [
    { id: "a", name: "Dealer A", type: "Dealer", lat: 11.0, lng: 77.0 },
    { id: "b", name: "Dealer B", type: "Dealer", lat: 11.001, lng: 77.0 },
  ];
  it("picks the nearest within the radius, else null", () => {
    expect(matchPlace(11.0002, 77.0, places, 150)?.id).toBe("a");
    expect(matchPlace(11.0009, 77.0, places, 150)?.id).toBe("b");
    expect(matchPlace(11.01, 77.0, places, 150)).toBeNull();
  });
});

describe("analyzeDay", () => {
  it("returns null when there is nothing usable", () => {
    expect(analyzeDay([])).toBeNull();
    expect(analyzeDay([{ lat: 0, lng: 0, recorded_at: new Date().toISOString() }])).toBeNull();
  });

  it("walk, stand 10 min, walk: one stop, ordered timeline, distance adds up", () => {
    const rows: RawHistoryRow[] = [
      row(0, 11.0, 77.0),
      row(1, 11.001, 77.0),
      ...Array.from({ length: 21 }, (_, i) => row(2 + i * 0.5, 11.002, 77.0)),
      row(13, 11.004, 77.0),
      row(14, 11.006, 77.0),
    ];
    const a = analyzeDay(rows, [{ id: "p", name: "Sri Murugan", type: "Dealer", lat: 11.002, lng: 77.0 }])!;
    expect(a.stops).toHaveLength(1);
    expect(a.stops[0]!.placeName).toBe("Sri Murugan");
    expect(a.summary.stopsCount).toBe(1);
    expect(a.summary.distanceM).toBeCloseTo(haversineM(11.0, 77.0, 11.006, 77.0), 0);
    const kinds = a.events.map((e) => e.kind);
    expect(kinds[0]).toBe("start");
    expect(kinds[kinds.length - 1]).toBe("end");
    expect(kinds).toContain("stop");
    const times = a.events.map((e) => e.at);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(a.summary.movingMs + a.summary.stationaryMs + a.summary.noSignalMs).toBe(a.summary.spanMs);
  });

  it("signal gap shows up in summary, events and quality", () => {
    const rows = [...Array.from({ length: 10 }, (_, i) => row(i, 11 + i * 0.001, 77)), ...Array.from({ length: 10 }, (_, i) => row(90 + i, 11.02 + i * 0.001, 77))];
    const a = analyzeDay(rows)!;
    expect(a.gaps).toHaveLength(1);
    expect(a.summary.noSignalMs).toBe(81 * MIN);
    expect(a.events.some((e) => e.kind === "gap")).toBe(true);
    expect(a.quality.level).not.toBe("good");
    expect(a.quality.reasons.join(" ")).toMatch(/No signal/);
  });

  it("a clean, steady day scores good", () => {
    const rows = Array.from({ length: 120 }, (_, i) => row(i / 2, 11 + i * 0.0002, 77, { accuracy: 10 }));
    expect(analyzeDay(rows)!.quality.level).toBe("good");
  });

  it("over an hour without signal is never rated good", () => {
    const a = analyzeDay(mockDay("demo-gaps", "2026-10-06"))!;
    expect(a.quality.level).toBe("fair");
  });

  it("a clean but very short day is not rated good", () => {
    const a = analyzeDay(mockDay("demo-short", "2026-10-06"))!;
    expect(a.quality.level).toBe("fair");
    expect(a.quality.reasons.join(" ")).toMatch(/Only .* of tracking/);
  });

  it("the full demo day with a few bad fixes still rates good", () => {
    expect(analyzeDay(mockDay("demo-normal", "2026-10-06"))!.quality.level).toBe("good");
  });

  it("very sparse pings score worse than steady ones", () => {
    const steady = analyzeDay(Array.from({ length: 60 }, (_, i) => row(i / 2, 11 + i * 0.0002, 77)))!;
    const sparse = analyzeDay(Array.from({ length: 12 }, (_, i) => row(i * 5, 11 + i * 0.002, 77)))!;
    expect(sparse.quality.score).toBeLessThan(steady.quality.score);
  });

  it("the 2 minute day has a span under 10 minutes", () => {
    const a = analyzeDay(mockDay("demo-short", "2026-10-06"))!;
    expect(a.summary.spanMs).toBeLessThan(10 * MIN);
    expect(a.summary.spanMs).toBeGreaterThan(MIN);
  });

  it("the single point day has one point and no events beyond start", () => {
    const a = analyzeDay(mockDay("demo-single", "2026-10-06"))!;
    expect(a.points).toHaveLength(1);
    expect(a.events.map((e) => e.kind)).toEqual(["start"]);
  });
});

describe("positionAt / indexAtTime", () => {
  const pts = [pt(0, 11, 77), pt(2, 11.002, 77), pt(40, 11.01, 77)];
  it("interpolates between close pings", () => {
    const p = positionAt(pts, T0 + MIN, DEFAULT_OPTIONS.gapMs)!;
    expect(p.lat).toBeCloseTo(11.001, 6);
    expect(p.inGap).toBe(false);
  });
  it("holds still inside a signal gap", () => {
    const p = positionAt(pts, T0 + 20 * MIN, DEFAULT_OPTIONS.gapMs)!;
    expect(p.lat).toBeCloseTo(11.002, 6);
    expect(p.inGap).toBe(true);
  });
  it("clamps before the start and after the end", () => {
    expect(positionAt(pts, T0 - MIN, DEFAULT_OPTIONS.gapMs)!.lat).toBe(11);
    expect(positionAt(pts, T0 + 99 * MIN, DEFAULT_OPTIONS.gapMs)!.lat).toBe(11.01);
    expect(indexAtTime(pts, T0 + 3 * MIN)).toBe(1);
  });
});

describe("a full 5,000+ point day", () => {
  const rows = mockDay("demo-normal", "2026-10-06");
  it("has 5,000+ points and is analysed quickly", () => {
    expect(rows.length).toBeGreaterThan(5000);
    const t0 = performance.now();
    const a = analyzeDay(rows)!;
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1500);
    expect(a.stops.length).toBeGreaterThanOrEqual(6);
    expect(a.removed.badAccuracy + a.removed.impossible).toBeGreaterThanOrEqual(2);
    expect(a.summary.distanceM).toBeGreaterThan(10_000);
    expect(a.summary.distanceM).toBeLessThan(120_000);
  });
  it("speed runs and decimated paths stay small enough to draw", () => {
    const a = analyzeDay(rows)!;
    const runs = buildSpeedRuns(a.points, DEFAULT_OPTIONS.gapMs);
    expect(runs.length).toBeGreaterThan(0);
    expect(decimatedPath(a.points, a.points.length - 1, 1200).length).toBeLessThanOrEqual(1202);
  });
  it("traveled runs stop at the current point", () => {
    const a = analyzeDay(rows)!;
    const runs = buildSpeedRuns(a.points, DEFAULT_OPTIONS.gapMs);
    const mid = Math.floor(a.points.length / 2);
    const done = traveledRuns(runs, mid);
    const lastRun = done[done.length - 1]!;
    const lastPos = lastRun.positions[lastRun.positions.length - 1]!;
    expect(lastPos[0]).toBeCloseTo(a.points[mid]!.lat, 9);
    expect(done.every((r) => r.startIdx <= mid)).toBe(true);
  });
  it("the gaps day has two gaps", () => {
    expect(analyzeDay(mockDay("demo-gaps", "2026-10-06"))!.gaps).toHaveLength(2);
  });
});
