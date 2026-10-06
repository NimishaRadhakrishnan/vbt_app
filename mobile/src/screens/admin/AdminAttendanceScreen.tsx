import React, { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Linking, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../../components/FetchStates';
import { asList } from '../../utils/lists';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Field names match AttendanceResponse (attendance_schemas.py), the
// roster-status dict (attendance_router.py), UserResponse
// (user_management_schemas.py) and LeaveRequestResponse (leave_schemas.py).
type AttendanceRecord = {
  id: string;
  user_id: string;
  date: string;
  check_in_time: string;
  check_in_location_lat: number;
  check_in_location_lng: number;
  check_in_device_id: string;
  check_out_time: string | null;
  check_out_location_lat: number | null;
  check_out_location_lng: number | null;
  is_fake_gps: boolean;
  is_gps_disabled: boolean;
  user_name: string | null;
  user_role: string | null;
  employee_id: string | null;
};

type RosterOfficer = { id: string; name: string; role: string };
type LeaveLite = { officer_id: string; leave_type: string; start_date: string; end_date: string };

type DayData = {
  date: string;
  records: AttendanceRecord[];
  roster: RosterOfficer[];
  leaves: LeaveLite[];
  leaveKnown: boolean;
};

type RowStatus = 'present' | 'checked_out' | 'on_leave' | 'absent';
type Row = {
  key: string;
  name: string;
  role: string;
  status: RowStatus;
  record: AttendanceRecord | null;
  leave: LeaveLite | null;
};

const STATUS_LABEL: Record<RowStatus, string> = {
  present: 'Present',
  checked_out: 'Checked out',
  on_leave: 'On leave',
  absent: 'Absent',
};
const STATUS_RANK: Record<RowStatus, number> = { present: 0, checked_out: 1, on_leave: 2, absent: 3 };
const TRACKED_ROLES = ['field_officer', 'sales_officer'];
const LATE_AFTER_MINUTES = 9 * 60; // 9:00 AM IST, same cut-off as the web roster
const IST_OFFSET_MS = 330 * 60 * 1000;
const RECORD_LIMIT = 100; // the server returns at most this many check-ins per day

function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function addDays(day: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta));
  return t.toISOString().slice(0, 10);
}

function prettyDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// Backend datetimes are timezone-aware; if one ever arrives without an
// offset, treat it as UTC so the phone's own zone does not shift it.
function parseInstant(value: string): Date {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

function fmtTime(value: string | null): string {
  if (!value) return '-';
  const d = parseInstant(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
}

function isLate(value: string): boolean {
  const t = parseInstant(value).getTime();
  if (Number.isNaN(t)) return false;
  const ist = new Date(t + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes() > LATE_AFTER_MINUTES;
}

function titleCase(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

async function loadDay(date: string): Promise<DayData> {
  const isToday = date === istToday();

  // Today's roster comes from the server's own roster view (active field and
  // sales officers). That view has no date option, so any other day uses the
  // active officers from the user list.
  const rosterReq: Promise<RosterOfficer[]> = isToday
    ? apiClient.request('/attendance/roster-status', 'GET', 'admin_action').then((res) =>
        asList<{ officer_id: string; full_name: string; role: string }>(res).map((r) => ({
          id: r.officer_id, name: r.full_name, role: r.role,
        })),
      )
    : apiClient.request('/users?limit=200', 'GET', 'admin_action').then((res) =>
        asList<{ id: string; full_name: string; role: string; is_active: boolean }>(res)
          .filter((u) => u.is_active && TRACKED_ROLES.includes(u.role))
          .map((u) => ({ id: u.id, name: u.full_name, role: u.role })),
      );

  // Leave is extra context; if it cannot be loaded the screen still works and
  // says so.
  const leaveReq: Promise<LeaveLite[] | null> = apiClient
    .request('/leave?status_filter=approved', 'GET', 'admin_action')
    .then((res) => asList<LeaveLite>(res))
    .catch(() => null);

  const [recordsRes, roster, leaves] = await Promise.all([
    apiClient.request(`/attendance?date=${date}`, 'GET', 'admin_action'),
    rosterReq,
    leaveReq,
  ]);

  return {
    date,
    records: asList<AttendanceRecord>(recordsRes),
    roster,
    leaves: leaves ?? [],
    leaveKnown: leaves !== null,
  };
}

function buildRows(data: DayData): Row[] {
  const byUser = new Map<string, AttendanceRecord>();
  data.records.forEach((r) => {
    const existing = byUser.get(r.user_id);
    if (!existing || r.check_in_time < existing.check_in_time) byUser.set(r.user_id, r);
  });

  const leaveFor = (userId: string): LeaveLite | null =>
    data.leaves.find((l) => l.officer_id === userId && l.start_date <= data.date && data.date <= l.end_date) ?? null;

  const rows: Row[] = [];
  const seen = new Set<string>();

  data.roster.forEach((o) => {
    seen.add(o.id);
    const record = byUser.get(o.id) ?? null;
    const leave = leaveFor(o.id);
    const status: RowStatus = record ? (record.check_out_time ? 'checked_out' : 'present') : leave ? 'on_leave' : 'absent';
    rows.push({ key: o.id, name: o.name, role: o.role, status, record, leave });
  });

  // Someone who checked in but is not on the roster (for example a manager)
  // still belongs in the log.
  byUser.forEach((record, userId) => {
    if (seen.has(userId)) return;
    rows.push({
      key: userId,
      name: record.user_name ?? 'Unknown officer',
      role: record.user_role ?? 'field_officer',
      status: record.check_out_time ? 'checked_out' : 'present',
      record,
      leave: null,
    });
  });

  return rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.name.localeCompare(b.name));
}

function hasGpsIssue(r: AttendanceRecord | null): boolean {
  return !!r && (r.is_fake_gps || r.is_gps_disabled);
}

// Attendance log for one day. GET /attendance?date= returns the check-ins
// (admin and manager only); officers with no check-in are shown as Absent, or
// On leave when they have approved leave covering that day.
export default function AdminAttendanceScreen() {
  const [date, setDate] = useState(istToday());
  const [expanded, setExpanded] = useState<string | null>(null);

  const today = istToday();

  // A late answer for a day the user already moved away from is dropped by
  // never resolving, otherwise it would replace the newer one and the screen
  // would spin forever.
  const latestDate = useRef(date);
  latestDate.current = date;

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<DayData>(
    async () => {
      const requested = date;
      const result = await loadDay(requested);
      if (latestDate.current !== requested) return new Promise<DayData>(() => {});
      return result;
    },
    [date],
  );

  // Ignore a response that belongs to a different day (quick prev/next taps).
  const current = data && data.date === date ? data : null;
  const rows = useMemo(() => (current ? buildRows(current) : []), [current]);

  const counts = useMemo(() => {
    const c = { present: 0, checkedOut: 0, onLeave: 0, absent: 0, gps: 0 };
    rows.forEach((r) => {
      if (r.status === 'present' || r.status === 'checked_out') c.present += 1;
      if (r.status === 'checked_out') c.checkedOut += 1;
      if (r.status === 'on_leave') c.onLeave += 1;
      if (r.status === 'absent') c.absent += 1;
      if (hasGpsIssue(r.record)) c.gps += 1;
    });
    return c;
  }, [rows]);

  const move = (delta: number) => {
    setDate((d) => {
      const next = addDays(d, delta);
      return next > istToday() ? d : next;
    });
    setExpanded(null);
  };

  const openMap = (lat: number, lng: number) => {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`).catch(() => {
      Alert.alert('Could not open Maps', 'Please check that a maps app is installed.');
    });
  };

  let body: React.ReactNode;
  if (!current) {
    body = error ? (
      <ErrorState message={error} onRetry={retry} />
    ) : isStale && !loading ? (
      <ErrorState message="Couldn't load attendance. Tap to try again." onRetry={retry} />
    ) : (
      <LoadingState />
    );
  } else if (rows.length === 0) {
    body = <EmptyState message="No attendance found for this day." actionHint="No check-ins were recorded and no officers are listed." />;
  } else {
    body = (
      <FlatList
        data={rows}
        extraData={expanded}
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          <View>
            {isStale ? <StaleDataBanner onRetry={retry} /> : null}
            <View style={styles.cards}>
              <Stat label="Present" value={counts.present} />
              <Stat label="Checked out" value={counts.checkedOut} />
              <Stat label="On leave" value={counts.onLeave} />
              <Stat label="Absent" value={counts.absent} />
              <Stat label="GPS issues" value={counts.gps} alert={counts.gps > 0} />
            </View>
            {!current.leaveKnown && (
              <Text style={styles.note}>Leave details could not be loaded, so some people marked Absent may be on leave.</Text>
            )}
            {current.records.length >= RECORD_LIMIT && (
              <Text style={styles.note}>Showing the first {RECORD_LIMIT} check-ins for this day.</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <OfficerRow
            row={item}
            open={expanded === item.key}
            onToggle={() => setExpanded((e) => (e === item.key ? null : item.key))}
            onOpenMap={openMap}
          />
        )}
      />
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.dateRow}>
        <TouchableOpacity style={styles.dateBtn} onPress={() => move(-1)} accessibilityRole="button" accessibilityLabel="Previous day">
          <Ionicons name="chevron-back" size={20} color={color.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dateTextBtn}
          onPress={() => { setDate(today); setExpanded(null); }}
          accessibilityRole="button"
          accessibilityLabel={`Showing ${prettyDay(date)}. Go to today`}
        >
          <Text style={styles.dateText}>{prettyDay(date)}{date === today ? ' (today)' : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dateBtn}
          disabled={date >= today}
          onPress={() => move(1)}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: date >= today }}
        >
          <Ionicons name="chevron-forward" size={20} color={date >= today ? color.textDisabled : color.primary} />
        </TouchableOpacity>
      </View>
      {body}
    </View>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, alert && styles.statAlert]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StatusChip({ status }: { status: RowStatus }) {
  const bg =
    status === 'present' ? styles.chipPresent
    : status === 'checked_out' ? styles.chipOut
    : status === 'on_leave' ? styles.chipLeave
    : styles.chipAbsent;
  return (
    <View style={[styles.chip, bg]}>
      <Text style={[styles.chipText, status === 'on_leave' && styles.chipTextLeave]}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

type OfficerRowProps = {
  row: Row;
  open: boolean;
  onToggle: () => void;
  onOpenMap: (lat: number, lng: number) => void;
};

function OfficerRow({ row, open, onToggle, onOpenMap }: OfficerRowProps) {
  const r = row.record;
  const flagged = hasGpsIssue(r);
  const summary = r
    ? `Check-in ${fmtTime(r.check_in_time)}, check-out ${fmtTime(r.check_out_time)}`
    : 'No check-in';

  return (
    <View style={[styles.card, flagged && styles.cardFlagged]}>
      <TouchableOpacity
        style={styles.cardHead}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${row.name}, ${STATUS_LABEL[row.status]}. ${summary}${flagged ? '. GPS problem' : ''}. ${open ? 'Hide' : 'Show'} details`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.headMain}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{row.name}</Text>
            <StatusChip status={row.status} />
          </View>
          <View style={styles.timesRow}>
            <Text style={styles.meta}>In: {r ? fmtTime(r.check_in_time) : '-'}</Text>
            <Text style={styles.meta}>Out: {r ? fmtTime(r.check_out_time) : '-'}</Text>
          </View>
          {r && r.is_fake_gps && (
            <View style={styles.flagRow}>
              <Ionicons name="warning-outline" size={16} color={color.error} />
              <Text style={styles.flagText}>Fake GPS detected</Text>
            </View>
          )}
          {r && r.is_gps_disabled && (
            <View style={styles.flagRow}>
              <Ionicons name="warning-outline" size={16} color={color.error} />
              <Text style={styles.flagText}>GPS was off at check-in</Text>
            </View>
          )}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={color.textMuted} />
      </TouchableOpacity>

      {open && (
        <View style={styles.details}>
          <Detail label="Role" value={titleCase(row.role)} />
          {r?.employee_id ? <Detail label="Employee ID" value={r.employee_id} /> : null}
          {r ? (
            <>
              <Detail
                label="Checked in"
                value={`${fmtTime(r.check_in_time)}${isLate(r.check_in_time) ? ' (after 9:00 AM)' : ''}`}
              />
              <Detail label="Checked out" value={r.check_out_time ? fmtTime(r.check_out_time) : 'Not yet'} />
              <Detail label="Phone ID" value={r.check_in_device_id || '-'} />
              <Detail
                label="GPS check"
                value={
                  r.is_fake_gps && r.is_gps_disabled ? 'Fake GPS detected and GPS was off'
                  : r.is_fake_gps ? 'Fake GPS detected'
                  : r.is_gps_disabled ? 'GPS was off at check-in'
                  : 'No problem found'
                }
                bad={flagged}
              />
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => onOpenMap(r.check_in_location_lat, r.check_in_location_lng)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${row.name}'s check-in location in Maps`}
              >
                <Ionicons name="location-outline" size={18} color={color.primary} />
                <Text style={styles.linkText}>Check-in location</Text>
              </TouchableOpacity>
              {r.check_out_location_lat != null && r.check_out_location_lng != null && (
                <TouchableOpacity
                  style={styles.linkBtn}
                  onPress={() => onOpenMap(r.check_out_location_lat as number, r.check_out_location_lng as number)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${row.name}'s check-out location in Maps`}
                >
                  <Ionicons name="location-outline" size={18} color={color.primary} />
                  <Text style={styles.linkText}>Check-out location</Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text style={styles.meta}>No check-in was recorded for this day.</Text>
          )}
          {row.leave && (
            <Detail
              label="Leave"
              value={`${titleCase(row.leave.leave_type)} leave, ${shortDay(row.leave.start_date)} to ${shortDay(row.leave.end_date)}`}
            />
          )}
        </View>
      )}
    </View>
  );
}

function Detail({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, bad && styles.detailBad]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dateBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dateTextBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dateText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  listContent: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  stat: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statValue: { fontSize: font.title, fontWeight: fontWeight.bold, color: color.textPrimary },
  statAlert: { color: color.error },
  statLabel: { fontSize: font.caption, color: color.textSecondary },
  note: { fontSize: font.caption, color: color.textSecondary, marginBottom: spacing.md },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  cardFlagged: { borderColor: color.error },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, minHeight: 44 },
  headMain: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  name: { flex: 1, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  timesRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.xs },
  meta: { fontSize: font.caption, color: color.textSecondary },
  flagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  flagText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.error },
  chip: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1 },
  chipPresent: { backgroundColor: color.success, borderColor: color.success },
  chipOut: { backgroundColor: color.info, borderColor: color.info },
  chipLeave: { backgroundColor: color.warningBg, borderColor: color.warningBorder },
  chipAbsent: { backgroundColor: color.error, borderColor: color.error },
  chipText: { fontSize: font.caption, fontWeight: fontWeight.bold, color: color.white },
  chipTextLeave: { color: color.warningText },
  details: {
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  detailRow: { flexDirection: 'row', gap: spacing.md },
  detailLabel: { width: 96, fontSize: font.caption, color: color.textSecondary },
  detailValue: { flex: 1, fontSize: font.caption, color: color.textPrimary },
  detailBad: { color: color.error, fontWeight: fontWeight.semibold },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  linkText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.primary },
});
