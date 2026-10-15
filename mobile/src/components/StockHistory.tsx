import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { color, font, fontWeight, spacing, radius } from '../theme';

// The officer's own stock log: every issue, trial, sale and correction with
// the stock left after it and who it was given to. GET /stock/ledger.
type Row = {
  id: string; product_name: string; qty_delta: number; movement_type: string;
  remarks?: string | null; created_at: string; balance_after?: number | null; context?: string | null;
};

const LABEL: Record<string, string> = {
  allocation: 'Issued to you', transfer_in: 'Transferred in', trial_given: 'Trial given', sale: 'Sold',
  damage: 'Damaged', transfer_out: 'Transferred out', return_to_company: 'Returned to company', count_correction: 'Adjusted',
};
const n = (v: number) => String(Math.round(v * 1000) / 1000);
const when = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function StockHistory() {
  const { data } = useDataFetch<Row[]>(() => apiClient.request('/stock/ledger?limit=100', 'GET', 'stock_audit').then((d) => d || []), []);
  const rows = data ?? [];
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Your stock history</Text>
      {rows.length === 0 && <Text style={styles.empty}>Nothing has moved yet.</Text>}
      {rows.map((r) => (
        <View key={r.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{r.product_name}</Text>
            <Text style={styles.meta}>
              {LABEL[r.movement_type] || r.movement_type}{r.context ? ` · ${r.context}` : ''} · {when(r.created_at)}
            </Text>
          </View>
          <View style={styles.right}>
            <Text style={[styles.delta, { color: r.qty_delta > 0 ? color.success : color.error }]}>
              {r.qty_delta > 0 ? '+' : ''}{n(r.qty_delta)}
            </Text>
            {r.balance_after != null && <Text style={styles.meta}>left {n(r.balance_after)}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl, paddingBottom: spacing.xl },
  title: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginBottom: spacing.sm },
  empty: { color: color.textMuted, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.white, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, padding: spacing.md, marginTop: spacing.sm },
  name: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textMuted, marginTop: 2 },
  right: { alignItems: 'flex-end', marginLeft: spacing.md },
  delta: { fontSize: font.subtitle, fontWeight: fontWeight.bold },
});
