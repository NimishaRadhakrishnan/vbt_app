/**
 * Deterministic fake days so every state of the screen can be reviewed
 * without a backend. The same officer id + date always gives the same day.
 *
 * Demo officers:
 *   demo-normal  a full day, 5,000+ points, 7 stops, a few bad fixes
 *   demo-gaps    the same day with two stretches of no signal
 *   demo-short   two minutes of tracking
 *   demo-single  one GPS point
 *   demo-empty   nothing recorded
 *   demo-error   the request fails
 */
import type { Place, RawHistoryRow } from "./types";

export interface MockOfficer {
  id: string;
  name: string;
  role: string;
  employeeId: string;
  territory: string;
}

export const MOCK_OFFICERS: MockOfficer[] = [
  { id: "demo-normal", name: "Vignesh (full day)", role: "field_officer", employeeId: "VB-1002", territory: "Coimbatore" },
  { id: "demo-gaps", name: "Kailash (signal gaps)", role: "field_officer", employeeId: "VB-1003", territory: "Coimbatore" },
  { id: "demo-short", name: "Sathesh (2 minutes)", role: "sales_officer", employeeId: "VB-1004", territory: "Tiruppur" },
  { id: "demo-single", name: "Ayyasami (1 point)", role: "field_officer", employeeId: "VB-1005", territory: "Erode" },
  { id: "demo-empty", name: "Sathish (no data)", role: "field_officer", employeeId: "VB-1006", territory: "Salem" },
  { id: "demo-error", name: "Broken (API error)", role: "field_officer", employeeId: "VB-1007", territory: "Salem" },
];

const OFFICE = { lat: 11.0168, lng: 76.9558 };
const DEALER_A = { lat: 11.051, lng: 76.999 };
const DEALER_B = { lat: 11.084, lng: 77.034 };
const FARMER_K = { lat: 11.122, lng: 77.061 };
const DEALER_C = { lat: 11.064, lng: 76.91 };
const FARMER_M = { lat: 11.03, lng: 76.93 };

export const MOCK_PLACES: Place[] = [
  { id: "p-office", name: "Vishakan Coimbatore Office", type: "Office", ...OFFICE },
  { id: "p-a", name: "Sri Murugan Agro Centre", type: "Dealer", ...DEALER_A },
  { id: "p-b", name: "Annapoorani Fertilizers", type: "Dealer", ...DEALER_B },
  { id: "p-k", name: "K. Palanisamy (farm)", type: "Farmer", ...FARMER_K },
  { id: "p-c", name: "Lakshmi Seeds & Pesticides", type: "Dealer", ...DEALER_C },
];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Leg =
  | { kind: "stay"; minutes: number }
  | { kind: "drive"; to: { lat: number; lng: number }; kmh: number }
  | { kind: "dark"; minutes: number; to: { lat: number; lng: number } };

const METRES_PER_DEG_LAT = 111_320;

