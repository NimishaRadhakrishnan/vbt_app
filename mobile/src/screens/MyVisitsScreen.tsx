import React from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity } from 'react-native';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

type MyVisit = {
  visit_id: string;
  visit_date: string;
  farmer_name: string | null;
  village: string | null;
  crop_name: string | null;
  is_trial: boolean;
  demo_status: string | null;
  purchased: boolean | null;
  conversion_status: string | null;
};

// Section 28: "My Visits" - the officer-facing history the Daily Visit
// Tracker was missing until now. Uses the shared useDataFetch pattern
// (loading/error/retry/stale) from the earlier audit fix pass rather
// than a bespoke fetch, same as every other list screen in the app.
export default function MyVisitsScreen({ navigation }: any) {
  const { data, loading, error, isStale, retry } = useDataFetch<MyVisit[]>(
    () => apiClient.request('/visits/daily-tracker/my-visits', 'GET', 'plan_submit').then((d) => d || []),
    []
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  const visits = data ?? [];

  return (
    <FlatList
      style={styles.container}
      data={visits}
      keyExtractor={(item) => item.visit_id}
      ListHeaderComponent={
        <>
          <Text style={styles.heading}>My Visits</Text>
          {isStale && <StaleDataBanner onRetry={retry} />}
        </>
      }
      ListEmptyComponent={<EmptyState message="No visits submitted yet." actionHint="Tap + to log your first visit." />}
      contentContainerStyle={visits.length === 0 ? { flexGrow: 1 } : { paddingBottom: spacing.xl }}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('MyVisitDetail', { visitId: item.visit_id })}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardDate}>{item.visit_date}</Text>
            {item.is_trial && <Text style={styles.trialBadge}>Trial</Text>}
          </View>
          <Text style={styles.farmerName}>{item.farmer_name ?? 'Unknown farmer'}</Text>
          <Text style={styles.meta}>{item.village ?? '—'} · {item.crop_name ?? '—'}</Text>
          <View style={styles.footerRow}>
            {item.is_trial && item.demo_status && (
              <Text style={styles.pill}>{item.demo_status}</Text>
            )}
            <Text style={styles.pill}>
              {item.purchased ? (item.conversion_status ?? 'Converted') : 'No sale'}
            </Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  emptyText: {
    color: color.textMuted,
    fontSize: font.body,
  },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: color.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardDate: {
    fontSize: font.caption,
    color: color.textSecondary,
  },
  trialBadge: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.white,
    backgroundColor: color.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  farmerName: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginTop: spacing.xs,
  },
  meta: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: 2,
  },
  footerRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  pill: {
    fontSize: font.caption,
    color: color.textSecondary,
    backgroundColor: color.screenBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    marginRight: spacing.xs,
  },
});
