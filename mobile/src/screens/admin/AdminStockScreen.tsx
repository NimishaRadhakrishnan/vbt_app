import React, { useState } from 'react';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native';
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
type Product = { id: string; name: string; sku_code: string; is_active: boolean };
type SimpleUser = { id: string; full_name: string; employee_id?: string; role: string };
type LedgerRow = { id: string; product_name: string; officer_name: string; qty_delta: number; movement_type: string; remarks: string; created_at: string };

const TABS = ['issue', 'recon', 'ledger'] as const;
type TabKey = typeof TABS[number];
const TAB_LABEL: Record<TabKey, string> = { issue: 'Issue Stock', recon: 'Stock with Officers', ledger: 'History' };

// Closes the stock web/mobile gap: mobile could only view the
// reconciliation table (GET /stock/reconciliation); allocating stock
// (POST /stock/allocations) and the full movement ledger (GET /stock/
// ledger) only existed on web. The CSV bulk-upload path on web is left
// web-only (a file picker isn't a natural mobile pattern) but the exact
// same manual allocation form web itself provides alongside it is added
// here, which is the part that matters for "can I do my job from my
// phone".
export default function AdminStockScreen({ initialTab, hideTabs }: { initialTab?: TabKey; hideTabs?: boolean } = {}) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'issue');

  // When the Stock section hosts this screen, its own tabs (Issue / With
  // Officers / History) are the section's tabs, so the inner strip is hidden
  // and the section tells us which one to show.
  React.useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  return (
    <View style={styles.container}>
      {!hideTabs && (
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{TAB_LABEL[t]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {tab === 'issue' && <IssueStockTab />}
      {tab === 'recon' && <ReconTab />}
      {tab === 'ledger' && <LedgerTab />}
    </View>
  );
}

function IssueStockTab() {
  const [officerId, setOfficerId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: officers } = useDataFetch<SimpleUser[]>(
    () => apiClient.request('/users?limit=200', 'GET', 'admin_action'),
    [],
    { refetchOnFocus: false }
  );
  const trackableOfficers = (officers ?? []).filter((u) => u.role === 'field_officer' || u.role === 'sales_officer');

  const { data: products } = useDataFetch<Product[]>(
    () => apiClient.request('/admin/products', 'GET', 'admin_action'),
    [],
    { refetchOnFocus: false }
  );
  const activeProducts = (Array.isArray(products) ? products : (products as any)?.items ?? []).filter((p: Product) => p.is_active);

  const submit = async () => {
    if (!officerId) {
      Alert.alert('Select an Officer', 'Choose who this stock is for first.');
      return;
    }
    const allocations = Object.keys(inputs)
      .map((pid) => ({ product_id: pid, quantity: parseFloat(inputs[pid] || '0') }))
      .filter((a) => a.quantity > 0 && !isNaN(a.quantity));
    if (allocations.length === 0) {
      Alert.alert('No Quantities', 'Enter a quantity for at least one product.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.request('/stock/allocations', 'POST', 'admin_action', {
        allocations: allocations.map((a) => ({ ...a, officer_id: officerId })),
      });
      Alert.alert('Stock Issued', 'Allocation saved successfully.');
      setInputs({});
    } catch (err: any) {
      Alert.alert('Could Not Issue Stock', err?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.sectionLabel}>Officer</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
        {trackableOfficers.map((o) => (
          <TouchableOpacity
            key={o.id}
            style={[styles.chip, officerId === o.id && styles.chipActive]}
            onPress={() => setOfficerId(o.id)}
          >
            <Text style={[styles.chipText, officerId === o.id && styles.chipTextActive]}>{o.full_name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={styles.sectionLabel}>Quantity to Issue</Text>
      {activeProducts.map((p: Product) => (
        <View key={p.id} style={styles.productRow}>
          <Text style={styles.productName}>{p.name} ({p.sku_code})</Text>
          <TextInput
            style={styles.qtyInput}
            keyboardType="numeric"
            value={inputs[p.id] || ''}
            onChangeText={(v) => setInputs((f) => ({ ...f, [p.id]: v }))}
            placeholder="0"
          />
        </View>
      ))}

      <TouchableOpacity style={styles.submitBtn} disabled={submitting} onPress={submit}>
        {submitting ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.submitBtnText}>Submit Allocation</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function ReconTab() {
  const { data, loading, error, retry } = useDataFetch<ReconciliationRow[]>(
    () => apiClient.request('/stock/reconciliation', 'GET', 'admin_action'),
    []
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <EmptyState message="No stock has been allocated to any officer yet." />;

  return (
    <FlatList
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
            <Text style={[styles.onHandValue, { color: item.on_hand < 0 ? color.error : color.primary }]}>{item.on_hand}</Text>
          </View>
        </View>
      )}
    />
  );
}

function LedgerTab() {
  const { data, loading, error, retry } = useDataFetch<LedgerRow[]>(
    () => apiClient.request('/stock/ledger?limit=200', 'GET', 'admin_action'),
    []
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <EmptyState message="No stock movements recorded yet." />;

  return (
    <FlatList
      data={data}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: spacing.lg }}
      renderItem={({ item }) => (
        <View style={styles.ledgerRow}>
          <Text style={styles.name}>{item.officer_name}</Text>
          <Text style={styles.product}>{item.product_name} · {item.movement_type.replace('_', ' ')}</Text>
          <View style={styles.ledgerMetaRow}>
            <Text style={[styles.ledgerQty, { color: item.qty_delta < 0 ? color.error : color.success }]}>
              {item.qty_delta > 0 ? '+' : ''}{item.qty_delta}
            </Text>
            <Text style={styles.ledgerDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
          </View>
          {!!item.remarks && <Text style={styles.ledgerRemarks}>{item.remarks}</Text>}
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
  sectionLabel: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginBottom: spacing.sm },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textPrimary },
  chipTextActive: { color: color.white },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: color.cardBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  productName: { flex: 1, fontSize: font.body, color: color.textPrimary },
  qtyInput: { width: 72, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, padding: spacing.sm, textAlign: 'center' },
  submitBtn: { backgroundColor: color.primary, paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center', marginTop: spacing.lg },
  submitBtnText: { color: color.white, fontWeight: fontWeight.bold },
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
  ledgerRow: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  ledgerMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  ledgerQty: { fontSize: font.subtitle, fontWeight: fontWeight.bold },
  ledgerDate: { fontSize: font.caption, color: color.textSecondary },
  ledgerRemarks: { fontSize: font.caption, color: color.textSecondary, marginTop: spacing.sm, fontStyle: 'italic' },
});
