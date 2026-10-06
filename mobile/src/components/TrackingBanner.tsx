import React, { useSyncExternalStore } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { trackingHealth } from '../services/trackingHealth';
import { color, font, fontWeight, spacing } from '../theme';

/** Shown on every section screen while an officer's tracking is not working. */
export default function TrackingBanner() {
  const problem = useSyncExternalStore(trackingHealth.subscribe, trackingHealth.get, trackingHealth.get);
  if (!problem) return null;

  const message =
    problem === 'permission'
      ? 'Your location is not set to "Allow all the time", so tracking can stop when the screen is off.'
      : 'Tracking stopped on this phone. It will restart on its own; if it does not, reopen the app.';

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="warning-outline" size={20} color={color.warningText} />
      <Text style={styles.text}>{message}</Text>
      {problem === 'permission' && (
        <TouchableOpacity
          style={styles.btn}
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
        >
          <Text style={styles.btnText}>Settings</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: color.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: color.warningBorder,
  },
  text: { flex: 1, fontSize: font.caption, color: color.warningText },
  btn: { minHeight: 36, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: 18, backgroundColor: color.warningText },
  btnText: { color: color.white, fontSize: font.caption, fontWeight: fontWeight.semibold },
});
