import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { ErrorState, StaleDataBanner } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

type MomentumMe = {
  monthly_tasks_completed: number;
  monthly_task_target: number;
};

type QuarterlyMonth = { year: number; month: number; actual: number; target: number };
type QuarterlyData = { months: QuarterlyMonth[]; quarter_actual: number; quarter_target: number };

type DashboardSummary = {
  visits_today: number;
  draft_count: number;
  submitted_total: number;
  trial_active: number;
  trial_started_this_month: number;
  trial_converted_total: number;
  sales_orders_total: number;
  sales_conversions_total: number;
  sales_order_value_total: number;
};

const MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Productivity widget state. Monthly progress comes from GET /momentum/me;
// the 3-month rollup toggle below (showQuarterly/quarterly state) reads
// GET /momentum/quarterly, which derives targets from admin-configured
// annual_targets + monthly_target_weights - both real endpoints now.
function progressState(completed: number, target: number): 'achieved' | 'on_track' | 'behind' {
  if (target <= 0) return 'on_track';
  if (completed >= target) return 'achieved';
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const expectedByNow = target * (now.getDate() / daysInMonth);
  return completed >= expectedByNow ? 'on_track' : 'behind';
}

const STATE_LABEL: Record<string, string> = {
  achieved: 'Target Achieved',
  on_track: 'On Track',
  behind: 'Behind Target',
};

const STATE_COLOR: Record<string, string> = {
  achieved: color.success,
  on_track: color.info,
  behind: color.warning,
};

