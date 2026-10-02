import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Alert, ActivityIndicator } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type Dealer = {
  id: string;
  name: string;
  phone: string;
  district: string;
  village?: string | null;
  dealer_type?: string | null;
  status: string;
};

type Order = {
  id: string;
  dealer_id: string;
  status: string;
  total_amount: number;
  amount_paid: number;
  outstanding_amount: number;
  payment_status: string;
  order_date: string;
};

const TABS = ['approvals', 'orders'] as const;
type TabKey = typeof TABS[number];

// Admin/manager oversight of dealers: GET /dealers/search?status_filter=
// pending_approval + PATCH /dealers/{id}/approval (dealer_router.py), and
// GET /dealers/orders/all for every order across every Sales Officer -
// both real endpoints that only the web admin console reached before.
export default function AdminDealersScreen() {
  const [tab, setTab] = useState<TabKey>('approvals');
  const [actingId, setActingId] = useState<string | null>(null);

  const approvals = useDataFetch<Dealer[]>(
    () => apiClient.request('/dealers/search?status_filter=pending_approval', 'GET', 'admin_action'),
    []
  );
  const orders = useDataFetch<Order[]>(
    () => apiClient.request('/dealers/orders/all', 'GET', 'admin_action'),
    []
  );

  const decide = async (dealer: Dealer, approve: boolean) => {
    setActingId(dealer.id);
    try {
      await apiClient.request(`/dealers/${dealer.id}/approval`, 'PATCH', 'admin_action', { approve });
      approvals.retry();
    } catch (err: any) {
      Alert.alert('Could Not Update', err?.message ?? 'Please try again.');
    } finally {
      setActingId(null);
    }
  };

  const PAYMENT_LABEL: Record<string, string> = {
    paid: 'Paid',
    upcoming: 'Upcoming',
    due_today: 'Due Today',
    overdue: 'Overdue',
  };
  const PAYMENT_COLOR: Record<string, string> = {
    paid: color.success,
    upcoming: color.info,
    due_today: color.warning,
    overdue: color.error,
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'approvals' ? 'Pending Approval' : 'All Orders'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'approvals' ? (
        approvals.loading ? (
          <LoadingState />
        ) : approvals.error ? (
          <ErrorState message={approvals.error} onRetry={approvals.retry} />
        ) : !approvals.data || approvals.data.length === 0 ? (
          <EmptyState message="No dealers waiting for approval." />
        ) : (
          <FlatList
            data={approvals.data}
            keyExtractor={(d) => d.id}
            contentContainerStyle={{ padding: spacing.lg }}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>{item.phone} · {item.district}{item.village ? `, ${item.village}` : ''}</Text>
                {!!item.dealer_type && <Text style={styles.meta}>{item.dealer_type}</Text>}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn]}
                    disabled={actingId === item.id}
                    onPress={() => decide(item, false)}
                  >
                    {actingId === item.id ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Reject</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn]}
                    disabled={actingId === item.id}
                    onPress={() => decide(item, true)}
                  >
                    {actingId === item.id ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Approve</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          />
        )
      ) : orders.loading ? (
        <LoadingState />
      ) : orders.error ? (
        <ErrorState message={orders.error} onRetry={orders.retry} />
      ) : !orders.data || orders.data.length === 0 ? (
        <EmptyState message="No dealer orders yet." />
      ) : (
        <FlatList
          data={orders.data}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.name}>₹{item.total_amount.toLocaleString()}</Text>
                <Text style={[styles.paymentBadge, { color: PAYMENT_COLOR[item.payment_status] ?? color.textSecondary }]}>
                  {PAYMENT_LABEL[item.payment_status] ?? item.payment_status}
                </Text>
              </View>
              <Text style={styles.meta}>
                {new Date(item.order_date).toLocaleDateString()} · Paid ₹{item.amount_paid.toLocaleString()} · Outstanding ₹{item.outstanding_amount.toLocaleString()}
              </Text>
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
  paymentBadge: { fontSize: font.caption, fontWeight: fontWeight.bold },
  actions: { flexDirection: 'row', marginTop: spacing.lg },
  actionBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center', marginRight: spacing.sm },
  rejectBtn: { backgroundColor: color.error },
  approveBtn: { backgroundColor: color.success, marginRight: 0 },
  actionText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
});
