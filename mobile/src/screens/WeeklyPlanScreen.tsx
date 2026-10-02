import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { dbService } from '../services/db';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, StaleDataBanner } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

type WeeklyPlan = {
  id: string;
  week_start_date: string;
  status: string;
  manager_comment?: string | null;
};

// Next Monday, in YYYY-MM-DD - previously this was a fixed hardcoded past
// date, so every submission (if it had succeeded) would have collided on
// the same already-passed week.
function nextMondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (8 - day) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export default function WeeklyPlanScreen({ navigation }: any) {
  // A queued plan_submit has no server id/status yet - not real list data
  // to fake a row for, so it's surfaced as a count banner instead. See
  // audit fix #1: an officer should never see their own submission
  // history and be unable to tell a queued-not-yet-sent plan apart from
  // one the server never received.
  const [pendingCount, setPendingCount] = useState(0);

  // Previously a single hardcoded fake UUID was sent as every plan's
  // territory_id regardless of who submitted it - every officer's
  // weekly schedule was silently filed under the same wrong territory.
  // Fetches the officer's own real assignment via the new
  // GET /plans/my-territories endpoint (added alongside this fix - no
  // such lookup existed anywhere before, only an admin-side assignment
  // mechanism with no way to read it back).
  const [myTerritoryId, setMyTerritoryId] = useState<string | null>(null);
  const [territoryError, setTerritoryError] = useState(false);

  React.useEffect(() => {
    apiClient.request('/plans/my-territories', 'GET', 'task_action')
      .then((territories: any) => {
        if (territories && territories.length > 0) {
          setMyTerritoryId(territories[0].id);
        } else {
          setTerritoryError(true);
        }
      })
      .catch(() => setTerritoryError(true));
  }, []);

  const refreshPendingCount = () => {
    dbService.getQueuedItems().then((items) => {
      setPendingCount(items.filter((i) => i.type === 'plan_submit').length);
    });
  };

  // Previously this list was two hardcoded fake entries, permanently -
  // never connected to the backend at all, regardless of what plans
  // actually existed or their real status. Also previously had no
  // error/retry state at all - a failed load just left "Loading your
  // plans..." on screen forever.
  const { data: plans, loading, error, isStale, retry, refresh } = useDataFetch<WeeklyPlan[]>(
    () => apiClient.request('/plans', 'GET', 'plan_submit').then((d) => d || []),
    []
  );

  React.useEffect(() => {
    refreshPendingCount();
  }, []);

  const handleSubmitNewPlan = async () => {
    if (!myTerritoryId) {
      Alert.alert(
        'No Territory Assigned',
        'You don\'t have a territory assigned yet. Contact your admin before submitting a weekly plan.'
      );
      return;
    }
    try {
      const res = await apiClient.request('/plans/submit', 'POST', 'plan_submit', {
        week_start_date: nextMondayISO(),
        activities: [
          {
            date: nextMondayISO(),
            territory_id: myTerritoryId,
            activity_type: 'Dealer Visit',
            planned_villages: [],
            planned_dealers: [],
          },
        ],
      });
      showSubmitResult(res, 'Plan Submitted', 'Weekly schedule sent to regional manager for verification.');
      refresh();
      refreshPendingCount();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Submission failed.');
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  const planList = plans ?? [];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Weekly Tour Plans</Text>
      {isStale && <StaleDataBanner onRetry={retry} />}

      {territoryError && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingBannerText}>
            No territory assigned yet — contact your admin before submitting a plan.
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.btnSubmit, territoryError && styles.btnSubmitDisabled]}
        onPress={handleSubmitNewPlan}
        disabled={territoryError}
      >
        <Text style={styles.btnSubmitText}>Submit Plan (week of {nextMondayISO()})</Text>
      </TouchableOpacity>

      <Text style={styles.sectionHeader}>Plan Submission History</Text>

      {pendingCount > 0 && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingBannerText}>
            {pendingCount} plan{pendingCount > 1 ? 's' : ''} saved on your phone, waiting to sync
          </Text>
        </View>
      )}

      {planList.length === 0 ? (
        <Text style={styles.emptyNote}>No plans submitted yet.</Text>
      ) : (
        planList.map((p) => (
          <View key={p.id} style={styles.planCard}>
            <View style={styles.row}>
              <Text style={styles.planWeek}>Week of: {p.week_start_date}</Text>
              <Text style={[
                styles.planStatus,
                { color: p.status === 'approved' ? color.success : p.status === 'rejected' ? color.error : color.warning }
              ]}>
                {p.status.toUpperCase()}
              </Text>
            </View>

            {p.manager_comment && (
              <View style={styles.commentBox}>
                <Text style={styles.commentTitle}>Manager Comment:</Text>
                <Text style={styles.commentText}>{p.manager_comment}</Text>
              </View>
            )}
          </View>
        ))
      )}

      <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
        <Text style={styles.btnBackText}>Go Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
    padding: spacing.xl,
  },
  title: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginBottom: spacing.xl,
    marginTop: spacing.xl,
  },
  btnSubmit: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: 14,
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  btnSubmitDisabled: {
    backgroundColor: color.textDisabled,
  },
  btnSubmitText: {
    color: color.white,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
  sectionHeader: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
    marginBottom: spacing.md,
  },
  pendingBanner: {
    backgroundColor: color.warningBg,
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: color.warningBorder,
  },
  pendingBannerText: {
    fontSize: font.caption,
    color: color.warningText,
    fontWeight: fontWeight.semibold,
  },
  emptyNote: {
    fontSize: font.body,
    color: color.textMuted,
    fontStyle: 'italic',
    marginBottom: spacing.lg,
  },
  planCard: {
    backgroundColor: color.white,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planWeek: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  planStatus: {
    fontSize: font.body,
    fontWeight: fontWeight.bold,
  },
  commentBox: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
  },
  commentTitle: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
  },
  commentText: {
    fontSize: font.body,
    color: color.textPrimary,
    marginTop: 2,
  },
  btnBack: {
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: 40,
  },
  btnBackText: {
    color: color.primary,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
});
