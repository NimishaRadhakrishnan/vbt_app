import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, ActivityIndicator, ScrollView } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type SimpleUser = { id: string; full_name: string; role: string };
type HistoryPoint = { lat: number; lng: number; recorded_at: string; speed: number | null; battery_level: number | null };
type Diagnostics = {
  ping_count: number;
  delivery_rate_pct: number | null;
  accuracy_summary?: { avg: number | null };
  low_accuracy_pct: number | null;
  suspect_jumps?: any[];
  error?: string;
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Mobile equivalent of the web dashboard's Movement History / Historical
// Route Replay screen. Same two endpoints: GET /location/history/
// {officer_id}?date=... for the day's raw GPS points, and GET /location/
// diagnostics/{officer_id}?date=... for the "Check Data Quality" panel
// added to the web screen earlier (delivery rate, accuracy, suspect
// jumps). No visual route line on a map here - see AdminLiveMapScreen.tsx
// for why (no Google Maps API key provisioned for Android yet) - this
// shows the same underlying ping list and diagnostics as a timeline
// instead, which is the information an admin actually needs to answer
// "did this officer's tracking work today", not just a pretty line.
export default function AdminLocationHistoryScreen() {
  const [officerId, setOfficerId] = useState<string | null>(null);
  const [date, setDate] = useState(todayStr());
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const { data: officers } = useDataFetch<SimpleUser[]>(
    () => apiClient.request('/users?limit=200', 'GET', 'admin_action'),
    [],
    { refetchOnFocus: false }
  );
  const trackableOfficers = (officers ?? []).filter((u) => u.role === 'field_officer' || u.role === 'sales_officer');

  const { data: points, loading, error, retry } = useDataFetch<HistoryPoint[]>(
    () => (officerId ? apiClient.request(`/location/history/${officerId}?date=${date}`, 'GET', 'admin_action') : Promise.resolve([])),
    [officerId, date]
  );

  const checkDataQuality = async () => {
    if (!officerId) return;
    setDiagnosticsLoading(true);
    setDiagnostics(null);
    try {
      const d: Diagnostics = await apiClient.request(`/location/diagnostics/${officerId}?date=${date}`, 'GET', 'admin_action');
      setDiagnostics(d);
    } catch (err: any) {
      setDiagnostics({ ping_count: 0, delivery_rate_pct: null, low_accuracy_pct: null, error: err?.message ?? 'Failed to run data-quality check' });
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.officerTabs} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        {trackableOfficers.map((o) => (
          <TouchableOpacity
            key={o.id}
            style={[styles.officerChip, officerId === o.id && styles.officerChipActive]}
            onPress={() => { setOfficerId(o.id); setDiagnostics(null); }}
          >
            <Text style={[styles.officerChipText, officerId === o.id && styles.officerChipTextActive]}>{o.full_name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {!officerId ? (
        <EmptyState message="Pick an officer above to see their route history." />
      ) : (
        <>
          <TouchableOpacity style={styles.qualityBtn} disabled={diagnosticsLoading} onPress={checkDataQuality}>
            {diagnosticsLoading ? (
              <ActivityIndicator color={color.white} size="small" />
            ) : (
              <Text style={styles.qualityBtnText}>Check Data Quality</Text>
            )}
          </TouchableOpacity>

          {diagnostics && !diagnostics.error && (
            <View style={styles.diagnosticsCard}>
              <Text style={styles.diagnosticsTitle}>GPS Data Quality — {date}</Text>
              <View style={styles.diagnosticsRow}>
                <DiagStat label="Pings Recorded" value={String(diagnostics.ping_count)} />
                <DiagStat label="Delivery Rate" value={diagnostics.delivery_rate_pct != null ? `${diagnostics.delivery_rate_pct}%` : '—'} />
                <DiagStat label="Accuracy (avg)" value={diagnostics.accuracy_summary?.avg != null ? `${diagnostics.accuracy_summary.avg}m` : '—'} />
                <DiagStat label="Low-Accuracy Pings" value={diagnostics.low_accuracy_pct != null ? `${diagnostics.low_accuracy_pct}%` : '—'} />
              </View>
              {diagnostics.suspect_jumps && diagnostics.suspect_jumps.length > 0 ? (
                <Text style={styles.warningText}>{diagnostics.suspect_jumps.length} suspicious jump(s) found for this day.</Text>
              ) : (
                <Text style={styles.okText}>No suspicious jumps found for this day.</Text>
              )}
            </View>
          )}
          {diagnostics?.error && <Text style={styles.warningText}>{diagnostics.error}</Text>}

          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} onRetry={retry} />
          ) : !points || points.length === 0 ? (
            <EmptyState message="No GPS points recorded for this officer on this day." />
          ) : (
            <FlatList
              data={points}
              keyExtractor={(p, i) => `${p.recorded_at}-${i}`}
              contentContainerStyle={{ padding: spacing.lg }}
              renderItem={({ item }) => (
                <View style={styles.pointRow}>
                  <Text style={styles.pointTime}>{new Date(item.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  <Text style={styles.pointCoords}>{item.lat.toFixed(4)}, {item.lng.toFixed(4)}</Text>
                  {item.speed != null && <Text style={styles.pointMeta}>{Math.round(item.speed)} km/h</Text>}
                </View>
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

function DiagStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.diagStat}>
      <Text style={styles.diagStatValue}>{value}</Text>
      <Text style={styles.diagStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  officerTabs: { maxHeight: 52, marginTop: spacing.md, marginBottom: spacing.sm },
  officerChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    marginRight: spacing.sm,
    justifyContent: 'center',
  },
  officerChipActive: { backgroundColor: color.primary, borderColor: color.primary },
  officerChipText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textPrimary },
  officerChipTextActive: { color: color.white },
  qualityBtn: { margin: spacing.lg, backgroundColor: color.info, paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center' },
  qualityBtnText: { color: color.white, fontWeight: fontWeight.bold },
  diagnosticsCard: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  diagnosticsTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginBottom: spacing.md },
  diagnosticsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  diagStat: { minWidth: 100 },
  diagStatValue: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  diagStatLabel: { fontSize: font.caption, color: color.textSecondary },
  warningText: { color: color.error, fontSize: font.caption, marginTop: spacing.sm, paddingHorizontal: spacing.lg },
  okText: { color: color.success, fontSize: font.caption, marginTop: spacing.sm },
  pointRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: color.cardBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pointTime: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textPrimary },
  pointCoords: { fontSize: font.caption, color: color.textSecondary },
  pointMeta: { fontSize: font.caption, color: color.textSecondary },
});
