import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { asList } from '../../utils/lists';
import { useDataFetch, CONNECTION_ERROR_MESSAGE } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Productivity per officer for admins and managers, from GET /productivity
// ?period=daily|weekly|monthly (managers only see their own team; the server
// applies that). Every number is computed by the server from real records.
// The web's attendance PDF and farmer Excel downloads are not offered here:
// the report endpoints only accept an Authorization header (no token in the
// link), and the app has no file-saving library installed.

type Period = 'daily' | 'weekly' | 'monthly';
type SortKey = 'visits' | 'tasks' | 'attendance';

type Productivity = {
  officer_id: string;
  officer_name: string;
  officer_role: string;
  period: string;
  period_start: string;
  period_end: string;
  tasks_assigned: number;
  tasks_completed: number;
  task_completion_rate: number | null;
  days_present: number;
  weekly_plans_submitted: number;
  weekly_plans_approved: number;
  crop_issues_resolved: number;
  visits_completed: number;
  previous_tasks_completed: number | null;
  previous_days_present: number | null;
  previous_crop_issues_resolved: number | null;
  previous_visits_completed: number | null;
};

const PERIODS: { id: Period; label: string }[] = [
  { id: 'daily', label: 'Today' },
  { id: 'weekly', label: 'This week' },
  { id: 'monthly', label: 'This month' },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'visits', label: 'Visits' },
  { id: 'tasks', label: 'Tasks done' },
  { id: 'attendance', label: 'Days present' },
];

const ROLE_LABELS: Record<string, string> = {
  field_officer: 'Field officer',
  sales_officer: 'Sales officer',
  regional_officer: 'Regional officer',
  manager: 'Manager',
  admin: 'Admin',
};

// Date-only values (YYYY-MM-DD) are calendar days, so format them in UTC to
// keep the day exactly as sent.
function prettyDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function rangeLabel(start: string, end: string): string {
  return start === end ? prettyDay(start) : `${prettyDay(start)} to ${prettyDay(end)}`;
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ');
}

function sortValue(p: Productivity, key: SortKey): number {
  if (key === 'tasks') return p.tasks_completed;
  if (key === 'attendance') return p.days_present;
  return p.visits_completed;
}

function rateText(p: Productivity): string {
  if (p.task_completion_rate == null || p.tasks_assigned === 0) return 'No tasks assigned';
  return `${Math.round(p.task_completion_rate * 100)}% of tasks done`;
}

// "5 (was 3)" with a plain-language change when there is a previous value.
function withPrevious(now: number, previous: number | null): string {
  if (previous == null) return String(now);
  const diff = now - previous;
  const change = diff === 0 ? 'no change' : diff > 0 ? `up ${diff}` : `down ${Math.abs(diff)}`;
  return `${now} (was ${previous}, ${change})`;
}