export default function DashboardScreen({ navigation }: any) {
  const currentUser = apiClient.getCurrentUser();
  const {
    data: momentum,
    loading: loadingMomentum,
    error: momentumError,
    isStale: momentumStale,
    retry: retryMomentum,
  } = useDataFetch<MomentumMe>(
    () => apiClient.request('/momentum/me', 'GET', 'task_action'),
    []
  );

  const {
    data: summary,
    loading: summaryLoading,
    error: summaryError,
    isStale: summaryStale,
    retry: retrySummary,
  } = useDataFetch<DashboardSummary>(
    () => apiClient.request('/visits/daily-tracker/dashboard-summary', 'GET', 'plan_submit'),
    []
  );

  const [showQuarterly, setShowQuarterly] = useState(false);
  const [quarterly, setQuarterly] = useState<QuarterlyData | null>(null);
  const [loadingQuarterly, setLoadingQuarterly] = useState(false);

  const toggleQuarterly = () => {
    const next = !showQuarterly;
    setShowQuarterly(next);
    if (next && !quarterly) {
      setLoadingQuarterly(true);
      apiClient
        .request('/momentum/quarterly', 'GET', 'task_action')
        .then((data: QuarterlyData) => setQuarterly(data))
        .catch((err) => console.warn('Failed to load quarterly rollup', err))
        .finally(() => setLoadingQuarterly(false));
    }
  };

  const completed = momentum?.monthly_tasks_completed ?? 0;
  const target = momentum?.monthly_task_target ?? 0;
  const pct = target > 0 ? Math.min(1, completed / target) : 0;
  const state = progressState(completed, target);

  return (
    <ScrollView style={styles.container}>
      {/* Greeting header - online/offline toggle and sign out now live on Profile */}
      <View style={styles.header}>
        <Text style={styles.username}>{currentUser?.fullName ?? 'Field Officer'}</Text>
        <Text style={styles.role}>
          {currentUser?.role ?? ''}{currentUser?.employeeId ? ` (${currentUser.employeeId})` : ''}
        </Text>
      </View>

      {/* Productivity widget */}
      <View style={styles.widgetCard}>
        <View style={styles.widgetHeader}>
          <Text style={styles.widgetTitle}>This Month's Progress</Text>
          {!loadingMomentum && !momentumError && (
            <Text style={[styles.stateBadge, { backgroundColor: STATE_COLOR[state] }]}>
              {STATE_LABEL[state]}
            </Text>
          )}
        </View>

        {momentumStale && <StaleDataBanner onRetry={retryMomentum} />}

        {loadingMomentum ? (
          <ActivityIndicator color={color.primary} style={{ marginVertical: 12 }} />
        ) : momentumError ? (
          <ErrorState message={momentumError} onRetry={retryMomentum} />
        ) : (
          <>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: STATE_COLOR[state] }]} />
            </View>
            <Text style={styles.progressLabel}>
              {completed} of {target || '—'} tasks completed
            </Text>

            <TouchableOpacity onPress={toggleQuarterly} style={styles.quarterlyToggle}>
              <Text style={styles.quarterlyToggleText}>
                {showQuarterly ? 'Hide 3-month view ▲' : 'Show 3-month view ▼'}
              </Text>
            </TouchableOpacity>

            {showQuarterly && (
              loadingQuarterly ? (
                <ActivityIndicator color={color.primary} style={{ marginTop: 10 }} />
              ) : quarterly ? (
                <View style={styles.quarterlyBox}>
                  {quarterly.months.map((m, i) => (
                    <View key={i} style={styles.quarterlyRow}>
                      <Text style={styles.quarterlyMonth}>{MONTH_SHORT[m.month]}</Text>
                      <Text style={styles.quarterlyValue}>
                        {m.actual} / {m.target || '—'}
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.quarterlyRow, styles.quarterlyTotalRow]}>
                    <Text style={styles.quarterlyMonthTotal}>3-Month Total</Text>
                    <Text style={styles.quarterlyValueTotal}>
                      {quarterly.quarter_actual} / {quarterly.quarter_target || '—'}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.widgetNote}>Could not load the 3-month view.</Text>
              )
            )}
          </>
        )}
      </View>

      {/* Remaining Dashboard tiles - Field Visit/Farmer/Dealer/CropIssue moved to the Field Network tab */}
      <View style={styles.grid}>
        <TouchableOpacity
          style={[styles.tile, { backgroundColor: '#e8f5e9' }]}
          onPress={() => navigation.navigate('Attendance')}
        >
          <Ionicons name="time-outline" size={30} color={color.primary} style={styles.tileIcon} />
          <Text style={styles.tileTitle}>Shift / Attendance</Text>
          <Text style={styles.tileDesc}>Check-In & Check-Out</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tile, { backgroundColor: '#e8eaf6' }]}
          onPress={() => navigation.navigate('WeeklyPlan')}
        >
          <Ionicons name="calendar-outline" size={30} color={color.primary} style={styles.tileIcon} />
          <Text style={styles.tileTitle}>Weekly Plan</Text>
          <Text style={styles.tileDesc}>Submit schedules & view status</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tile, { backgroundColor: '#f1f8e9' }]}
          onPress={() => navigation.navigate('KpiSummary')}
        >
          <Ionicons name="stats-chart-outline" size={30} color={color.primary} style={styles.tileIcon} />
          <Text style={styles.tileTitle}>My KPIs</Text>
          <Text style={styles.tileDesc}>Farmers, demos, cents & more</Text>
        </TouchableOpacity>
      </View>

      {/* Daily Visit Tracker summary cards (section 39) - all real counts
          from GET /visits/daily-tracker/dashboard-summary, each tappable
          into the screen that actually shows that data. These screens
          live in the sibling Field Network stack, not this Dashboard
          stack, so taps use the same nested cross-tab navigation pattern
          QuickActionSheet already uses elsewhere in this app. */}
      {summaryLoading ? (
        <ActivityIndicator color={color.primary} style={{ marginTop: spacing.lg }} />
      ) : summaryError ? (
        <ErrorState message={summaryError} onRetry={retrySummary} />
      ) : summary ? (
        <>
          {summaryStale && <StaleDataBanner onRetry={retrySummary} />}

          <Text style={styles.sectionHeading}>Daily Visit Tracker</Text>
          <View style={styles.summaryGrid}>
            <SummaryCard
              label="Visits Today"
              value={summary.visits_today}
              color="#e8f5e9"
              onPress={() => navigation.navigate('DailyVisitTracker')}
            />
            <SummaryCard
              label="Draft Visits"
              value={summary.draft_count}
              color="#fce4ec"
              onPress={() => navigation.navigate('DraftVisits')}
            />
            <SummaryCard
              label="Submitted Visits"
              value={summary.submitted_total}
              color="#ede7f6"
              onPress={() => navigation.navigate('MyVisits')}
            />
          </View>

          <Text style={styles.sectionHeading}>Trial</Text>
          <View style={styles.summaryGrid}>
            <SummaryCard label="Active Trials" value={summary.trial_active} color="#fff8e1" />
            <SummaryCard label="Started This Month" value={summary.trial_started_this_month} color="#fff8e1" />
            <SummaryCard label="Converted" value={summary.trial_converted_total} color="#fff8e1" />
          </View>

          <Text style={styles.sectionHeading}>Sales</Text>
          <View style={styles.summaryGrid}>
            <SummaryCard label="Orders" value={summary.sales_orders_total} color="#e0f2f1" />
            <SummaryCard label="Conversions" value={summary.sales_conversions_total} color="#e0f2f1" />
            <SummaryCard label="Order Value" value={`₹${summary.sales_order_value_total.toLocaleString()}`} color="#e0f2f1" wide />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function SummaryCard({
  label,
  value,
  color: bg,
  onPress,
  wide,
}: {
  label: string;
  value: number | string;
  color: string;
  onPress?: () => void;
  wide?: boolean;
}) {
  // Always TouchableOpacity (rather than switching component type based
  // on whether onPress exists) - View and TouchableOpacity don't share a
  // prop type TypeScript can unify into one JSX element variable, and a
  // TouchableOpacity with no onPress simply isn't pressable, which is
  // exactly the behavior wanted for the non-navigable Trial/Sales cards.
  return (
    <TouchableOpacity
      style={[styles.summaryCard, { backgroundColor: bg }, wide && styles.summaryCardWide]}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  sectionHeading: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
  },
  summaryCard: {
    width: '31%',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginRight: '2%',
    marginBottom: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
  },
  summaryCardWide: {
    width: '65%',
  },
  summaryValue: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  summaryLabel: {
    fontSize: font.caption,
    color: color.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  header: {
    backgroundColor: color.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  username: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.white,
  },
  role: {
    fontSize: font.caption,
    color: color.primaryPale,
    marginTop: 2,
  },
  widgetCard: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: 18,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: color.border,
    shadowColor: color.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  widgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  widgetTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  stateBadge: {
    color: color.white,
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: color.borderLight,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
  },
  progressLabel: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: spacing.sm,
  },
  widgetNote: {
    fontSize: font.caption,
    color: color.textMuted,
    marginTop: 10,
    fontStyle: 'italic',
  },
  quarterlyToggle: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  quarterlyToggleText: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.primary,
  },
  quarterlyBox: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
    paddingTop: 10,
  },
  quarterlyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  quarterlyMonth: {
    fontSize: font.caption,
    color: color.textSecondary,
  },
  quarterlyValue: {
    fontSize: font.caption,
    color: color.textPrimary,
    fontWeight: fontWeight.semibold,
  },
  quarterlyTotalRow: {
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
  },
  quarterlyMonthTotal: {
    fontSize: font.caption,
    color: color.primary,
    fontWeight: fontWeight.bold,
  },
  quarterlyValueTotal: {
    fontSize: font.caption,
    color: color.primary,
    fontWeight: fontWeight.bold,
  },
  grid: {
    padding: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  tile: {
    width: '48%',
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: color.border,
    shadowColor: color.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  tileIcon: {
    marginBottom: spacing.md,
  },
  tileTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  tileDesc: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: spacing.xs,
  },
});
