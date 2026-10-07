/**
 * A small daily tally kept by the background task so a stall can be explained
 * instead of guessed at: did the phone stop giving GPS updates, or did sending
 * fail? Shown on the Tracking screen. Resets each day and on each tracking start.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tracking_diag_v1';

export type TrackingDiag = {
  day: string;
  startedAt: number | null;
  gpsUpdates: number; // positions the phone handed to the app
  sentOk: number;
  failed: number; // sends that failed (kept to upload later)
  longestGapSec: number; // longest time with no GPS update at all
  longestGapAt: number | null;
  lastUpdateAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
};

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, device time

const blank = (): TrackingDiag => ({
  day: today(),
  startedAt: null,
  gpsUpdates: 0,
  sentOk: 0,
  failed: 0,
  longestGapSec: 0,
  longestGapAt: null,
  lastUpdateAt: null,
  lastError: null,
  lastErrorAt: null,
});

// One change at a time, never overlapping.
let chain: Promise<unknown> = Promise.resolve();
function change(mutate: (d: TrackingDiag) => void): Promise<void> {
  const job = async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      let d: TrackingDiag = raw ? JSON.parse(raw) : blank();
      if (d.day !== today()) d = blank();
      mutate(d);
      await AsyncStorage.setItem(KEY, JSON.stringify(d));
    } catch {
      // diagnostics must never get in the way of tracking
    }
  };
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next as Promise<void>;
}

export const trackingDiag = {
  started: () => change((d) => { Object.assign(d, blank(), { startedAt: Date.now() }); }),
  gpsUpdate: (count: number) =>
    change((d) => {
      const now = Date.now();
      if (d.lastUpdateAt) {
        const gap = Math.round((now - d.lastUpdateAt) / 1000);
        if (gap > d.longestGapSec) {
          d.longestGapSec = gap;
          d.longestGapAt = now;
        }
      }
      d.gpsUpdates += count;
      d.lastUpdateAt = now;
    }),
  sent: () => change((d) => { d.sentOk += 1; }),
  failed: (message: string) =>
    change((d) => {
      d.failed += 1;
      d.lastError = String(message).slice(0, 140);
      d.lastErrorAt = Date.now();
    }),
  read: async (): Promise<TrackingDiag | null> => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw) return null;
      const d: TrackingDiag = JSON.parse(raw);
      return d.day === today() ? d : null;
    } catch {
      return null;
    }
  },
};
