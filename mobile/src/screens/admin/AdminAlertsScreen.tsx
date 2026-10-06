import React from 'react';
import { FlatList, Linking, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type Alert = {
  id: string;
  officer_id: string;
  officer_name: string;
  type: 'territory_exit' | 'tracking_gap' | 'tracking_not_started' | string;
  message: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  ended_at: string | null;
};

const TITLE: Record<string, string> = {
  territory_exit: 'Left territory',
  tracking_gap: 'Tracking gap',
  tracking_not_started: 'Tracking not started',
};
const ICON: Record<string, string> = {
  territory_exit: 'navigate-circle-outline',
  tracking_gap: 'cellular-outline',
  tracking_not_started: 'alert-circle-outline',
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// Today's location alerts: officers who left their territory, whose tracking
// has a gap, or whose tracking never started after check-in. Refreshes every
// 30 seconds while open.
export default function AdminAlertsScreen() {
  const { data, loading, refreshing, error, retry, refresh } = useDataFetch<Alert[]>(
    () => apiClient.request('/location/alerts', 'GET', 'admin_action'),
    [],
  );

  const refreshRef = React.useRef(refresh);
  refreshRef.current = refresh;
  React.useEffect(() => {
    const id = setInterval(() => refreshRef.current(), 30000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={data ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: spacing.lg, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={<EmptyState message="No alerts today." actionHint="Everyone is inside their territory and tracking normally." />}
        renderItem={({ item }) => {
          const open = item.type === 'territory_exit' && !item.ended_at;
          return (
            <View style={[styles.card, open && styles.cardOpen]}>
              <View style={styles.head}>
                <Ionicons name={(ICON[item.type] ?? 'alert-circle-outline') as any} size={22} color={open ? color.error : color.warning} />
                <Text style={styles.title}>{TITLE[item.type] ?? item.type}</Text>
                <Text style={styles.time}>{clock(item.created_at)}</Text>
              </View>
              <Text style={styles.message}>{item.message}</Text>
              {item.type === 'territory_exit' && (
                <Text style={open ? styles.open : styles.closed}>
                  {open ? 'Still outside' : `Back inside at ${clock(item.ended_at as string)}`}
                </Text>
              )}
              {item.latitude != null && item.longitude != null && (
                <TouchableOpacity
                  style={styles.link}
                  onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${item.latitude},${item.longitude}`)}
                  accessibilityRole="button"
                  accessibilityLabel="Open location in Google Maps"
                >
                  <Ionicons name="open-outline" size={18} color={color.primary} />
                  <Text style={styles.linkText}>Where they were</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  card: { backgroundColor: color.cardBg, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  cardOpen: { borderColor: color.error },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  time: { fontSize: font.caption, color: color.textSecondary },
  message: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.sm },
  open: { fontSize: font.caption, color: color.error, fontWeight: fontWeight.semibold, marginTop: spacing.sm },
  closed: { fontSize: font.caption, color: color.success, marginTop: spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, marginTop: spacing.sm },
  linkText: { fontSize: font.caption, color: color.primary, fontWeight: fontWeight.semibold },
});