export default function AdminReportsScreen() {
  const role = apiClient.getCurrentUser()?.role;
  const allowed = role === 'admin' || role === 'manager';
  const [period, setPeriod] = useState<Period>('weekly');
  const [sort, setSort] = useState<SortKey>('visits');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<Productivity[]>(
    async () =>
      allowed ? asList<Productivity>(await apiClient.request(`/productivity?period=${period}`, 'GET', 'admin_action')) : [],
    [period, allowed],
  );

  const ranked = useMemo(() => {
    // Rows left over from another period (a failed refetch keeps the old data)
    // must not be shown under this period's tab.
    const rows = (data ?? []).filter((p) => p.period === period);
    rows.sort((a, b) => {
      const diff = sortValue(b, sort) - sortValue(a, sort);
      return diff !== 0 ? diff : a.officer_name.localeCompare(b.officer_name);
    });
    return rows;
  }, [data, sort, period]);

  if (!allowed) {
    return (
      <View style={styles.container}>
        <EmptyState message="Reports are available to admins and managers." />
      </View>
    );
  }

  const first = ranked[0];
  const wrongPeriod = isStale && !first && (data?.length ?? 0) > 0;

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.tab, period === p.id && styles.tabActive]}
            onPress={() => {
              setOpenId(null);
              setPeriod(p.id);
            }}
            accessibilityRole="tab"
            accessibilityLabel={p.label}
            accessibilityState={{ selected: period === p.id }}
          >
            <Text style={[styles.tabText, period === p.id && styles.tabTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <LoadingState />
      ) : error || wrongPeriod ? (
        <ErrorState message={error ?? CONNECTION_ERROR_MESSAGE} onRetry={retry} />
      ) : !first ? (
        <EmptyState message="No productivity data for this period yet." />
      ) : (
        <FlatList
          data={ranked}
          keyExtractor={(item) => item.officer_id}
          contentContainerStyle={styles.listPad}
          refreshing={refreshing}
          onRefresh={refresh}
          ListHeaderComponent={
            <View>
              {isStale && <StaleDataBanner onRetry={retry} />}
              <Text style={styles.range}>{rangeLabel(first.period_start, first.period_end)}</Text>
              <Text style={styles.sortLabel}>Rank by</Text>
              <View style={styles.sortRow}>
                {SORTS.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={[styles.chip, sort === s.id && styles.chipOn]}
                    onPress={() => setSort(s.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Rank by ${s.label}`}
                    accessibilityState={{ selected: sort === s.id }}
                  >
                    <Text style={[styles.chipText, sort === s.id && styles.chipTextOn]}>{s.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
          renderItem={({ item, index }) => {
            const open = openId === item.officer_id;
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => setOpenId(open ? null : item.officer_id)}
                accessibilityRole="button"
                accessibilityLabel={`Rank ${index + 1}, ${item.officer_name}. ${item.visits_completed} visits, ${item.tasks_completed} tasks done, ${item.days_present} days present. ${open ? 'Hide' : 'Show'} details`}
                accessibilityState={{ expanded: open }}
              >
                <View style={styles.cardTop}>
                  <View style={styles.rank}>
                    <Text style={styles.rankText}>{index + 1}</Text>
                  </View>
                  <View style={styles.nameBox}>
                    <Text style={styles.name}>{item.officer_name}</Text>
                    <Text style={styles.meta}>{roleLabel(item.officer_role)}</Text>
                  </View>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={color.textMuted} />
                </View>

                <View style={styles.stats}>
                  <Stat value={item.visits_completed} label="Visits" />
                  <Stat value={item.tasks_completed} label="Tasks done" />
                  <Stat value={item.days_present} label="Days present" />
                </View>

                {open && (
                  <View style={styles.expand}>
                    <Row label="Tasks" value={`${item.tasks_completed} of ${item.tasks_assigned} done`} />
                    <Row label="Task completion" value={rateText(item)} />
                    <Row label="Visits completed" value={withPrevious(item.visits_completed, item.previous_visits_completed)} />
                    <Row label="Tasks completed" value={withPrevious(item.tasks_completed, item.previous_tasks_completed)} />
                    <Row label="Days present" value={withPrevious(item.days_present, item.previous_days_present)} />
                    <Row label="Crop issues resolved" value={withPrevious(item.crop_issues_resolved, item.previous_crop_issues_resolved)} />
                    <Row
                      label="Weekly plans"
                      value={`${item.weekly_plans_submitted} submitted, ${item.weekly_plans_approved} approved`}
                    />
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  tabs: {
    flexDirection: 'row',
    backgroundColor: color.cardBg,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
  },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary },
  tabTextActive: { color: color.white },
  listPad: { padding: spacing.lg, paddingTop: spacing.sm },
  range: { fontSize: font.body, color: color.textSecondary, marginBottom: spacing.md },
  sortLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  sortRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: font.body, color: color.textPrimary },
  chipTextOn: { color: color.white, fontWeight: fontWeight.semibold },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    minHeight: 44,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  rank: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: color.primaryPale,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rankText: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.primary },
  nameBox: { flex: 1, marginRight: spacing.sm },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textMuted, marginTop: 2 },
  stats: { flexDirection: 'row', marginTop: spacing.md },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: font.title, fontWeight: fontWeight.bold, color: color.textPrimary },
  statLabel: { fontSize: font.caption, color: color.textSecondary, marginTop: 2, textAlign: 'center' },
  expand: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: color.borderLight, paddingTop: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs + 2 },
  rowLabel: { flex: 1, fontSize: font.body, color: color.textSecondary, marginRight: spacing.md },
  rowValue: { flex: 1, fontSize: font.body, color: color.textPrimary, fontWeight: fontWeight.semibold, textAlign: 'right' },
});
