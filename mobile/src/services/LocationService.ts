import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import { apiClient } from './api';

const LOCATION_TASK_NAME = 'background-location-task';

// On a weak signal pings can pile up faster than they are sent. Past this
// many unfinished sends, newer pings wait their turn instead of adding more
// requests (the live map only needs the latest position).
const MAX_PINGS_IN_FLIGHT = 3;
let pingsInFlight = 0;

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error(`[Location Task Error]`, error);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    // Newest fix first: when the phone delivers several at once, the live map
    // should show where the officer is now.
    const location = locations[locations.length - 1];
    if (!location) return;

    // After Android restarts the app headlessly, nothing has loaded the
    // saved login yet, so load it here instead of dropping the ping.
    const officerId = await apiClient.ensureSession();
    if (!officerId) {
      console.log('No logged-in officer yet, skipping location sync.');
      return;
    }

    // NOTE: there is deliberately NO business-hours check here.
    //
    // This used to silently drop every ping outside 9 AM-6 PM, which
    // created a real, confusing failure: tracking is started and stopped
    // by check-in/check-out (see AttendanceScreen.tsx), so an officer who
    // legitimately checked in at 8:45 AM, or was still finishing a visit
    // at 6:10 PM, stayed "checked in" while their pings were thrown away
    // client-side. On the admin Live Tracking Map they'd flip to "Stale"
    // after 3 minutes (settings.location_stale_tier1_seconds) and then
    // fire a false Tier 2 alert at 30 minutes - for an officer who was
    // actually working and whose phone was tracking correctly.
    //
    // Check-in/check-out is the single source of truth for whether
    // tracking should happen. If a working-hours policy is ever needed,
    // it belongs on the backend (which can enforce it consistently for
    // web and mobile, and can log what it rejected) - not as a silent
    // client-side drop that makes a working phone look broken.

    // Get battery percentage
    let battery_pct = 100;
    try {
      const batteryLevel = await Battery.getBatteryLevelAsync();
      battery_pct = Math.round(batteryLevel * 100);
    } catch (err) {
      console.warn('Failed to get battery level', err);
    }

    const isMocked = !!location.mocked;

    // Field names below must match LocationPingRequest in
    // backend/app/presentation/schemas/location_schemas.py exactly -
    // this previously sent latitude/longitude/isMocked (wrong names,
    // no accuracy, no status) to the wrong path ('/location' instead
    // of '/location/ping'), so every mobile GPS ping was silently
    // rejected or lost.
    const payload = {
      officer_id: officerId,
      lat: location.coords.latitude,
      lng: location.coords.longitude,
      accuracy: location.coords.accuracy ?? null,
      speed_kmh: location.coords.speed != null ? location.coords.speed * 3.6 : null,
      battery_pct,
      is_mocked: isMocked,
      status: 'active',
      timestamp: new Date(location.timestamp).toISOString(),
    };

    if (pingsInFlight >= MAX_PINGS_IN_FLIGHT) return;
    pingsInFlight += 1;
    apiClient
      .request('/location/ping', 'POST', 'gps_ping', payload)
      .then((res: any) => {
        // The officer checked out (possibly on the web). Stop tracking
        // on this phone too instead of pinging all evening.
        if (res?.status === 'stopped') {
          LocationService.stopTracking();
        }
      })
      .catch(err => {
        console.warn('Failed to send location update', err);
      })
      .finally(() => {
        pingsInFlight = Math.max(0, pingsInFlight - 1);
      });
  }
});

export type StartTrackingResult =
  | 'started'
  | 'already_running'
  | 'foreground_denied'
  | 'background_denied';

export const LocationService = {
  /**
   * Starts the background task. `prompt: false` is for automatic checks (the
   * watchdog): it only starts tracking if the phone already allows it and
   * never opens a permission dialog or the Settings page by itself.
   */
  startTracking: async (options: { prompt?: boolean } = {}): Promise<StartTrackingResult> => {
    const prompt = options.prompt !== false;
    try {
      // Idempotency guard: this can now be called both at check-in and,
      // separately, on AttendanceScreen mount (to re-arm tracking after
      // an app restart if the officer is already checked in per the
      // backend). Without this check, calling startLocationUpdatesAsync
      // again while a task with the same name is already registered has
      // platform-dependent behavior; explicitly skipping is unambiguous.
      const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      if (alreadyRegistered) {
        console.log('Location tracking already running, skipping re-start.');
        return 'already_running';
      }

      const { status: foregroundStatus } = prompt
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      if (foregroundStatus !== 'granted') {
        console.log('Foreground location permission denied');
        return 'foreground_denied';
      }

      // This is the Always-upgrade prompt on iOS. Previously a decline
      // here (officer grants "While Using the App" but taps "Don't Allow"
      // on the follow-up "Change to Always Allow?" prompt) was swallowed
      // silently - the caller (AttendanceScreen's handleCheckIn) had no
      // way to know tracking never actually started, and unconditionally
      // told the officer "Live tracking started" regardless. Returning a
      // distinct outcome here lets the caller tell the officer the truth.
      const { status: backgroundStatus } = prompt
        ? await Location.requestBackgroundPermissionsAsync()
        : await Location.getBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        console.log('Background location permission denied');
        return 'background_denied';
      }

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.High, // GPS-grade fixes so movement is smooth
        timeInterval: 5000, // ping about every 5 seconds
        distanceInterval: 0,
        deferredUpdatesInterval: 5000,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'GPS Tracking Active',
          notificationBody: 'Tracking location for field operations',
          notificationColor: '#ffffff',
        }
      });

      console.log('Background location tracking started');
      return 'started';
    } catch (error) {
      console.error('Error starting location tracking:', error);
      // Treat an unexpected error the same as a denied background
      // permission for the caller's purposes: tracking did not start,
      // and the officer needs to be told, not left assuming it worked.
      return 'background_denied';
    }
  },

  /**
   * One position for check-in/out, never waiting forever. A recent fix is
   * used straight away; otherwise it asks the GPS for up to 12 seconds, then
   * falls back to the last known position from the past 10 minutes. Returns
   * null when the phone has nothing (GPS off, or no sky view yet).
   */
  getFix: async (): Promise<Location.LocationObject | null> => {
    try {
      const recent = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 150 });
      if (recent) return recent;
    } catch {
      // fall through to a live fix
    }
    try {
      const live = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
      ]);
      if (live) return live;
    } catch {
      // fall through to the last known position
    }
    try {
      return await Location.getLastKnownPositionAsync({ maxAge: 600_000 });
    } catch {
      return null;
    }
  },

  /** Is the background task registered, and does the phone allow location
   *  "all the time"? Used by the tracking watchdog; never throws. */
  getHealth: async (): Promise<{ running: boolean; background: boolean }> => {
    try {
      const running = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      const perm = await Location.getBackgroundPermissionsAsync();
      return { running, background: perm.status === 'granted' };
    } catch {
      return { running: false, background: false };
    }
  },

  stopTracking: async () => {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
        console.log('Background location tracking stopped');
      }
    } catch (error) {
      console.error('Error stopping location tracking:', error);
    }
  }
};
