import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { asList } from '../../utils/lists';
import { useDataFetch, CONNECTION_ERROR_MESSAGE } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { analyzeDay, buildJourney, fmtClock, fmtDuration, trackingWindow, JourneyItem, RawPoint } from '../../utils/routeAnalysis';
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

// Route history for one officer and one day, shown like "where is my train":
// each place the officer stopped at, by name, with arrival and departure times
// and the distance travelled in between. Same rules as the web page. History
// is kept for 90 days, so the date picker stops there.
const KEEP_DAYS = 90;

// Same rounding the server uses for its place-name cache (about 11 m).
const placeKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;
const coords = (lat: number, lng: number) => `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

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

  const journey = useMemo(() => buildJourney(summary), [summary]);

  // Names for the places, looked up (and cached) by the server. Until they
  // arrive, or if they cannot be found, the coordinates are shown.
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    const wanted = new Map<string, { lat: number; lng: number }>();
    journey.forEach((j) => {
      if (j.kind === 'place') wanted.set(placeKey(j.lat, j.lng), { lat: j.lat, lng: j.lng });
    });
    const entries = [...wanted.entries()].slice(0, 60);
    if (entries.length === 0) return;
    let cancelled = false;
    apiClient
      .request('/location/place-names', 'POST', 'admin_action', { points: entries.map(([, p]) => p) }, { queue: false })
      .then((res: any) => {
        if (cancelled) return;
        const found: Record<string, string> = {};
        (res?.names ?? []).forEach((n: string | null, i: number) => {
          if (n) found[entries[i]![0]] = n;
        });
        setNames((prev) => ({ ...prev, ...found }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [journey]);

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

          <Text style={styles.sectionTitle}>Places visited</Text>
          {journey.map((item, i) => (
            <JourneyRow key={item.key} item={item} names={names} isLast={i === journey.length - 1} />
          ))}

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
              {summary.badFixes > 0 && <Text style={styles.muted}>{summary.badFixes} poor fixes were left out of the places above.</Text>}
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

function JourneyRow({ item, names, isLast }: { item: JourneyItem; names: Record<string, string>; isLast: boolean }) {
  if (item.kind === 'place') {
    const title = names[placeKey(item.lat, item.lng)] ?? coords(item.lat, item.lng);
    // The day is shown as 9:00 AM to 6:00 PM; 6:00 PM only once the day is over.
    const win = trackingWindow(item.arrive);
    const lateStart = item.arrive - win.start >= 60_000;
    const dayOver = Date.now() >= win.end;
    const earlyEnd = win.end - item.arrive >= 60_000;
    const sub =
      item.role === 'start' ? (lateStart ? `Day started · first location at ${fmtClock(item.arrive)}` : 'Day started: first location recorded')
      : item.role === 'end' ? (dayOver ? (earlyEnd ? `Day ended · last location at ${fmtClock(item.arrive)}` : 'Day ended: last location recorded') : 'Last location recorded')
      : `Stayed ${fmtDuration(item.minutes)}`;
    const shownTime = item.role === 'start' ? win.start : item.role === 'end' && dayOver ? win.end : item.arrive;
    return (
      <View style={styles.trainRow}>
        <Text style={styles.trainTimeLeft}>{fmtClock(shownTime)}</Text>
        <View style={styles.rail}>
          <View style={[styles.railLine, styles.railLineTop, item.role === 'start' && styles.railHidden]} />
          <View style={[
            styles.node,
            item.role === 'start' && { backgroundColor: color.success },
            item.role === 'end' && { backgroundColor: color.error },
          ]}>
            {item.number != null && <Text style={styles.nodeText}>{item.number}</Text>}
          </View>
          <View style={[styles.railLine, styles.railLineBottom, isLast && styles.railHidden]} />
        </View>
        <View style={styles.trainBody}>
          <Text style={styles.placeName}>{title}</Text>
          <Text style={styles.placeSub}>{sub}</Text>
          <TouchableOpacity
            onPress={() => { Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`).catch(() => {}); }}
            accessibilityRole="button"
            accessibilityLabel="Open this place in Google Maps"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.mapLink}>Open in Maps</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.trainTimeRight}>{item.depart != null && item.role === 'stop' ? fmtClock(item.depart) : ''}</Text>
      </View>
    );
  }

  const isGap = item.kind === 'gap';
  return (
    <View style={styles.trainRow}>
      <View style={styles.timeSpacer} />
      <View style={styles.rail}>
        <View style={[styles.connector, isGap ? styles.connectorGap : styles.connectorTravel]} />
      </View>
      <View style={[styles.trainBody, styles.connectorBody]}>
        <Text style={styles.connectorTitle}>
          {isGap ? `No signal for ${fmtDuration(item.minutes)}` : `${item.km} km · ${fmtDuration(Math.max(1, Math.round((item.to - item.from) / 60_000)))}`}
        </Text>
        <Text style={styles.placeSub}>
          {isGap ? `${fmtClock(item.from)} to ${fmtClock(item.to)} · position unknown` : `Travelling, ${fmtClock(item.from)} to ${fmtClock(item.to)}`}
        </Text>
      </View>
      <View style={styles.timeSpacer} />
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
  trainRow: { flexDirection: 'row', alignItems: 'stretch' },
  trainTimeLeft: { width: 62, textAlign: 'right', fontSize: font.caption, fontWeight: fontWeight.bold, color: color.textPrimary, paddingTop: 2 },
  trainTimeRight: { width: 62, fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, paddingTop: 2, paddingLeft: spacing.sm },
  timeSpacer: { width: 62 },
  rail: { width: 36, alignItems: 'center' },
  railLine: { width: 4, flex: 1, backgroundColor: color.info, opacity: 0.35 },
  railLineTop: { minHeight: 6 },
  railLineBottom: { minHeight: 6 },
  railHidden: { opacity: 0 },
  node: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.textPrimary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: color.cardBg },
  nodeText: { color: color.white, fontSize: 11, fontWeight: fontWeight.bold },
  trainBody: { flex: 1, paddingVertical: spacing.sm },
  placeName: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary },
  placeSub: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  mapLink: { fontSize: font.caption, color: color.primary, fontWeight: fontWeight.semibold, marginTop: spacing.xs },
  connector: { width: 4, flex: 1, minHeight: 44 },
  connectorTravel: { backgroundColor: color.info, opacity: 0.55 },
  connectorGap: { backgroundColor: color.border },
  connectorBody: { justifyContent: 'center' },
  connectorTitle: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textPrimary },
  sectionTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  muted: { fontSize: font.caption, color: color.textSecondary, marginTop: spacing.sm },
  rowText: { flex: 1, fontSize: font.caption, color: color.textPrimary },
  qualityBtn: { marginTop: spacing.xl, backgroundColor: color.info, minHeight: 44, justifyContent: 'center', borderRadius: radius.sm, alignItems: 'center' },
  qualityBtnText: { color: color.white, fontWeight: fontWeight.bold },
  diag: { marginTop: spacing.md, gap: spacing.xs },
  good: { color: color.success, fontSize: font.caption },
  bad: { color: color.error, fontSize: font.caption, marginTop: spacing.sm },
});
