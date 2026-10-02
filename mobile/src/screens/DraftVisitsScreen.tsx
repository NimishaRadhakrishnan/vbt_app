import React from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, Alert } from 'react-native';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Draft = {
  id: string;
  updated_at: string;
  farmer_name: string | null;
  crop_name: string | null;
  step_label: string | null;
};

// Section 26: "Daily Visit Tracker -> Drafts" - resume a partially
// completed visit without losing progress. Deleting a draft here is a
// separate, explicit action from submitting it (submit deletes its
// source draft automatically via draft_id - see DailyVisitTrackerScreen's
// handleSubmit).
export default function DraftVisitsScreen({ navigation }: any) {
  const { data, loading, error, isStale, retry, refresh } = useDataFetch<Draft[]>(
    () => apiClient.request('/visits/daily-tracker/drafts', 'GET', 'plan_submit').then((d) => d || []),
    []
  );

  const handleDelete = (id: string) => {
    Alert.alert('Discard Draft', 'This draft will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiClient.request(`/visits/daily-tracker/drafts/${id}`, 'DELETE', 'plan_submit');
            refresh();
          } catch (err: any) {
            Alert.alert('Could Not Delete', err.message || 'Please try again.');
          }
        },
      },
    ]);
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  const drafts = data ?? [];

  return (
    <FlatList
      style={styles.container}
      data={drafts}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={
        <>
          <Text style={styles.heading}>Draft Visits</Text>
          {isStale && <StaleDataBanner onRetry={retry} />}
        </>
      }
      ListEmptyComponent={<EmptyState message="No saved drafts." actionHint="Drafts appear here when you save a visit report partway through." />}
      contentContainerStyle={drafts.length === 0 ? { flexGrow: 1 } : { paddingBottom: spacing.xl }}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('DailyVisitTracker', { draftId: item.id })}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.farmerName}>{item.farmer_name || 'Untitled draft'}</Text>
            <TouchableOpacity onPress={() => handleDelete(item.id)}>
              <Text style={styles.deleteLink}>Discard</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.meta}>
            {item.step_label ? `Last on: ${item.step_label}` : 'In progress'}
          </Text>
          <Text style={styles.updatedAt}>Saved {new Date(item.updated_at).toLocaleString()}</Text>
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
  farmerName: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  deleteLink: {
    fontSize: font.caption,
    color: color.error,
    fontWeight: fontWeight.semibold,
  },
  meta: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: spacing.xs,
  },
  updatedAt: {
    fontSize: font.caption,
    color: color.textMuted,
    marginTop: 2,
  },
});
