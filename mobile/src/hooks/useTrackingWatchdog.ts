import { useEffect } from 'react';
import { AppState } from 'react-native';
import { apiClient } from '../services/api';
import { LocationService } from '../services/LocationService';
import { trackingHealth } from '../services/trackingHealth';
import { flushSavedPings } from '../services/pingBuffer';

const CHECK_EVERY_MS = 60_000;
// If the server has seen nothing from this phone for this long while the
// officer is checked in, the background task is running but not delivering
// (the phone put it to sleep). Restarting it brings it back.
const STALL_AFTER_MS = 4 * 60_000;
const RESTART_COOLDOWN_MS = 5 * 60_000;

/**
 * Keeps tracking alive for the whole working day.
 *
 * While an officer is checked in, every minute (and every time the app comes
 * to the front) this makes sure the background task is registered, restarts it
 * if the phone killed it, and records a problem for the banner when it cannot
 * run (location not allowed "all the time", or it would not restart).
 * After check-out it makes sure nothing keeps running. Only for officers.
 */
export function useTrackingWatchdog(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      trackingHealth.set(null);
      return;
    }
    let cancelled = false;
    let busy = false;
    let lastRestart = 0;

    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        let today: any;
        try {
          today = await apiClient.request('/attendance/today', 'GET', 'check_in');
        } catch {
          return; // offline or no record yet: say nothing, try again later
        }
        if (cancelled) return;

        // The server answered, so there is signal: send any saved positions.
        void flushSavedPings();

        const checkedIn = !!today && !!today.check_in_time && !today.check_out_time;
        if (!checkedIn) {
          trackingHealth.set(null);
          if (today?.check_out_time) await LocationService.stopTracking();
          return;
        }

        let health = await LocationService.getHealth();
        if (!health.running) {
          const result = await LocationService.startTracking({ prompt: false });
          if (result === 'foreground_denied' || result === 'background_denied') {
            if (!cancelled) trackingHealth.set('permission');
            return;
          }
          health = await LocationService.getHealth();
        }
        if (cancelled) return;
        if (!health.background) trackingHealth.set('permission');
        else if (!health.running) trackingHealth.set('stopped');
        else {
          trackingHealth.set(null);
          await restartIfStalled(today.check_in_time);
        }
      } finally {
        busy = false;
      }
    };

    const restartIfStalled = async (checkInTime: string) => {
      try {
        const mine: any = await apiClient.request('/location/me/today', 'GET', 'gps_ping');
        const last = mine?.last_recorded_at ? Date.parse(mine.last_recorded_at) : 0;
        const since = Math.max(last, Date.parse(checkInTime) || 0);
        const now = Date.now();
        if (!since || now - since < STALL_AFTER_MS || now - lastRestart < RESTART_COOLDOWN_MS) return;
        lastRestart = now;
        await LocationService.stopTracking();
        await LocationService.startTracking({ prompt: false });
      } catch {
        // offline: nothing to compare against, check again next minute
      }
    };

    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled]);
}
