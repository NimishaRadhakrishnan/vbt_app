import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ASKED_KEY = 'battery_settings_asked_v1';

/**
 * Opens the phone's battery-optimisation list so the app can be set to
 * "Don't optimise" / "Unrestricted". Without this, many phones stop a
 * tracking app a few minutes after the screen turns off. Falls back to the
 * app's own settings page when the list cannot be opened.
 */
export async function openBatterySettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    await Linking.openSettings();
    return;
  }
  try {
    await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
  } catch {
    await Linking.openSettings().catch(() => {});
  }
}

/** One-time reminder after the first check-in on this phone. */
export async function promptBatterySettingsOnce(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await AsyncStorage.getItem(ASKED_KEY)) return;
    await AsyncStorage.setItem(ASKED_KEY, '1');
  } catch {
    return;
  }
  Alert.alert(
    'Keep tracking running',
    'So your day is tracked even when the screen is off, set this app to "Don’t optimise" in the battery list that opens next, then pick VBT One and choose "Don’t optimise" or "Unrestricted".',
    [
      { text: 'Later', style: 'cancel' },
      { text: 'Open battery settings', onPress: () => void openBatterySettings() },
    ],
  );
}
