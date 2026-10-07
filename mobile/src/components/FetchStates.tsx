import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, fontWeight, spacing, radius } from '../theme';

// Paired with useDataFetch - one visual error state used everywhere. There is
// no retry button: the screen quietly tries again a few times by itself
// (every 12 seconds, up to 4 times), and touching the message tries at once.
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const retryRef = React.useRef(onRetry);
  retryRef.current = onRetry;
  const [tries, setTries] = React.useState(0);

  React.useEffect(() => {
    if (tries >= 4) return;
    const id = setTimeout(() => {
      setTries((t) => t + 1);
      retryRef.current();
    }, 12000);
    return () => clearTimeout(id);
  }, [tries]);

  return (
    <TouchableOpacity style={styles.container} onPress={onRetry} activeOpacity={0.7}>
      <Ionicons name="cloud-offline-outline" size={40} color={color.textMuted} style={styles.icon} />
      <Text style={styles.message}>{message}</Text>
    </TouchableOpacity>
  );
}

export function LoadingState() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={color.primary} />
    </View>
  );
}

// One empty-state look for every list/data screen (design pass item 1) -
// a plain message plus an optional one-line action telling the user what
// to do about it ("tap + to log one"), not just a bare "No data." Screens
// previously either had no empty state at all (falling through to a
// blank list with nothing on it) or wrote their own one-off text.
export function EmptyState({ message, actionHint }: { message: string; actionHint?: string }) {
  return (
    <View style={styles.container}>
      <Ionicons name="file-tray-outline" size={48} color={color.textDisabled} style={styles.emptyIcon} />
      <Text style={styles.message}>{message}</Text>
      {actionHint && <Text style={styles.emptyHint}>{actionHint}</Text>}
    </View>
  );
}

// Shown above a screen's content when it's displaying data left over from
// the last successful fetch, not this one - e.g. the Dashboard widget or
// KPI summary rendering an old number after a failed refresh. Without
// this, a genuinely-zero month and a "couldn't reach the server" state
// looked identical.
export function StaleDataBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <TouchableOpacity style={styles.staleBanner} onPress={onRetry} activeOpacity={0.7}>
      <Text style={styles.staleText}>Showing saved data. Updating when back online.</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl + spacing.sm,
  },
  icon: {
    marginBottom: spacing.md,
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  message: {
    fontSize: font.body,
    color: color.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  emptyHint: {
    fontSize: font.caption,
    color: color.textMuted,
    textAlign: 'center',
    marginTop: -spacing.md,
  },
  staleBanner: {
    backgroundColor: color.warningBg,
    borderWidth: 1,
    borderColor: color.warningBorder,
    borderRadius: radius.sm,
    padding: spacing.md - 2,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  staleText: {
    fontSize: font.caption,
    color: color.warningText,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});
