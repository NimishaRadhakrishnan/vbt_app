import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../../components/FetchStates';
import { asList } from '../../utils/lists';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Field names below match WeeklyPlanResponse in
// backend/app/presentation/schemas/planning_schemas.py.
type PlanActivity = {
  id: string;
  date: string;
  territory_id: string;
  activity_type: string;
  planned_villages: string[] | null;
  planned_dealers: string[] | null;
  description: string | null;
};

type PlanDeviation = {
  id: string;
  date: string;
  reason: string;
  details: string;
  recorded_at: string;
};

type WeeklyPlan = {
  id: string;
  user_id: string;
  week_start_date: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  manager_comment: string | null;
  activities: PlanActivity[] | null;
  deviations: PlanDeviation[] | null;
  created_at: string;
  updated_at: string;
};

type PlanFilter = 'pending' | 'approved' | 'rejected';
type PlansResult = { filter: PlanFilter; plans: WeeklyPlan[] };

// GET /users returns { items, total } (UserListResponse), GET
// /location/territories returns a plain list.
type UserLite = { id: string; full_name: string; role: string };
type TerritoryLite = { id: string; name: string; district: string | null };

const FILTERS: PlanFilter[] = ['pending', 'approved', 'rejected'];
const FILTER_LABEL: Record<PlanFilter, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatDay(day: string, withYear: boolean): string {
  const d = parseDay(day);
  if (!d) return day;
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  });
}

