/**
 * Tiny shared store for "is this officer's tracking healthy?". The watchdog
 * (hooks/useTrackingWatchdog.ts) writes it; the banner shown on every section
 * screen (components/TrackingBanner.tsx) reads it.
 */
export type TrackingProblem = 'permission' | 'stopped' | null;

let current: TrackingProblem = null;
const listeners = new Set<() => void>();

export const trackingHealth = {
  get: (): TrackingProblem => current,
  set: (next: TrackingProblem) => {
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
