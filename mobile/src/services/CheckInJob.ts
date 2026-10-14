import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { apiClient } from './api';
import { LocationService } from './LocationService';
import { ConsentService } from './consent';
import { promptBatterySettingsOnce } from './batterySettings';

// Check-in runs here, not inside the screen, so it carries on when the officer
// leaves the Shift screen or backgrounds the app. It marks attendance first and
// starts GPS tracking right after; it never waits on a slow step forever.

export type CheckInStage = 'idle' | 'consent' | 'permission' | 'locating' | 'sending' | 'tracking';
export interface CheckInState {
  running: boolean;
  stage: CheckInStage;
  doneAt: string | null; // local time text once attendance is marked
  needsConsent: boolean;
}

let state: CheckInState = { running: false, stage: 'idle', doneAt: null, needsConsent: false };
const listeners = new Set<(s: CheckInState) => void>();

const set = (patch: Partial<CheckInState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
};

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

export const CheckInJob = {
  getState: () => state,
  subscribe: (fn: (s: CheckInState) => void) => {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  clearDone: () => set({ doneAt: null, needsConsent: false }),

  start: async (): Promise<void> => {
    if (state.running) return;
    set({ running: true, stage: 'consent', doneAt: null, needsConsent: false });
    try {
      // Consent: only an explicit "not accepted" stops us. A slow or failed
      // lookup falls through; the server remains the authority.
      set({ stage: 'consent' });
      const consent = await withTimeout(
        ConsentService.getStatus().then((c) => c.accepted).catch(() => true),
        6000,
        true,
      );
      if (!consent) {
        set({ needsConsent: true });
        return;
      }

      set({ stage: 'permission' });
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location Required', 'Location permission is needed to check in.');
        return;
      }
      const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
      if (!enabled) {
        Alert.alert('Turn on Location', 'Location (GPS) is switched off on this phone. Turn it on in the quick settings and try again.');
        return;
      }

      set({ stage: 'locating' });
      const position = await LocationService.getFix();
      if (!position) {
        Alert.alert('No GPS Signal Yet', 'The phone could not find your location. Step outside or near a window, wait a few seconds, then try again.');
        return;
      }

      set({ stage: 'sending' });
      const res: any = await apiClient.request(
        '/attendance/check-in',
        'POST',
        'check_in',
        {
          device_id: apiClient.getDeviceIdValue() ?? 'unknown-device',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          is_fake_gps: !!position.mocked,
          is_gps_disabled: false,
        },
        { timeoutMs: 20000 },
      );

      // Attendance is marked (or safely queued). Show it now.
      set({ doneAt: new Date().toLocaleTimeString(), stage: 'tracking' });

      const tracking = await withTimeout(LocationService.startTracking(), 60000, 'started' as any);
      const trackingOk = tracking === 'started' || tracking === 'already_running';
      if (res?.offline) {
        Alert.alert(
          'Saved on Your Phone',
          trackingOk
            ? "Check-in will send when you're back online. Live tracking started now."
            : "Check-in will send when you're back online. Tracking could not start - check location settings."
        );
      } else if (trackingOk) {
        Alert.alert('Checked In Successfully', 'Daily attendance clocked. Live tracking started.', [
          { text: 'OK', onPress: () => void promptBatterySettingsOnce() },
        ]);
      } else {
        Alert.alert(
          'Checked In - Tracking Not Active',
          'Your attendance was recorded, but continuous location tracking could not start. Please open Settings and set this app’s location access to "Always Allow" so your shift is tracked correctly.'
        );
      }
    } catch (err: any) {
      Alert.alert('Check-in failed', err?.message || 'Check-in failed. Please try again.');
    } finally {
      set({ running: false, stage: 'idle' });
    }
  },
};
