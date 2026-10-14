import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Alert, TextInput } from 'react-native';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { dbService } from '../services/db';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, StaleDataBanner } from '../components/FetchStates';
import { ChipPicker } from './dailyVisitTracker/FormFields';
import { color, font, fontWeight, spacing, radius } from '../theme';

type WeeklyPlan = {
  id: string;
  week_start_date: string;
  status: string;
  manager_comment?: string | null;
  end_date?: string | null;
  summary?: string | null;
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

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function todayISO(): string {
  return addDays(new Date().toISOString().slice(0, 10), 0);
}

// Day-by-day date chooser (no date-picker library in this app).
function DateStepper({ label, value, onChange, min }: { label: string; value: string; onChange: (v: string) => void; min: string }) {
  const step = (n: number) => {
    const next = addDays(value, n);
    if (next >= min) onChange(next);
  };
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: color.textSecondary, marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, backgroundColor: color.white }}>
        <TouchableOpacity onPress={() => step(-1)} style={{ padding: 10 }} accessibilityLabel={`${label} earlier`}>
          <Text style={{ fontSize: 18, color: color.primary, fontWeight: fontWeight.bold }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ flex: 1, textAlign: 'center', color: color.textPrimary, fontWeight: fontWeight.bold }}>{value}</Text>
        <TouchableOpacity onPress={() => step(1)} style={{ padding: 10 }} accessibilityLabel={`${label} later`}>
          <Text style={{ fontSize: 18, color: color.primary, fontWeight: fontWeight.bold }}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function WeeklyPlanScreen({ navigation, embedded }: any) {
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
  const [territories, setTerritories] = useState<any[]>([]);
  const [startDate, setStartDate] = useState<string>(todayISO());
  const [endDate, setEndDate] = useState<string>(addDays(todayISO(), 5));
  const [summary, setSummary] = useState('');

  React.useEffect(() => {
    apiClient.request('/plans/my-territories', 'GET', 'task_action')
      .then((territories: any) => {
        if (territories && territories.length > 0) {
          setTerritories(territories);
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
    if (endDate < startDate) {
      Alert.alert('Check Dates', 'The end date cannot be before the start date.');
      return;
    }
    if (summary.trim().length < 3) {
      Alert.alert('Description Needed', 'Add a short description of the work you plan to do.');
      return;
    }
    try {
      const res = await apiClient.request('/plans/submit', 'POST', 'plan_submit', {
        week_start_date: startDate,
        end_date: endDate,
        summary: summary.trim(),
        territory_id: myTerritoryId,
      });
      showSubmitResult(res, 'Plan Submitted', 'Your plan was sent to your manager for approval.');
      setSummary('');
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
            No districts are set up yet — ask your admin to add districts.
          </Text>
        </View>
      )}

      {territories.length > 1 && (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: color.textSecondary, marginBottom: 6 }}>Territory / District</Text>
          <ChipPicker
            options={territories.map((t) => ({ value: t.id, label: t.name }))}
            value={myTerritoryId}
            onChange={setMyTerritoryId}
          />
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <DateStepper label="Start date" value={startDate} min={todayISO()} onChange={(v) => { setStartDate(v); if (endDate < v) setEndDate(v); }} />
        <DateStepper label="End date" value={endDate} min={startDate} onChange={setEndDate} />
      </View>

      <Text style={{ color: color.textSecondary, marginBottom: 6 }}>Work description</Text>
      <TextInput
        style={{ borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, backgroundColor: color.white, padding: 12, minHeight: 90, textAlignVertical: 'top', marginBottom: 12, color: color.textPrimary }}
        placeholder="Short description of the work (villages, dealers, demos, collections…)"
        placeholderTextColor={color.textMuted}
        multiline
        maxLength={1000}
        value={summary}
        onChangeText={setSummary}
      />

      <TouchableOpacity
        style={[styles.btnSubmit, territoryError && styles.btnSubmitDisabled]}
        onPress={handleSubmitNewPlan}
        disabled={territoryError}
      >
        <Text style={styles.btnSubmitText}>Submit Plan</Text>
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
              <Text style={styles.planWeek}>{p.week_start_date}{p.end_date ? ` → ${p.end_date}` : ''}</Text>
              <Text style={[
                styles.planStatus,
                { color: p.status === 'approved' ? color.success : p.status === 'rejected' ? color.error : color.warning }
              ]}>
                {p.status.toUpperCase()}
              </Text>
            </View>

            {!!p.summary && <Text style={{ color: color.textSecondary, marginTop: 6 }}>{p.summary}</Text>}

            {p.manager_comment && (
              <View style={styles.commentBox}>
                <Text style={styles.commentTitle}>Manager Comment:</Text>
                <Text style={styles.commentText}>{p.manager_comment}</Text>
              </View>
            )}
          </View>
        ))
      )}

      {!embedded && (
        <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
          <Text style={styles.btnBackText}>Go Back</Text>
        </TouchableOpacity>
      )}
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
