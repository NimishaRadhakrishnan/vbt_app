import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { color, font, fontWeight, spacing, radius } from '../theme';

// Paired with useDataFetch - one visual error/retry state used everywhere
// instead of each screen inventing its own (or, on 6 screens, having none
// at all). Deliberately plain: a message and one big tap target, nothing
// clever, since this is what an officer sees on a bad connection in a
// field, not a design showcase.
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <TouchableOpacity style={styles.container} onPress={onRetry} activeOpacity={0.7}>
      <Text style={styles.icon}>⚠️</Text>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.retryBtn}>
        <Text style={styles.retryText}>Tap to Retry</Text>
      </View>
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
      <Text style={styles.emptyIcon}>📭</Text>
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
      <Text style={styles.staleText}>Showing saved data — tap to update when back online</Text>
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
    fontSize: font.heading + 8,
    marginBottom: spacing.md,
  },
  emptyIcon: {
    fontSize: font.heading + 8,
    marginBottom: spacing.md,
    opacity: 0.5,
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
  retryBtn: {
    backgroundColor: color.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md - 2,
    borderRadius: radius.sm,
  },
  retryText: {
    color: color.white,
    fontWeight: fontWeight.bold,
    fontSize: font.caption + 1,
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
