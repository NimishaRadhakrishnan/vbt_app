import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { color, font, fontWeight, radius, spacing } from '../../theme';
import { C, Overview, Ring, colorOf, elapsedShare, itemLine, rupees, status } from './common';

/** Dashboard card: one ring per goal, one line of advice, incentive so far (Sales). */
export default function MyGoalsCard({ onOpen }: { onOpen: () => void }) {
  const [tab, setTab] = useState<'field' | 'sales' | null>(null);
  const { data: o, error } = useDataFetch<Overview>(() => apiClient.request('/kpi/me/overview?period=month', 'GET', 'plan_submit'), []);
  if (error && !o) return null;                    // rest of the dashboard still works
  if (!o) return null;
  const m = tab ?? (o.mode === 'sales' ? 'sales' : 'field');
  const block = m === 'sales' ? o.sales : o.field;
  const items = (block?.items ?? []).filter((i) => !i.skipped && i.goal > 0).slice(0, 4);
  const el = elapsedShare(o.period);
  return (
    <View style={s.card}>
      <View style={s.row}>
        <Text style={s.title}>My Goals · this month</Text>
        <TouchableOpacity onPress={onOpen}><Text style={s.link}>See all</Text></TouchableOpacity>
      </View>
      {o.mode === 'both' && (
        <View style={s.pills}>
          {(['field', 'sales'] as const).map((k) => (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.pill, m === k && s.pillOn]}>
              <Text style={[s.pillText, m === k && { color: '#fff' }]}>{k === 'field' ? 'Field' : 'Sales'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {items.map((i) => (
        <View key={i.code} style={s.item}>
          <Ring pct={i.pct ?? 0} c={colorOf(status(i.pct, el))} size={60} />
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{i.name}</Text>
            <Text style={s.muted}>{itemLine(i, o.period)}</Text>
          </View>
        </View>
      ))}
      <View style={s.advice}><Text style={s.body}>{o.advice}</Text></View>
      {m === 'sales' && o.sales && (o.sales.waiting_for_figures
        ? <Text style={s.muted}>Waiting for sales figures.</Text>
        : o.sales.incentive && (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={[s.big, { color: C.done }]}>{rupees(o.sales.incentive.earned_so_far_paise)} earned so far</Text>
            {o.sales.what_if?.message ? <Text style={s.muted}>{o.sales.what_if.message}</Text> : null}
          </View>
        ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.cardBg, borderRadius: radius.md, padding: spacing.lg, margin: spacing.lg, marginBottom: 0 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  link: { color: color.primary, fontWeight: fontWeight.semibold },
  pills: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: color.screenBg },
  pillOn: { backgroundColor: color.primary },
  pillText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  name: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  muted: { fontSize: font.caption, color: color.textMuted },
  body: { fontSize: font.body, color: color.textPrimary },
  advice: { backgroundColor: color.screenBg, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.xs },
  big: { fontSize: font.title, fontWeight: fontWeight.bold },
});