function formatWeek(start: string): string {
  const d = parseDay(start);
  if (!d) return start;
  const end = new Date(d.getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
  return `${formatDay(start, false)} to ${formatDay(end, true)}`;
}

// Backend datetimes are timezone-aware; if one ever arrives without an
// offset, treat it as UTC so it is not shifted by the phone's own zone.
function parseInstant(value: string): Date {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

function formatInstantIST(value: string): string {
  const d = parseInstant(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function titleCase(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function statusLabel(status: string): string {
  if (status === 'rejected') return 'Rejected';
  if (status === 'needs_modification') return 'Needs changes';
  return titleCase(status);
}

// Weekly plan approvals. Data comes from GET /plans?status_filter=...
// (admins see every officer's plans; the server only returns a manager their
// own plans) and decisions go to PATCH /plans/{id}/approve with
// { approve, comment }. The server refuses a rejection without a comment, so
// this screen asks for one first, same as the web dashboard.
export default function AdminPlanApprovalsScreen() {
  const [filter, setFilter] = useState<PlanFilter>('pending');
  const [selected, setSelected] = useState<WeeklyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Decisions saved while offline: hide the buttons so the same plan is not
  // decided twice before the phone syncs.
  const [queued, setQueued] = useState<Record<string, boolean>>({});

  // Quick tab taps start overlapping requests. A late answer for an old tab
  // must not replace the newer one (the screen would spin forever), so it is
  // dropped by never resolving.
  const latestFilter = useRef(filter);
  latestFilter.current = filter;

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<PlansResult>(
    async () => {
      const requested = filter;
      const res = await apiClient.request(`/plans?status_filter=${requested}&limit=100`, 'GET', 'admin_action');
      if (latestFilter.current !== requested) return new Promise<PlansResult>(() => {});
      return { filter: requested, plans: asList<WeeklyPlan>(res) };
    },
    [filter],
  );

  // Names are a convenience: if either lookup fails the screen still works
  // and falls back to generic wording.
  const { data: users } = useDataFetch<UserLite[]>(
    async () => asList<UserLite>(await apiClient.request('/users?limit=200', 'GET', 'admin_action')),
    [],
    { refetchOnFocus: false },
  );
  const { data: territories } = useDataFetch<TerritoryLite[]>(
    async () => {
      return asList<TerritoryLite>(await apiClient.request('/location/territories', 'GET', 'admin_action'));
    },
    [],
    { refetchOnFocus: false },
  );

  const userById = useMemo(() => {
    const m = new Map<string, UserLite>();
    (users ?? []).forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);
  const territoryName = useMemo(() => {
    const m = new Map<string, string>();
    (territories ?? []).forEach((t) => m.set(t.id, t.name));
    return (id: string) => m.get(id) ?? 'Territory not listed';
  }, [territories]);

  const plans = useMemo(() => {
    if (!data || data.filter !== filter) return null;
    return [...data.plans].sort((a, b) => b.week_start_date.localeCompare(a.week_start_date));
  }, [data, filter]);

  const decide = async (plan: WeeklyPlan, approve: boolean, comment?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const body = approve ? { approve: true } : { approve: false, comment };
      const res = await apiClient.request(`/plans/${plan.id}/approve`, 'PATCH', 'admin_action', body);
      setSelected(null);
      if (res?.offline) {
        setQueued((q) => ({ ...q, [plan.id]: approve }));
        Alert.alert('You are offline', 'Your decision is saved on this phone and will be sent when you are back online.');
      } else {
        retry();
      }
    } catch (err: any) {
      Alert.alert('Could not update', err?.message ?? 'Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const officerName = (id: string) => userById.get(id)?.full_name ?? 'Field staff';

  let body: React.ReactNode;
  if (plans === null) {
    // Either the first load, or a different filter's data is still showing.
    body = error ? (
      <ErrorState message={error} onRetry={retry} />
    ) : isStale && !loading ? (
      <ErrorState message="Couldn't load plans. Tap to try again." onRetry={retry} />
    ) : (
      <LoadingState />
    );
  } else if (plans.length === 0) {
    body = (
      <EmptyState
        message={`No ${FILTER_LABEL[filter].toLowerCase()} weekly plans.`}
        actionHint={filter === 'pending' ? 'New plans show up here when officers submit them.' : undefined}
      />
    );
  } else {
    body = (
      <FlatList
        data={plans}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={isStale ? <StaleDataBanner onRetry={retry} /> : null}
        renderItem={({ item }) => {
          const count = (item.activities ?? []).length;
          const role = userById.get(item.user_id)?.role;
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => setSelected(item)}
              accessibilityRole="button"
              accessibilityLabel={`${officerName(item.user_id)}, week of ${formatWeek(item.week_start_date)}, ${statusLabel(item.status)}. Open plan`}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardTitleWrap}>
                  <Text style={styles.name}>{officerName(item.user_id)}</Text>
                  {role ? <Text style={styles.meta}>{titleCase(role)}</Text> : null}
                </View>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.week}>{formatWeek(item.week_start_date)}</Text>
              <View style={styles.cardBottom}>
                <Text style={styles.meta}>{count === 1 ? '1 planned activity' : `${count} planned activities`}</Text>
                <Ionicons name="chevron-forward" size={20} color={color.textMuted} />
              </View>
              {queued[item.id] !== undefined && (
                <Text style={styles.queuedNote}>
                  Your decision ({queued[item.id] ? 'approve' : 'reject'}) is saved on this phone and waiting to be sent.
                </Text>
              )}
            </TouchableOpacity>
          );
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${FILTER_LABEL[f].toLowerCase()} plans`}
            accessibilityState={{ selected: filter === f }}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>{FILTER_LABEL[f]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {body}

      <Modal visible={selected !== null} animationType="slide" onRequestClose={() => { if (!busy) setSelected(null); }}>
        {selected && (
          <PlanDetail
            key={selected.id}
            plan={selected}
            officerName={officerName(selected.user_id)}
            deciderName={selected.approved_by ? userById.get(selected.approved_by)?.full_name ?? null : null}
            territoryName={territoryName}
            busy={busy}
            alreadyQueued={queued[selected.id] !== undefined}
            onClose={() => setSelected(null)}
            onDecide={(approve, comment) => decide(selected, approve, comment)}
          />
        )}
      </Modal>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style =
    status === 'approved' ? styles.badgeApproved : status === 'rejected' ? styles.badgeRejected : styles.badgePending;
  const textStyle = status === 'approved' || status === 'rejected' ? styles.badgeTextOnDark : styles.badgeTextPending;
  return (
    <View style={[styles.badge, style]}>
      <Text style={[styles.badgeText, textStyle]}>{statusLabel(status)}</Text>
    </View>
  );
}

type PlanDetailProps = {
  plan: WeeklyPlan;
  officerName: string;
  deciderName: string | null;
  territoryName: (id: string) => string;
  busy: boolean;
  alreadyQueued: boolean;
  onClose: () => void;
  onDecide: (approve: boolean, comment?: string) => void;
};

function PlanDetail({ plan, officerName, deciderName, territoryName, busy, alreadyQueued, onClose, onDecide }: PlanDetailProps) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);

  const activities = useMemo(
    () => [...(plan.activities ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [plan.activities],
  );
  const deviations = plan.deviations ?? [];
  const canDecide = plan.status === 'pending' && !alreadyQueued;

  const confirmReject = () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(true);
      return;
    }
    onDecide(false, trimmed);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.modalHeader}>
        <View style={styles.cardTitleWrap}>
          <Text style={styles.name}>{officerName}</Text>
          <Text style={styles.meta}>{formatWeek(plan.week_start_date)}</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={onClose}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Close plan"
        >
          <Ionicons name="close" size={24} color={busy ? color.textDisabled : color.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
        <View style={styles.statusRow}>
          <StatusBadge status={plan.status} />
          {plan.approved_at ? (
            <Text style={styles.meta}>
              {plan.status === 'pending' ? 'Updated' : 'Decided'} {formatInstantIST(plan.approved_at)}
              {deciderName ? ` by ${deciderName}` : ''}
            </Text>
          ) : null}
        </View>

        {plan.manager_comment ? (
          <View style={styles.commentBox}>
            <Text style={styles.commentLabel}>Manager comment</Text>
            <Text style={styles.body}>{plan.manager_comment}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Day by day</Text>
        {activities.length === 0 ? (
          <Text style={styles.meta}>This plan has no activities.</Text>
        ) : (
          activities.map((a) => {
            const villages = a.planned_villages ?? [];
            const dealers = a.planned_dealers ?? [];
            return (
              <View key={a.id} style={styles.activity}>
                <Text style={styles.activityDay}>{formatDay(a.date, false)}</Text>
                <Text style={styles.activityType}>{titleCase(a.activity_type)}</Text>
                <Text style={styles.meta}>Territory: {territoryName(a.territory_id)}</Text>
                <Text style={styles.meta}>Villages: {villages.length > 0 ? villages.join(', ') : 'None'}</Text>
                <Text style={styles.meta}>Dealers: {dealers.length > 0 ? dealers.join(', ') : 'None'}</Text>
                {a.description ? <Text style={styles.notes}>Notes: {a.description}</Text> : null}
              </View>
            );
          })
        )}

        {deviations.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Changes recorded by the officer</Text>
            {deviations.map((d) => (
              <View key={d.id} style={styles.activity}>
                <Text style={styles.activityDay}>{formatDay(d.date, false)}</Text>
                <Text style={styles.activityType}>{d.reason}</Text>
                <Text style={styles.notes}>{d.details}</Text>
              </View>
            ))}
          </>
        )}

        {alreadyQueued && plan.status === 'pending' && (
          <Text style={styles.queuedNote}>Your decision is saved on this phone and waiting to be sent.</Text>
        )}

        {canDecide && rejecting && (
          <View style={styles.rejectBox}>
            <Text style={styles.commentLabel}>Why are you rejecting this plan?</Text>
            <Text style={styles.meta}>The officer will see this note, so say what to change.</Text>
            <TextInput
              style={[styles.input, reasonError && styles.inputError]}
              value={reason}
              onChangeText={(t) => { setReason(t); if (reasonError) setReasonError(false); }}
              placeholder="Write the reason or the changes you want"
              placeholderTextColor={color.textMuted}
              multiline
              maxLength={500}
              editable={!busy}
              accessibilityLabel="Reason for rejecting this plan"
            />
            {reasonError && <Text style={styles.errorText}>Please write a reason before rejecting.</Text>}
          </View>
        )}
      </ScrollView>

      {canDecide && (
        <View style={styles.footer}>
          {rejecting ? (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={() => { setRejecting(false); setReasonError(false); }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Go back without rejecting"
              >
                <Text style={styles.cancelText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn, busy && styles.btnBusy]}
                onPress={confirmReject}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Confirm reject"
                accessibilityState={{ disabled: busy, busy }}
              >
                {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Confirm reject</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn, busy && styles.btnBusy]}
                onPress={() => setRejecting(true)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Reject this plan"
              >
                <Ionicons name="close-circle-outline" size={20} color={color.white} />
                <Text style={styles.actionText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.approveBtn, busy && styles.btnBusy]}
                onPress={() => onDecide(true)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Approve this plan"
                accessibilityState={{ disabled: busy, busy }}
              >
                {busy ? (
                  <ActivityIndicator color={color.white} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={20} color={color.white} />
                    <Text style={styles.actionText}>Approve</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  tabs: {
    flexDirection: 'row',
    backgroundColor: color.cardBg,
    margin: spacing.lg,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
  },
  tab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary },
  tabTextActive: { color: color.white },
  listContent: { padding: spacing.lg, paddingTop: 0 },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    minHeight: 44,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitleWrap: { flex: 1 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  week: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.sm },
  body: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.xs },
  badge: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1 },
  badgeApproved: { backgroundColor: color.success, borderColor: color.success },
  badgeRejected: { backgroundColor: color.error, borderColor: color.error },
  badgePending: { backgroundColor: color.warningBg, borderColor: color.warningBorder },
  badgeText: { fontSize: font.caption, fontWeight: fontWeight.bold },
  badgeTextOnDark: { color: color.white },
  badgeTextPending: { color: color.warningText },
  queuedNote: { fontSize: font.caption, color: color.warningText, marginTop: spacing.sm },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    backgroundColor: color.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  detailContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  commentBox: {
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  commentLabel: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  sectionTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  activity: {
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  activityDay: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.primary },
  activityType: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary, marginTop: 2 },
  notes: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.sm },
  rejectBox: { marginTop: spacing.xl },
  input: {
    minHeight: 96,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    backgroundColor: color.cardBg,
    fontSize: font.body,
    color: color.textPrimary,
    textAlignVertical: 'top',
  },
  inputError: { borderColor: color.error },
  errorText: { fontSize: font.caption, color: color.error, marginTop: spacing.xs },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: color.cardBg,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  rejectBtn: { backgroundColor: color.error },
  approveBtn: { backgroundColor: color.success },
  cancelBtn: { backgroundColor: color.screenBg, borderWidth: 1, borderColor: color.border },
  btnBusy: { opacity: 0.6 },
  actionText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
  cancelText: { color: color.textPrimary, fontWeight: fontWeight.bold, fontSize: font.body },
});
