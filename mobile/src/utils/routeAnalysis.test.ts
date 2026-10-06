import { analyzeDay, thin } from './routeAnalysis';

const T0 = Date.parse('2026-10-07T04:00:00Z');
const pt = (min: number, lat: number, lng: number, acc: number | null = 10) => ({
  lat, lng, speed: null, accuracy: acc, recorded_at: new Date(T0 + min * 60_000).toISOString(),
});

describe('analyzeDay', () => {
  it('handles no points', () => {
    const r = analyzeDay([]);
    expect(r.points).toHaveLength(0);
    expect(r.distanceKm).toBe(0);
    expect(r.firstAt).toBeNull();
  });

  it('sums distance for a straight walk', () => {
    const r = analyzeDay([pt(0, 11.0, 76.0), pt(1, 11.005, 76.0), pt(2, 11.01, 76.0)]);
    expect(r.distanceKm).toBeGreaterThan(1.0);
    expect(r.distanceKm).toBeLessThan(1.2);
    expect(r.stops).toHaveLength(0);
  });

  it('finds a stop of at least five minutes', () => {
    const pts = [0, 1, 2, 3, 4, 5, 6].map((m) => pt(m, 11.0 + m * 0.000005, 76.0));
    const r = analyzeDay(pts);
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]!.minutes).toBe(6);
  });

  it('does not call a 3 minute pause a stop', () => {
    const r = analyzeDay([0, 1, 2, 3].map((m) => pt(m, 11.0, 76.0)));
    expect(r.stops).toHaveLength(0);
  });

  it('records a gap over ten minutes and does not count it as distance', () => {
    const r = analyzeDay([pt(0, 11.0, 76.0), pt(1, 11.001, 76.0), pt(30, 11.5, 76.5)]);
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]!.minutes).toBe(29);
    expect(r.distanceKm).toBeLessThan(0.2);
  });

  it('drops poor-accuracy fixes', () => {
    const r = analyzeDay([pt(0, 11.0, 76.0), pt(1, 11.5, 76.5, 400), pt(2, 11.001, 76.0)]);
    expect(r.badFixes).toBe(1);
    expect(r.points).toHaveLength(2);
  });

  it('keeps fixes whose accuracy was unknown (9999)', () => {
    const r = analyzeDay([pt(0, 11.0, 76.0, 9999), pt(1, 11.0005, 76.0, 9999)]);
    expect(r.badFixes).toBe(0);
    expect(r.points).toHaveLength(2);
  });

  it('drops an impossible jump', () => {
    const r = analyzeDay([pt(0, 11.0, 76.0), pt(1, 12.0, 77.0), pt(2, 11.0005, 76.0)]);
    expect(r.badFixes).toBe(1);
  });
});

describe('thin', () => {
  it('keeps ends and limits size', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    const out = thin(arr, 50);
    expect(out).toHaveLength(50);
    expect(out[0]).toBe(0);
    expect(out[49]).toBe(999);
  });
  it('leaves short lists alone', () => {
    expect(thin([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});
