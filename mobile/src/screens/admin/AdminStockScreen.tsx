import React from 'react';
import { StyleSheet, Text, View, FlatList } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type ReconciliationRow = {
  officer_id: string;
  officer_name: string;
  product_id: string;
  product_name: string;
  allocated: number;
  trial_given: number;
  sold: number;
  other: number;
  on_hand: number;
};

// GET /stock/reconciliation (admin/manager only - stock_router.py): every
// officer's allocated/given/sold/on-hand per product, computed live from
// the append-only stock_ledger - the same reconciliation view the web
// admin console uses, not a recomputation of its own.
export default function AdminStockScreen() {
  const { data, loading, error, retry } = useDataFetch<ReconciliationRow[]>(
    () => apiClient.request('/stock/reconciliation', 'GET', 'admin_action'),
    []
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <EmptyState message="No stock has been allocated to any officer yet." />;

  return (
    <FlatList
      style={styles.container}
      data={data}
      keyExtractor={(r) => `${r.officer_id}-${r.product_id}`}
      contentContainerStyle={{ padding: spacing.lg }}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.name}>{item.officer_name}</Text>
          <Text style={styles.product}>{item.product_name}</Text>
          <View style={styles.row}>
            <Metric label="Allocated" value={item.allocated} />
            <Metric label="Given (trial)" value={item.trial_given} />
            <Metric label="Sold" value={item.sold} />
          </View>
          <View style={styles.onHandRow}>
            <Text style={styles.onHandLabel}>On Hand</Text>
            <Text style={[styles.onHandValue, { color: item.on_hand < 0 ? color.error : color.primary }]}>
              {item.on_hand}
            </Text>
          </View>
        </View>
      )}
    />
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  product: { fontSize: font.caption, color: color.textSecondary, marginTop: 2, marginBottom: spacing.sm },
  row: { flexDirection: 'row', marginTop: spacing.sm },
  metricValue: { fontSize: font.title, fontWeight: fontWeight.bold, color: color.textPrimary },
  metricLabel: { fontSize: font.caption, color: color.textSecondary },
  onHandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
  },
  onHandLabel: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary },
  onHandValue: { fontSize: font.title, fontWeight: fontWeight.bold },
});
