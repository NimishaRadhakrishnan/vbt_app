import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, TextInput } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type VisitListItem = {
  visit_id: string;
  visit_date: string;
  officer_name: string;
  farmer_name?: string | null;
  village?: string | null;
  crop_name?: string | null;
  is_trial: boolean;
  conversion_status?: string | null;
};

// Admin/manager read-only view of every officer's Daily Visit Tracker
// submissions, using the same GET /admin/daily-visits endpoint and filter
// contract the web admin console's "Daily Visit Reports" page already
// uses - see admin_daily_visit_router.py. Mobile keeps the filter set
// deliberately small (search text only) rather than mirroring the web's
// full ~19-filter panel, which doesn't fit a phone screen usefully; the
// web console remains the place for deep filtered exports.
export default function AdminVisitReportsScreen({ navigation }: any) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const { data, loading, error, retry } = useDataFetch<{ total: number; items: VisitListItem[] }>(
    () =>
      apiClient.request(
        `/admin/daily-visits?limit=50${query ? `&q=${encodeURIComponent(query)}` : ''}`,
        'GET',
        'admin_action'
      ),
    [query]
  );

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search farmer, village, crop, officer…"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => setQuery(search.trim())}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchBtn} onPress={() => setQuery(search.trim())}>
          <Text style={styles.searchBtnText}>Go</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState message="No visits match." />
      ) : (
        <FlatList
          data={data.items}
          keyExtractor={(v) => v.visit_id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('AdminVisitDetail', { visitId: item.visit_id })}
            >
              <Text style={styles.name}>{item.farmer_name ?? 'Unnamed farmer'}</Text>
              <Text style={styles.meta}>
                {item.officer_name} · {item.visit_date}{item.village ? ` · ${item.village}` : ''}
              </Text>
              {!!item.crop_name && <Text style={styles.meta}>{item.crop_name}{item.is_trial ? ' · Trial' : ''}</Text>}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  searchRow: { flexDirection: 'row', padding: spacing.lg },
  searchInput: {
    flex: 1,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    marginRight: spacing.sm,
  },
  searchBtn: { backgroundColor: color.primary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  searchBtnText: { color: color.white, fontWeight: fontWeight.bold },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
});
