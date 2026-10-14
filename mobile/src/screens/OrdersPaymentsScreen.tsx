import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState } from '../components/FetchStates';
import SearchBox, { matchesQuery } from '../components/SearchBox';
import { color, font, fontWeight, spacing, radius } from '../theme';

type OrderItem = { product_name: string; quantity: number; unit_price: number };
type Order = {
  id: string;
  dealer_id: string;
  dealer_name: string;
  dealer_phone?: string;
  status: string;
  total_amount: number;
  amount_paid: number;
  outstanding_amount: number;
  payment_deadline: string | null;
  payment_status: 'paid' | 'overdue' | 'due_today' | 'upcoming';
  order_date: string | null;
  items: OrderItem[];
};
type Payment = {
  id: string;
  amount: number;
  payment_date: string;
  method?: string | null;
  reference_number?: string | null;
  collection_status: string;
  collected_by_name: string;
  remarks?: string | null;
};

const METHODS = ['cash', 'upi', 'bank_transfer', 'cheque'];
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank', cheque: 'Cheque' };
const FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'due', label: 'Pending' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'paid', label: 'Paid' },
];
const STATUS_LABEL: Record<string, string> = { paid: 'Paid', overdue: 'Overdue', due_today: 'Due today', upcoming: 'Pending' };
const STATUS_COLOR: Record<string, string> = {
  paid: color.success,
  overdue: color.error,
  due_today: color.warning ?? '#b26a00',
  upcoming: color.info,
};

