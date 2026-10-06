import { useEffect } from 'react';
import { AppState } from 'react-native';
import { apiClient } from '../services/api';
import { LocationService } from '../services/LocationService';
import { trackingHealth } from '../services/trackingHealth';

const CHECK_EVERY_MS = 60_000;

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

        const checkedIn = !!today && !!today.check_in_time && !today.check_out_time;
        if (!checkedIn) {
          trackingHealth.set(null);
          if (today?.check_out_time) await LocationService.stopTracking();
          return;
        }

        let health = await LocationService.getHealth();
        if (!health.running) {
          const result = await LocationService.startTracking();
          if (result === 'foreground_denied' || result === 'background_denied') {
            if (!cancelled) trackingHealth.set('permission');
            return;
          }
          health = await LocationService.getHealth();
        }
        if (cancelled) return;
        if (!health.background) trackingHealth.set('permission');
        else if (!health.running) trackingHealth.set('stopped');
        else trackingHealth.set(null);
      } finally {
        busy = false;
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
