import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import { apiClient } from './api';

const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error(`[Location Task Error]`, error);
    return;
  }
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    const location = locations[0];

    const officerId = apiClient.getUserId();
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
      });
  }
});

export type StartTrackingResult =
  | 'started'
  | 'already_running'
  | 'foreground_denied'
  | 'background_denied';

export const LocationService = {
  startTracking: async (): Promise<StartTrackingResult> => {
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

      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
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
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        console.log('Background location permission denied');
        return 'background_denied';
      }

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced,
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