const money = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Orders received from (or booked for) the officer's dealers, with what has
// been paid and what is still due. Payments recorded here show at once in the
// admin web app (Dealers > Orders) because both read the same payment rows.
export default function OrdersPaymentsScreen() {
  const { data, loading, error, retry, refresh } = useDataFetch<Order[]>(
    () => apiClient.request('/dealers/orders/mine', 'GET', 'dealer_order').then((d) => d || []),
    []
  );
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  const orders = (data ?? []).filter((o) => {
    if (!matchesQuery(o.dealer_name, query)) return false;
    if (filter === 'due') return o.outstanding_amount > 0;
    if (filter === 'overdue') return o.payment_status === 'overdue';
    if (filter === 'paid') return o.payment_status === 'paid';
    return true;
  });
  const totalDue = (data ?? []).reduce((a, o) => a + o.outstanding_amount, 0);
  const totalPaid = (data ?? []).reduce((a, o) => a + o.amount_paid, 0);

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Orders & Payments</Text>

      <View style={styles.summaryRow}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Collected</Text>
          <Text style={[styles.summaryValue, { color: color.success }]}>{money(totalPaid)}</Text>
        </View>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Still to collect</Text>
          <Text style={[styles.summaryValue, { color: color.error }]}>{money(totalDue)}</Text>
        </View>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f.id} style={[styles.filterChip, filter === f.id && styles.filterChipActive]} onPress={() => setFilter(f.id)}>
            <Text style={[styles.filterText, filter === f.id && styles.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <SearchBox value={query} onChangeText={setQuery} placeholder="Search dealer" />

      {orders.length === 0 && <Text style={styles.empty}>No orders to show.</Text>}

      {orders.map((o) => (
        <OrderCard key={o.id} order={o} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} onChanged={() => refresh?.()} />
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function OrderCard({ order, open, onToggle, onChanged }: { order: Order; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const [history, setHistory] = useState<Payment[] | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  const loadHistory = async () => {
    try {
      setHistory((await apiClient.request(`/dealers/orders/${order.id}/payments`, 'GET', 'dealer_order')) || []);
    } catch {
      setHistory([]);
    }
  };

  const toggle = () => {
    if (!open && history === null) void loadHistory();
    onToggle();
  };

  const record = async () => {
    const value = Number(amount);
    if (!value || value <= 0) return Alert.alert('Amount needed', 'Enter the amount received.');
    if (value > order.outstanding_amount + 0.01) {
      return Alert.alert('Too much', `Only ${money(order.outstanding_amount)} is still due on this order.`);
    }
    setBusy(true);
    try {
      await apiClient.request(
        `/dealers/orders/${order.id}/payments`,
        'POST',
        'dealer_order',
        {
          collection_status: 'collected',
          amount: value,
          method,
          reference_number: reference.trim() || undefined,
          remarks: remarks.trim() || undefined,
        },
        { queue: false }
      );
      setAmount('');
      setReference('');
      setRemarks('');
      await loadHistory();
      onChanged();
      Alert.alert('Payment saved', `${money(value)} recorded for ${order.dealer_name}.`);
    } catch (err: any) {
      Alert.alert('Could not save payment', err?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const sc = STATUS_COLOR[order.payment_status] ?? color.textMuted;
  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={toggle} activeOpacity={0.7}>
        <View style={styles.cardTop}>
          <Text style={styles.dealerName} numberOfLines={1}>{order.dealer_name}</Text>
          <View style={[styles.badge, { borderColor: sc }]}>
            <Text style={[styles.badgeText, { color: sc }]}>{STATUS_LABEL[order.payment_status] ?? order.payment_status}</Text>
          </View>
        </View>
        <Text style={styles.meta}>Ordered {day(order.order_date)}{order.payment_deadline ? ` · Due ${day(order.payment_deadline)}` : ''}</Text>
        <View style={styles.amountRow}>
          <Text style={styles.amount}>Total {money(order.total_amount)}</Text>
          <Text style={styles.amount}>Paid {money(order.amount_paid)}</Text>
          <Text style={[styles.amount, { color: order.outstanding_amount > 0 ? color.error : color.success }]}>Due {money(order.outstanding_amount)}</Text>
        </View>
      </TouchableOpacity>

      {open && (
        <View style={styles.detail}>
          <Text style={styles.sectionLabel}>Items</Text>
          {order.items.length === 0 && <Text style={styles.meta}>No item details.</Text>}
          {order.items.map((it, i) => (
            <Text key={i} style={styles.itemLine}>{it.product_name} × {it.quantity}  ({money(it.unit_price)} each)</Text>
          ))}

          <Text style={styles.sectionLabel}>Payments received</Text>
          {history === null && <ActivityIndicator color={color.primary} />}
          {history !== null && history.length === 0 && <Text style={styles.meta}>No payments recorded yet.</Text>}
          {(history ?? []).map((p) => (
            <Text key={p.id} style={styles.itemLine}>
              {day(p.payment_date)} · {p.collection_status === 'collected' ? money(p.amount) : p.collection_status.replace(/_/g, ' ')}
              {p.method ? ` · ${METHOD_LABEL[p.method] ?? p.method}` : ''}{p.reference_number ? ` · ${p.reference_number}` : ''} · {p.collected_by_name}
            </Text>
          ))}

          {order.outstanding_amount > 0 && (
            <View style={styles.form}>
              <Text style={styles.sectionLabel}>Record a payment</Text>
              <TextInput
                style={styles.input}
                placeholder={`Amount received (due ${money(order.outstanding_amount)})`}
                placeholderTextColor={color.textMuted}
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
              <View style={styles.filterRow}>
                {METHODS.map((m) => (
                  <TouchableOpacity key={m} style={[styles.filterChip, method === m && styles.filterChipActive]} onPress={() => setMethod(m)}>
                    <Text style={[styles.filterText, method === m && styles.filterTextActive]}>{METHOD_LABEL[m]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {method !== 'cash' && (
                <TextInput style={styles.input} placeholder="Reference / UTR / cheque no." placeholderTextColor={color.textMuted} value={reference} onChangeText={setReference} />
              )}
              <TextInput style={styles.input} placeholder="Remarks (optional)" placeholderTextColor={color.textMuted} value={remarks} onChangeText={setRemarks} />
              <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={record} disabled={busy}>
                {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.btnText}>Save Payment</Text>}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg, padding: spacing.xl },
  title: { fontSize: font.title, fontWeight: fontWeight.bold, color: color.primary, marginBottom: spacing.lg, marginTop: spacing.xl },
  summaryRow: { flexDirection: 'row', marginBottom: spacing.lg },
  summaryBox: { flex: 1, backgroundColor: color.white, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, padding: spacing.lg, marginRight: spacing.sm },
  summaryLabel: { fontSize: font.caption, color: color.textMuted },
  summaryValue: { fontSize: font.title, fontWeight: fontWeight.bold, marginTop: 4 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  filterChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: color.border, backgroundColor: color.white, marginRight: spacing.sm, marginBottom: spacing.sm },
  filterChipActive: { backgroundColor: color.primary, borderColor: color.primary },
  filterText: { fontSize: font.body, color: color.textPrimary, paddingRight: 3 },
  filterTextActive: { color: color.white },
  empty: { color: color.textMuted, fontStyle: 'italic', marginVertical: spacing.xl, textAlign: 'center' },
  card: { backgroundColor: color.white, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, padding: spacing.lg, marginTop: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dealerName: { flex: 1, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginRight: spacing.sm },
  badge: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 2 },
  badgeText: { fontSize: font.caption, fontWeight: fontWeight.bold, paddingRight: 2 },
  meta: { fontSize: font.caption, color: color.textMuted, marginTop: 4 },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, flexWrap: 'wrap' },
  amount: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary, paddingRight: 4 },
  detail: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: color.borderLight, paddingTop: spacing.md },
  sectionLabel: { fontSize: font.caption, fontWeight: fontWeight.bold, color: color.primary, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: 4 },
  itemLine: { fontSize: font.body, color: color.textPrimary, marginBottom: 3 },
  form: { marginTop: spacing.md },
  input: { backgroundColor: color.screenBg, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, padding: spacing.md, fontSize: font.subtitle, color: color.textPrimary, marginBottom: spacing.md },
  btn: { backgroundColor: color.primary, borderRadius: radius.sm, padding: 14, alignItems: 'center' },
  btnText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.subtitle },
});
