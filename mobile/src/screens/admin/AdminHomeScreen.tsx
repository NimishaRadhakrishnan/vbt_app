import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState } from '../../components/FetchStates';
import { asList } from '../../utils/lists';
import { fmtClock, parseTime } from '../../utils/routeAnalysis';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type RosterRow = {
  officer_id: string;
  full_name: string;
  role: string;
  checked_in: boolean;
  check_in_time: string | null;
  is_late: boolean;
  checked_out: boolean;
};

type TeamMomentum = {
  percent_hit_target: number;
  team_badges_this_month: number;
  personal_bests_this_week: number;
};

type AlertRow = { id: string; type: string; ended_at: string | null };

type Business = {
  answers?: Record<string, string>;
  needs_attention?: { name: string; officer_id: string; reason: string }[];
};

type Overview = {
  roster: RosterRow[];
  momentum: TeamMomentum | null;
  alerts: AlertRow[];
};

const ROLE_LABEL: Record<string, string> = { field_officer: 'Field officer', sales_officer: 'Sales officer' };

const todayLabel = () =>
  new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

function status(r: RosterRow): { text: string; tone: 'ok' | 'late' | 'none' | 'done' } {
  if (r.checked_out) return { text: 'Checked out', tone: 'done' };
  if (r.checked_in) {
    const at = r.check_in_time ? fmtClock(parseTime(r.check_in_time)) : '';
    return { text: r.is_late ? `Late, in at ${at}` : `In at ${at}`, tone: r.is_late ? 'late' : 'ok' };
  }
  return { text: 'Not in yet', tone: 'none' };
}

