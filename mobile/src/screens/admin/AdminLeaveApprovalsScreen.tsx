import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Alert, ActivityIndicator } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type LeaveRequest = {
  id: string;
  officer_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: string;
};

// GET /leave?status_filter=pending with no officer_id (admin/manager
// see every officer's requests server-side - leave_router.py's
// is_privileged check), PATCH /leave/{id}/decision to act on one. Both
// endpoints already exist and already power the web admin console; this
// is the same data, just a mobile list instead of a table.
export default function AdminLeaveApprovalsScreen() {
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [actingId, setActingId] = useState<string | null>(null);

  const { data, loading, error, retry } = useDataFetch<LeaveRequest[]>(
    () => apiClient.request(`/leave?status_filter=${filter}`, 'GET', 'admin_action'),
    [filter]
  );

  const decide = async (item: LeaveRequest, approve: boolean) => {
    setActingId(item.id);
    try {
      await apiClient.request(`/leave/${item.id}/decision`, 'PATCH', 'admin_action', { approve });
      retry();
    } catch (err: any) {
      Alert.alert('Could Not Update', err?.message ?? 'Please try again.');
    } finally {
      setActingId(null);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['pending', 'approved', 'rejected'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !data || data.length === 0 ? (
        <EmptyState message={`No ${filter} leave requests.`} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.name}>{item.officer_name}</Text>
              <Text style={styles.meta}>
                {item.leave_type.charAt(0).toUpperCase() + item.leave_type.slice(1)} leave · {item.start_date} to {item.end_date}
              </Text>
              <Text style={styles.reason}>{item.reason}</Text>

              {filter === 'pending' && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn]}
                    onPress={() => decide(item, false)}
                    disabled={actingId === item.id}
                  >
                    {actingId === item.id ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Reject</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn]}
                    onPress={() => decide(item, true)}
                    disabled={actingId === item.id}
                  >
                    {actingId === item.id ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Approve</Text>}
                  </TouchableOpacity>
                </View>
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
  reason: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.sm },
  actions: { flexDirection: 'row', marginTop: spacing.lg },
  actionBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center', marginRight: spacing.sm },
  rejectBtn: { backgroundColor: color.error },
  approveBtn: { backgroundColor: color.success, marginRight: 0 },
  actionText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
});
