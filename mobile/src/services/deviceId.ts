/**
 * Real per-install device identifier for the /auth/login device-binding
 * check in the backend (LoginUserUseCase: first login binds device_id to
 * the account, later logins with a different device_id are rejected).
 *
 * This deliberately does NOT introduce a new persistence layer. The app
 * currently has no persistence at all (api.ts's token and db.ts's queue
 * are both plain in-memory fields, lost on every restart) - adding a
 * storage mechanism just for this one value would be inconsistent with
 * everything else here. Instead this reads identifiers the OS itself
 * keeps stable across app restarts:
 *   - Android: Settings.Secure.ANDROID_ID (Application.getAndroidId()) - a
 *     synchronous constant tied to the app-signing key + device.
 *   - iOS: identifierForVendor (Application.getIosIdForVendorAsync()) -
 *     stable across restarts, may occasionally return null right after a
 *     device restart before the user unlocks it (Apple's documented
 *     behavior, not a bug here).
 *
 * NOTE: verified against expo-application@5.3.0, the exact version this
 * project's Expo SDK (~49.0.15) pins. In that version `androidId` is a
 * plain constant, not a method - the `getAndroidId()` method form was
 * introduced in a later SDK. Using the wrong form would fail at runtime.
 */
import { Platform } from 'react-native';
import * as Application from 'expo-application';

export async function getDeviceId(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      return Application.getAndroidId() ?? null;
    }
    if (Platform.OS === 'ios') {
      return await Application.getIosIdForVendorAsync();
    }
    return null;
  } catch (err) {
    console.warn('Failed to read device identifier', err);
    return null;
  }
}