// The admin and manager home page: who is working today, open alerts, and how
// the month is going. Everything here is for oversight roles; none of it is
// an officer's own targets.
export default function AdminHomeScreen({ navigation }: any) {
  const user = apiClient.getCurrentUser();

  const { data, loading, refreshing, error, retry, refresh } = useDataFetch<Overview>(async () => {
    // The roster is the one thing this page cannot do without. The other two
    // are extras: if either fails, that card is simply left out.
    const roster = asList<RosterRow>(await apiClient.request('/attendance/roster-status', 'GET', 'admin_action'));
    const [momentum, alerts] = await Promise.all([
      apiClient.request('/momentum/team', 'GET', 'admin_action').catch(() => null),
      apiClient.request('/location/alerts', 'GET', 'admin_action').catch(() => []),
    ]);
    return { roster, momentum, alerts: asList<AlertRow>(alerts) };
  }, []);

  // The month's sales summary is slow to compute, so it loads on its own and
  // never holds the rest of the page back.
  const [business, setBusiness] = React.useState<Business | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    apiClient
      .request('/management/dashboard', 'GET', 'admin_action')
      .then((res) => {
        if (!cancelled) setBusiness(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const goTeam = (tabId: string) =>
    navigation.navigate('MoreTab', { screen: 'Section', params: { sectionId: 'team', tabId } });

  if (loading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error ?? "Couldn't load today's overview."} onRetry={retry} />;

  const { roster, momentum, alerts } = data;
  const total = roster.length;
  const checkedIn = roster.filter((r) => r.checked_in && !r.checked_out).length;
  const late = roster.filter((r) => r.checked_in && r.is_late).length;
  const notIn = roster.filter((r) => !r.checked_in).length;
  const checkedOut = roster.filter((r) => r.checked_out).length;
  const openAlerts = alerts.filter((a) => a.type !== 'territory_exit' || !a.ended_at).length;

  // People who still need to start their day come first.
  const order = { none: 0, late: 1, ok: 2, done: 3 } as const;
  const rows = [...roster].sort((a, b) => order[status(a).tone] - order[status(b).tone] || a.full_name.localeCompare(b.full_name));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Text style={styles.hello}>{user?.fullName ?? 'Welcome'}</Text>
      <Text style={styles.date}>{todayLabel()}</Text>

      <View style={styles.tiles}>
        <Tile label="Working now" value={checkedIn} sub={`of ${total}`} tint={color.success} />
        <Tile label="Not in yet" value={notIn} tint={notIn > 0 ? color.warning : color.textMuted} />
        <Tile label="Late" value={late} tint={late > 0 ? color.error : color.textMuted} />
        <Tile label="Checked out" value={checkedOut} tint={color.textMuted} />
      </View>

      <TouchableOpacity style={[styles.alertCard, openAlerts > 0 && styles.alertCardOpen]} onPress={() => goTeam('alerts')} activeOpacity={0.8}>
        <Ionicons
          name={openAlerts > 0 ? 'alert-circle' : 'checkmark-circle'}
          size={26}
          color={openAlerts > 0 ? color.error : color.success}
        />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.alertTitle}>
            {openAlerts > 0 ? `${openAlerts} location alert${openAlerts === 1 ? '' : 's'} need attention` : 'No location alerts today'}
          </Text>
          <Text style={styles.alertSub}>
            {openAlerts > 0 ? 'Left territory, tracking gaps or tracking not started' : 'Everyone is tracking inside their territory'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={color.textMuted} />
      </TouchableOpacity>

      {!!business?.answers?.how_much_did_we_sell && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>This month</Text>
          <Text style={styles.bigNumber}>{business.answers.how_much_did_we_sell}</Text>
          {!!business.answers.is_it_increasing && <Text style={styles.note}>{business.answers.is_it_increasing}</Text>}
          {!!business.answers.who_sells_most && (
            <Text style={styles.line}>
              <Text style={styles.lineLabel}>Top seller: </Text>
              {business.answers.who_sells_most}
            </Text>
          )}
          {!!momentum && (
            <Text style={styles.line}>
              <Text style={styles.lineLabel}>Officers on target: </Text>
              {Math.round(momentum.percent_hit_target)}%
            </Text>
          )}
        </View>
      )}

      {!!business?.needs_attention?.length && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Needs attention</Text>
          {business.needs_attention.slice(0, 5).map((o) => (
            <View key={o.officer_id} style={styles.attentionRow}>
              <Text style={styles.attentionName}>{o.name}</Text>
              <Text style={styles.attentionReason}>{o.reason}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.sectionHeading}>Team today</Text>
      {rows.length === 0 ? (
        <Text style={styles.note}>No field or sales officers are set up yet.</Text>
      ) : (
        rows.map((r) => {
          const st = status(r);
          return (
            <View key={r.officer_id} style={styles.personRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.personName}>{r.full_name}</Text>
                <Text style={styles.personRole}>{ROLE_LABEL[r.role] ?? r.role}</Text>
              </View>
              <Text style={[styles.pill, styles[`pill_${st.tone}` as const]]}>{st.text}</Text>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function Tile({ label, value, sub, tint }: { label: string; value: number; sub?: string; tint: string }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, { color: tint }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {!!sub && <Text style={styles.tileSub}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  hello: { fontSize: font.heading, fontWeight: fontWeight.bold, color: color.textPrimary },
  date: { fontSize: font.caption, color: color.textSecondary, marginTop: 2, marginBottom: spacing.lg },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: {
    width: '48.5%',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  tileValue: { fontSize: 30, fontWeight: fontWeight.bold },
  tileLabel: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  tileSub: { fontSize: font.caption, color: color.textMuted },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  alertCardOpen: { borderColor: color.error, backgroundColor: color.warningBg },
  alertTitle: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary },
  alertSub: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  cardTitle: { fontSize: font.caption, fontWeight: fontWeight.bold, color: color.primary, marginBottom: spacing.sm },
  bigNumber: { fontSize: font.heading, fontWeight: fontWeight.bold, color: color.textPrimary },
  note: { fontSize: font.caption, color: color.textSecondary, marginTop: spacing.xs },
  line: { fontSize: font.caption, color: color.textPrimary, marginTop: spacing.sm },
  lineLabel: { color: color.textSecondary },
  attentionRow: { marginTop: spacing.xs, paddingVertical: spacing.xs },
  attentionName: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  attentionReason: { fontSize: font.caption, color: color.textSecondary },
  sectionHeading: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  personName: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  personRole: { fontSize: font.caption, color: color.textSecondary },
  pill: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  pill_ok: { backgroundColor: '#e8f5e9', color: color.success },
  pill_late: { backgroundColor: color.warningBg, color: color.warningText },
  pill_none: { backgroundColor: '#fdecea', color: color.error },
  pill_done: { backgroundColor: color.borderLight, color: color.textSecondary },
});
