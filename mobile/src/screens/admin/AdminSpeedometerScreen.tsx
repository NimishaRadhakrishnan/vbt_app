import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { apiClient } from '../../services/api';
import { LoadingState, ErrorState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Daily speedometer photos + km from every officer (kept 60 days).
type Reading = { id: string; km: number; is_late: boolean; created_at: string; uploaded_by: string };
type Day = {
  date: string; user_id: string; officer_name: string; employee_id?: string;
  check_in: Reading | null; check_out: Reading | null; distance_km: number | null;
};
const RANGES = [{ label: 'Today', days: 0 }, { label: '7 days', days: 6 }, { label: '30 days', days: 29 }, { label: '60 days', days: 59 }];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (s: string) => new Date(s).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export default function AdminSpeedometerScreen() {
  const [days, setDays] = useState(6);
  const [rows, setRows] = useState<Day[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const range = () => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    return `date_from=${iso(from)}&date_to=${iso(to)}`;
  };

  const load = useCallback(async () => {
    try {
      setRows((await apiClient.request(`/odometer?${range()}`, 'GET', 'admin_action', undefined, { queue: false })) || []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load speedometer photos.');
    }
  }, [days]);

  useEffect(() => { setRows(null); load(); }, [load]);

  const open = (id: string, download = false) =>
    Linking.openURL(apiClient.mediaUrl(`/odometer/${id}/photo${download ? '?download=1' : ''}`));

  const cell = (label: string, r: Reading | null) => (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      {r ? (
        <>
          <TouchableOpacity onPress={() => open(r.id)}>
            <Image source={{ uri: apiClient.mediaUrl(`/odometer/${r.id}/photo`) }} style={styles.thumb} />
          </TouchableOpacity>
          <Text style={styles.km}>{r.km} km</Text>
          <Text style={styles.meta}>{time(r.created_at)}{r.is_late ? ' · after 6 PM' : ''}</Text>
          <TouchableOpacity onPress={() => open(r.id, true)}><Text style={styles.link}>Download</Text></TouchableOpacity>
        </>
      ) : <Text style={styles.missing}>Not submitted</Text>}
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.screenBg }}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <View style={styles.chips}>
        {RANGES.map((r) => (
          <TouchableOpacity key={r.label} style={[styles.chip, days === r.days && styles.chipOn]} onPress={() => setDays(r.days)}>
            <Text style={[styles.chipText, days === r.days && { color: color.white }]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity style={styles.zip} onPress={() => Linking.openURL(apiClient.mediaUrl(`/odometer/download/all.zip?${range()}`))}>
        <Text style={styles.zipText}>Download all photos (ZIP + CSV)</Text>
      </TouchableOpacity>
      {error ? <ErrorState message={error} onRetry={load} /> : rows === null ? <LoadingState /> : rows.length === 0 ? (
        <Text style={styles.empty}>No speedometer photos in this period.</Text>
      ) : rows.map((d) => (
        <View key={d.date + d.user_id} style={styles.card}>
          <Text style={styles.name}>{d.officer_name}{d.employee_id ? ` (${d.employee_id})` : ''}</Text>
          <Text style={styles.meta}>
            {d.date}{d.distance_km !== null ? `  ·  ${d.distance_km} km travelled` : ''}
          </Text>
          <View style={styles.pair}>{cell('Start of day', d.check_in)}{cell('End of day', d.check_out)}</View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: 8, marginBottom: spacing.md, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: color.border, backgroundColor: color.white },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: font.body, color: color.textPrimary, fontWeight: fontWeight.bold },
  zip: { borderWidth: 1, borderColor: color.primary, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.lg },
  zipText: { color: color.primary, fontWeight: fontWeight.bold, fontSize: font.body },
  empty: { textAlign: 'center', color: color.textSecondary, marginTop: 40 },
  card: { backgroundColor: color.white, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: color.border, marginBottom: spacing.md },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: 12, color: color.textSecondary, marginTop: 2 },
  pair: { flexDirection: 'row', gap: 12, marginTop: spacing.md },
  cell: { flex: 1 },
  cellLabel: { fontSize: 12, fontWeight: fontWeight.bold, color: color.textSecondary, marginBottom: 4 },
  thumb: { width: '100%', height: 110, borderRadius: radius.md, backgroundColor: '#eee' },
  km: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary, marginTop: 4 },
  link: { color: color.primary, fontSize: 12, fontWeight: fontWeight.bold, marginTop: 2 },
  missing: { color: color.error, fontSize: font.body, marginTop: 8 },
});
