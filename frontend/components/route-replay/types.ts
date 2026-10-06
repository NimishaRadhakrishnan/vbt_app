/** One row as returned by GET /location/history/{officer_id}?date=YYYY-MM-DD */
export interface RawHistoryRow {
  lat: number;
  lng: number;
  recorded_at: string;
  speed?: number | null;
  battery_level?: number | null;
  /** Metres. Added to the endpoint later; older servers omit it. 9999 = unknown. */
  accuracy?: number | null;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  t: number;
  speed: number | null;
  accuracy: number | null;
  battery: number | null;
}

export interface Place {
  id: string;
  name: string;
  /** "Dealer", "Farmer", "Clinic" ... shown under the name. */
  type: string;
  lat: number;
  lng: number;
}

export interface Stop {
  id: string;
  /** 1-based, the number drawn on the map. */
  number: number;
  lat: number;
  lng: number;
  arrival: number;
  departure: number;
  dwellMs: number;
  startIdx: number;
  endIdx: number;
  placeName: string | null;
  placeType: string | null;
}

export interface Gap {
  id: string;
  from: number;
  to: number;
  durationMs: number;
  fromIdx: number;
  toIdx: number;
}

export type TimelineEvent =
  | { kind: "start"; id: string; at: number; idx: number }
  | { kind: "stop"; id: string; at: number; endAt: number; stop: Stop }
  | { kind: "travel"; id: string; at: number; endAt: number; distanceM: number; fromIdx: number; toIdx: number }
  | { kind: "gap"; id: string; at: number; endAt: number; gap: Gap }
  | { kind: "end"; id: string; at: number; idx: number };

export interface Summary {
  distanceM: number;
  movingMs: number;
  stationaryMs: number;
  noSignalMs: number;
  stopsCount: number;
  spanMs: number;
}

export type QualityLevel = "good" | "fair" | "poor";

export interface Quality {
  level: QualityLevel;
  score: number;
  reasons: string[];
}

export interface Analysis {
  points: TrackPoint[];
  /** Metres travelled up to and including point i. */
  cumM: number[];
  removed: { invalid: number; badAccuracy: number; impossible: number };
  rawCount: number;
  stops: Stop[];
  gaps: Gap[];
  events: TimelineEvent[];
  summary: Summary;
  quality: Quality;
  startT: number;
  endT: number;
}

export interface Position {
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  idx: number;
  inGap: boolean;
}

export interface AnalysisOptions {
  stopRadiusM: number;
  stopMinMs: number;
  maxAccuracyM: number;
  maxSpeedKmh: number;
  gapMs: number;
  placeMatchM: number;
}