function build(date: string, legs: Leg[], seed: number, startHour = 9, intervalSec = 5): RawHistoryRow[] {
  const rand = rng(seed);
  const rows: RawHistoryRow[] = [];
  let t = Date.parse(`${date}T${String(startHour).padStart(2, "0")}:00:00+05:30`);
  let lat = OFFICE.lat;
  let lng = OFFICE.lng;
  let battery = 96;

  const push = (la: number, lo: number, speed: number, accuracy: number) => {
    rows.push({
      lat: la,
      lng: lo,
      recorded_at: new Date(t).toISOString(),
      speed,
      accuracy,
      battery_level: Math.max(8, Math.round(battery)),
    });
  };

  for (const leg of legs) {
    if (leg.kind === "stay") {
      const n = Math.round((leg.minutes * 60) / intervalSec);
      for (let i = 0; i < n; i++) {
        const jitter = 6 / METRES_PER_DEG_LAT;
        push(lat + (rand() - 0.5) * jitter, lng + (rand() - 0.5) * jitter, 0, 6 + rand() * 12);
        t += intervalSec * 1000;
        battery -= 0.0015;
      }
    } else if (leg.kind === "drive") {
      const dLat = (leg.to.lat - lat) * METRES_PER_DEG_LAT;
      const dLng = (leg.to.lng - lng) * METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
      const dist = Math.hypot(dLat, dLng);
      const speedMs = leg.kmh / 3.6;
      const n = Math.max(1, Math.round(dist / (speedMs * intervalSec)));
      const sLat = lat;
      const sLng = lng;
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        const wobble = 3 / METRES_PER_DEG_LAT;
        lat = sLat + (leg.to.lat - sLat) * f;
        lng = sLng + (leg.to.lng - sLng) * f;
        push(lat + (rand() - 0.5) * wobble, lng + (rand() - 0.5) * wobble, leg.kmh * (0.8 + rand() * 0.4), 8 + rand() * 15);
        t += intervalSec * 1000;
        battery -= 0.0025;
      }
    } else {
      t += leg.minutes * 60_000;
      lat = leg.to.lat;
      lng = leg.to.lng;
      battery -= leg.minutes * 0.03;
    }
  }
  return rows;
}

/** A believable working day: office, three dealers, two farmers, lunch. */
function fullDayLegs(withGaps: boolean): Leg[] {
  return [
    { kind: "stay", minutes: 25 },
    { kind: "drive", to: DEALER_A, kmh: 34 },
    { kind: "stay", minutes: 32 },
    { kind: "drive", to: DEALER_B, kmh: 30 },
    { kind: "stay", minutes: 55 },
    withGaps
      ? { kind: "dark", minutes: 80, to: FARMER_K }
      : { kind: "drive", to: FARMER_K, kmh: 40 },
    { kind: "stay", minutes: 28 },
    { kind: "drive", to: FARMER_M, kmh: 36 },
    { kind: "stay", minutes: 20 },
    { kind: "drive", to: DEALER_C, kmh: 38 },
    { kind: "stay", minutes: 62 },
    withGaps
      ? { kind: "dark", minutes: 25, to: OFFICE }
      : { kind: "drive", to: OFFICE, kmh: 35 },
    { kind: "stay", minutes: 140 },
  ];
}

/** Sprinkle in the kinds of bad fixes real phones produce. */
function addNoise(rows: RawHistoryRow[]): RawHistoryRow[] {
  const out = rows.slice();
  const pick = (frac: number) => Math.floor(out.length * frac);
  const a = out[pick(0.2)];
  const b = out[pick(0.45)];
  const c = out[pick(0.7)];
  if (a) out[pick(0.2)] = { ...a, accuracy: 480 };
  if (b) out[pick(0.45)] = { ...b, accuracy: 350 };
  if (c) out[pick(0.7)] = { ...c, lat: c.lat + 0.6, lng: c.lng + 0.6 }; // teleports 90 km
  return out;
}

export function mockDay(officerId: string, date: string): RawHistoryRow[] {
  switch (officerId) {
    case "demo-normal":
      return addNoise(build(date, fullDayLegs(false), 11));
    case "demo-gaps":
      return build(date, fullDayLegs(true), 22);
    case "demo-short":
      return build(
        date,
        [
          { kind: "stay", minutes: 0.5 },
          { kind: "drive", to: { lat: OFFICE.lat + 0.0012, lng: OFFICE.lng + 0.001 }, kmh: 6 },
        ],
        33,
        15,
      ).slice(0, 25);
    case "demo-single":
      return build(date, [{ kind: "stay", minutes: 0.1 }], 44, 10).slice(0, 1);
    case "demo-empty":
      return [];
    default:
      return [];
  }
}

/** Drop-in for the real API call. Empty for dates other than today in demo mode? No: same every day. */
export async function mockFetchDay(officerId: string, date: string): Promise<RawHistoryRow[]> {
  await new Promise((r) => setTimeout(r, 350));
  if (officerId === "demo-error") throw new Error("Could not reach the tracking service (demo).");
  return mockDay(officerId, date);
}
