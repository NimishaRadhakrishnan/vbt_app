import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type MissingOfficer = { officer_id: string; officer_name: string; role: string };
type ClosureRow = {
  id: string;
  officer_name: string;
  date: string;
  farmer_name?: string | null;
  village?: string | null;
  crop_name?: string | null;
};

const TABS = ['missing', 'recent'] as const;
type TabKey = typeof TABS[number];

// Mirrors the web admin's Day Closure oversight: GET /day-closure/missing-
// today (who hasn't closed yet) and GET /day-closure (recent closures,
// already-submitted). Both are real admin/manager-only endpoints that
// existed before this fix but had no mobile screen reaching them.
export default function AdminDayClosureScreen() {
  const [tab, setTab] = useState<TabKey>('missing');

  const missing = useDataFetch<MissingOfficer[]>(
    () => apiClient.request('/day-closure/missing-today', 'GET', 'admin_action'),
    []
  );
  const recent = useDataFetch<ClosureRow[]>(
    () => apiClient.request('/day-closure', 'GET', 'admin_action'),
    []
  );

  const active = tab === 'missing' ? missing : recent;

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'missing' && styles.tabActive]} onPress={() => setTab('missing')}>
          <Text style={[styles.tabText, tab === 'missing' && styles.tabTextActive]}>Missing Today</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'recent' && styles.tabActive]} onPress={() => setTab('recent')}>
          <Text style={[styles.tabText, tab === 'recent' && styles.tabTextActive]}>Recent Closures</Text>
        </TouchableOpacity>
      </View>

      {active.loading ? (
        <LoadingState />
      ) : active.error ? (
        <ErrorState message={active.error} onRetry={active.retry} />
      ) : tab === 'missing' ? (
        !missing.data || missing.data.length === 0 ? (
          <EmptyState message="Everyone has submitted today's closure." />
        ) : (
          <FlatList
            data={missing.data}
            keyExtractor={(o) => o.officer_id}
            contentContainerStyle={{ padding: spacing.lg }}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.name}>{item.officer_name}</Text>
                <Text style={styles.meta}>{item.role.replace('_', ' ')} · no closure submitted yet</Text>
              </View>
            )}
          />
        )
      ) : !recent.data || recent.data.length === 0 ? (
        <EmptyState message="No day closures recorded yet." />
      ) : (
        <FlatList
          data={recent.data}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.name}>{item.officer_name}</Text>
              <Text style={styles.meta}>
                {item.date}{item.farmer_name ? ` · ${item.farmer_name}` : ''}{item.village ? ` (${item.village})` : ''}
              </Text>
              {!!item.crop_name && <Text style={styles.meta}>{item.crop_name}</Text>}
            </View>
          )}
        />
      )}
    </View>
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
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: 'center' },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary },
  tabTextActive: { color: color.white },
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
