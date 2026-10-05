import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Linking } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type ActiveLocation = {
  officer_id: string;
  officer_name: string;
  officer_role: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  speed: number | null;
  battery_level: number | null;
  status: 'active' | 'stale' | 'location_unavailable' | 'low_accuracy' | string;
  updated_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  stale: 'Stale',
  low_accuracy: 'Low accuracy',
  location_unavailable: 'Location unavailable',
};
const STATUS_COLOR: Record<string, string> = {
  active: '#2e7d32',
  stale: '#f9a825',
  low_accuracy: '#ef6c00',
  location_unavailable: '#9e9e9e',
};

function formatLastSeen(updatedAt: string | null): string {
  if (!updatedAt) return 'Never reported';
  const diffMs = Date.now() - new Date(updatedAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Never reported';
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Last seen ${hrs} hr ago`;
  return `Last seen ${Math.round(hrs / 24)} day(s) ago`;
}

// Mobile equivalent of the web dashboard's Live Tracking Map. A real pin
// map (like web's Leaflet view) needs a Google Maps API key configured
// for Android, which this project doesn't have provisioned yet - so this
// gives the same underlying information (who's where, right now) as a
// list instead, with a "Navigate" button that opens the same coordinates
// in the officer's own Google Maps app, same destination the web map's
// own "Navigate via Google Maps" button opens. If a visual pin map is
// wanted later, it's a react-native-maps addition plus a Google Maps API
// key - a separate, larger change from this data-parity fix.
export default function AdminLiveMapScreen() {
  // useDataFetch doesn't support a polling interval, only refetch-on-
  // focus (the default) - re-opening or returning to this screen gets a
  // fresh read, same as every other admin list screen in this app.
  const { data, loading, error, retry } = useDataFetch<ActiveLocation[]>(
    () => apiClient.request('/location/active', 'GET', 'admin_action'),
    []
  );

  const navigateTo = (lat: number, lng: number) => {
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !data || data.length === 0 ? (
        <EmptyState message="No field or sales officers to show." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(o) => o.officer_id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.name}>{item.officer_name}</Text>
                <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] || color.textDisabled }]}>
                  <Text style={styles.badgeText}>{STATUS_LABEL[item.status] || item.status}</Text>
                </View>
              </View>
              <Text style={styles.meta}>{item.officer_role.replace('_', ' ')} · {formatLastSeen(item.updated_at)}</Text>
              {item.latitude != null && item.longitude != null ? (
                <>
                  <Text style={styles.meta}>{item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</Text>
                  <TouchableOpacity style={styles.navBtn} onPress={() => navigateTo(item.latitude as number, item.longitude as number)}>
                    <Text style={styles.navBtnText}>Navigate via Google Maps</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.noLocation}>No location data yet</Text>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  badge: { paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  badgeText: { color: color.white, fontSize: font.caption, fontWeight: fontWeight.bold },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  noLocation: { fontSize: font.caption, color: color.textDisabled, marginTop: spacing.sm, fontStyle: 'italic' },
  navBtn: { marginTop: spacing.md, backgroundColor: color.primary, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  navBtnText: { color: color.white, fontSize: font.caption, fontWeight: fontWeight.bold },
});
