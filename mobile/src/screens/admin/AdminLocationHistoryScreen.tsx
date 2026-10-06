import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { asList } from '../../utils/lists';
import { useDataFetch, CONNECTION_ERROR_MESSAGE } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import RouteSketch from '../../components/RouteSketch';
import { analyzeDay, fmtClock, fmtDuration, RawPoint } from '../../utils/routeAnalysis';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type SimpleUser = { id: string; full_name: string; role: string };
type Diagnostics = {
  ping_count: number;
  delivery_rate_pct: number | null;
  accuracy?: { avg: number | null };
  low_accuracy_pct: number | null;
  suspect_jumps?: unknown[];
  error?: string;
};

function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return t.toISOString().slice(0, 10);
}

function prettyDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// Route history for one officer and one day, same rules as the web Route
// Replay: distance, time moving, stops, gaps with no signal, and a drawing of
// the path. History is kept for 90 days, so the date picker stops there.
const KEEP_DAYS = 90;

export default function AdminLocationHistoryScreen() {
  const [officerId, setOfficerId] = useState<string | null>(null);
  const [date, setDate] = useState(istToday());
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const today = istToday();
  const oldest = addDays(today, -KEEP_DAYS);

  const { data: officers } = useDataFetch<SimpleUser[]>(
    async () => asList<SimpleUser>(await apiClient.request('/users?limit=200', 'GET', 'admin_action')),
    [],
    { refetchOnFocus: false },
  );
  const trackable = (officers ?? []).filter((u) => u.role === 'field_officer' || u.role === 'sales_officer');

  // The result is tagged with the officer and day it was fetched for, so a
  // slow answer for a previous pick, or data left over after a failed
  // refetch, is never drawn as the current officer's route.
  const key = `${officerId ?? ''}|${date}`;
  const { data: result, loading, error, isStale, retry } = useDataFetch<{ key: string; points: RawPoint[] }>(
    async () => ({
      key,
      points: officerId ? asList<RawPoint>(await apiClient.request(`/location/history/${officerId}?date=${date}`, 'GET', 'admin_action')) : [],
    }),
    [officerId, date],
  );
  const raw = result && result.key === key ? result.points : null;

  const summary = useMemo(() => analyzeDay(raw ?? []), [raw]);

  // Timeline: stops and gaps in time order.
  const timeline = useMemo(() => {
    const items: { key: string; at: number; kind: 'stop' | 'gap'; text: string; lat?: number; lng?: number }[] = [];
    summary.stops.forEach((s, i) =>
      items.push({
        key: `s${i}`, at: s.start, kind: 'stop', lat: s.lat, lng: s.lng,
        text: `Stopped ${fmtClock(s.start)} to ${fmtClock(s.end)} (${fmtDuration(s.minutes)})`,
      }),
    );
    summary.gaps.forEach((g, i) =>
      items.push({
        key: `g${i}`, at: g.start, kind: 'gap',
        text: `No signal ${fmtClock(g.start)} to ${fmtClock(g.end)} (${fmtDuration(g.minutes)})`,
      }),
    );
    return items.sort((a, b) => a.at - b.at);
  }, [summary]);

  // Bumped whenever the officer or day changes, so a quality check still in
  // flight for the old selection cannot land on the new one.
  const diagToken = useRef(0);
  const resetDiagnostics = () => {
    diagToken.current += 1;
    setDiagnostics(null);
    setDiagnosticsLoading(false);
  };
  const pick = (id: string) => { setOfficerId(id); resetDiagnostics(); };
  const move = (delta: number) => { setDate((d) => addDays(d, delta)); resetDiagnostics(); };

  const checkDataQuality = async () => {
    if (!officerId || diagnosticsLoading) return;
    const token = ++diagToken.current;
    setDiagnosticsLoading(true);
    setDiagnostics(null);
    try {
      const res = await apiClient.request(`/location/diagnostics/${officerId}?date=${date}`, 'GET', 'admin_action');
      if (token === diagToken.current) setDiagnostics(res);
    } catch (err: any) {
      if (token === diagToken.current) {
        setDiagnostics({ ping_count: 0, delivery_rate_pct: null, low_accuracy_pct: null, error: err?.message ?? 'Could not run the check' });
      }
    } finally {
      if (token === diagToken.current) setDiagnosticsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.officerTabs} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        {trackable.map((o) => (
          <TouchableOpacity
            key={o.id}
            style={[styles.officerChip, officerId === o.id && styles.officerChipActive]}
            onPress={() => pick(o.id)}
            accessibilityRole="button"
            accessibilityLabel={o.full_name}
          >
            <Text style={[styles.officerChipText, officerId === o.id && styles.officerChipTextActive]}>{o.full_name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.dateRow}>
        <TouchableOpacity style={styles.dateBtn} disabled={date <= oldest} onPress={() => move(-1)} accessibilityRole="button" accessibilityLabel="Previous day">
          <Ionicons name="chevron-back" size={20} color={date <= oldest ? color.textDisabled : color.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setDate(today); resetDiagnostics(); }} accessibilityRole="button" accessibilityLabel="Go to today">
          <Text style={styles.dateText}>{prettyDay(date)}{date === today ? ' (today)' : ''}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateBtn} disabled={date >= today} onPress={() => move(1)} accessibilityRole="button" accessibilityLabel="Next day">
          <Ionicons name="chevron-forward" size={20} color={date >= today ? color.textDisabled : color.primary} />
        </TouchableOpacity>
      </View>

      {!officerId ? (
        <EmptyState message="Pick an officer above to see their route." />
      ) : loading || (raw === null && !isStale && !error) ? (
        <LoadingState />
      ) : error || raw === null ? (
        <ErrorState message={error ?? CONNECTION_ERROR_MESSAGE} onRetry={retry} />
      ) : summary.points.length === 0 ? (
        <EmptyState
          message="No location recorded for this officer on this day."
          actionHint={`History is kept for ${KEEP_DAYS} days.`}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
          <View style={styles.cards}>
            <Stat label="Distance" value={`${summary.distanceKm} km`} />
            <Stat label="Moving" value={fmtDuration(summary.movingMinutes)} />
            <Stat label="Stops" value={String(summary.stops.length)} />
            <Stat label="No signal" value={String(summary.gaps.length)} />
          </View>
          <Text style={styles.range}>
            First location {summary.firstAt != null ? fmtClock(summary.firstAt) : '-'} · Last {summary.lastAt != null ? fmtClock(summary.lastAt) : '-'}
          </Text>

          <RouteSketch points={summary.points} stops={summary.stops} />
          <View style={styles.legend}>
            <Legend colour={color.success} label="Start" />
            <Legend colour={color.warning} label="Stop" />
            <Legend colour={color.error} label="Last seen" />
          </View>

          <Text style={styles.sectionTitle}>Timeline</Text>
          {timeline.length === 0 ? (
            <Text style={styles.muted}>No stops or gaps: the officer kept moving with a steady signal.</Text>
          ) : (
            timeline.map((t) => (
              <View key={t.key} style={styles.row}>
                <Ionicons
                  name={t.kind === 'stop' ? 'pause-circle-outline' : 'cellular-outline'}
                  size={20}
                  color={t.kind === 'stop' ? color.warning : color.error}
                />
                <Text style={styles.rowText}>{t.text}</Text>
                {t.kind === 'stop' && t.lat != null && t.lng != null && (
                  <TouchableOpacity
                    onPress={() => { Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${t.lat},${t.lng}`).catch(() => {}); }}
                    accessibilityRole="button"
                    accessibilityLabel="Open this stop in Google Maps"
                  >
                    <Ionicons name="open-outline" size={20} color={color.primary} />
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}

          <TouchableOpacity style={styles.qualityBtn} disabled={diagnosticsLoading} onPress={checkDataQuality} accessibilityRole="button">
            {diagnosticsLoading ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.qualityBtnText}>Check data quality</Text>}
          </TouchableOpacity>
          {diagnostics && !diagnostics.error && (
            <View style={styles.diag}>
              <Text style={styles.rowText}>
                {diagnostics.ping_count} locations · delivery {diagnostics.delivery_rate_pct != null ? `${diagnostics.delivery_rate_pct}%` : '-'} · avg accuracy{' '}
                {diagnostics.accuracy?.avg != null ? `${diagnostics.accuracy.avg} m` : '-'}
              </Text>
              <Text style={diagnostics.suspect_jumps && diagnostics.suspect_jumps.length > 0 ? styles.bad : styles.good}>
                {diagnostics.suspect_jumps && diagnostics.suspect_jumps.length > 0
                  ? `${diagnostics.suspect_jumps.length} suspicious jump(s) found.`
                  : 'No suspicious jumps found.'}
              </Text>
              {summary.badFixes > 0 && <Text style={styles.muted}>{summary.badFixes} poor fixes were left out of the route above.</Text>}
            </View>
          )}
          {diagnostics?.error && <Text style={styles.bad}>{diagnostics.error}</Text>}
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: colour }]} />
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  officerTabs: { maxHeight: 52, marginTop: spacing.md, marginBottom: spacing.sm },
  officerChip: {
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill,
    backgroundColor: color.cardBg, borderWidth: 1, borderColor: color.border, marginRight: spacing.sm, justifyContent: 'center',
  },
  officerChipActive: { backgroundColor: color.primary, borderColor: color.primary },
  officerChipText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textPrimary },
  officerChipTextActive: { color: color.white },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  dateBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dateText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  stat: { flexGrow: 1, flexBasis: '45%', backgroundColor: color.cardBg, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, padding: spacing.md },
  statValue: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  statLabel: { fontSize: font.caption, color: color.textSecondary },
  range: { fontSize: font.caption, color: color.textSecondary, marginBottom: spacing.md },
  legend: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  sectionTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  muted: { fontSize: font.caption, color: color.textSecondary, marginTop: spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: color.cardBg,
    borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.sm,
  },
  rowText: { flex: 1, fontSize: font.caption, color: color.textPrimary },
  qualityBtn: { marginTop: spacing.xl, backgroundColor: color.info, minHeight: 44, justifyContent: 'center', borderRadius: radius.sm, alignItems: 'center' },
  qualityBtnText: { color: color.white, fontWeight: fontWeight.bold },
  diag: { marginTop: spacing.md, gap: spacing.xs },
  good: { color: color.success, fontSize: font.caption },
  bad: { color: color.error, fontSize: font.caption, marginTop: spacing.sm },
});
