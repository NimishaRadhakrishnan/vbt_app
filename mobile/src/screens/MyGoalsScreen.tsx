import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { ErrorState, LoadingState, StaleDataBanner } from '../components/FetchStates';
import { C, Item, Overview, Panel, Ring, Sentence, colorOf, elapsedShare, itemLine, rupees, status } from '../components/kpi/common';
import { LevelLadder, MyBest, PaceLine, PastList, ScoreBars, TrialFunnel, WorkCalendar } from '../components/kpi/charts';
import { color, font, fontWeight, radius, spacing } from '../theme';

const PACE_ITEMS = ['farmers_visited', 'villages_covered', 'demo_agreed', 'trial_area'];
type Entries = { count: number; rows: { title: string; subtitle: string; date: string | null }[] };

function EntriesSheet({ item, period, onClose }: { item: Item; period: 'month' | 'quarter'; onClose: () => void }) {
  const { data, error } = useDataFetch<Entries>(() => apiClient.request(`/kpi/me/entries?item=${item.code}&period=${period}`, 'GET', 'plan_submit'), [item.code, period]);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <View style={st.sheet}>
          <View style={st.sheetHead}>
            <View><Text style={st.h2}>{item.name}</Text><Text style={st.muted}>{data ? `${data.count} entr${data.count === 1 ? 'y' : 'ies'}` : 'Loading…'}</Text></View>
            <TouchableOpacity onPress={onClose}><Text style={st.link}>Close</Text></TouchableOpacity>
          </View>
          <ScrollView>
            {error && <Text style={st.muted}>Could not load the list. Please try again.</Text>}
            {data && data.rows.length === 0 && <Text style={st.muted}>Nothing here yet for this period.</Text>}
            {data?.rows.map((r, i) => (
              <View key={i} style={st.entry}>
                <View style={{ flex: 1 }}><Text style={st.body}>{r.title}</Text><Text style={st.muted}>{r.subtitle}</Text></View>
                {r.date && <Text style={st.muted}>{r.date.slice(5)}</Text>}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function MyGoalsScreen() {
  const [tab, setTab] = useState<'month' | 'quarter' | 'past'>('month');
  const [pastKind, setPastKind] = useState<'month' | 'quarter'>('month');
  const [mode, setMode] = useState<'field' | 'sales' | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const kind = tab === 'quarter' ? 'quarter' : 'month';

  const { data: o, loading, error, isStale, retry } = useDataFetch<Overview>(
    () => apiClient.request(`/kpi/me/overview?period=${kind}`, 'GET', 'plan_submit'), [kind]);

  const m = mode ?? (o?.mode === 'sales' ? 'sales' : 'field');
  const block = o ? (m === 'sales' ? o.sales : o.field) : undefined;
  const counted = (block?.items ?? []).filter((i) => !i.skipped && i.goal > 0);
  const el = o ? elapsedShare(o.period) : 0;

  return (
    <ScrollView style={st.container} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={st.pills}>
        {([['month', 'This month'], ['quarter', 'This quarter'], ['past', 'Past']] as const).map(([k, l]) => (
          <TouchableOpacity key={k} onPress={() => setTab(k)} style={[st.pill, tab === k && st.pillOn]}>
            <Text style={[st.pillText, tab === k && { color: '#fff' }]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'past' ? (
        <>
          <View style={st.pills}>
            {(['month', 'quarter'] as const).map((k) => (
              <TouchableOpacity key={k} onPress={() => setPastKind(k)} style={[st.pill, pastKind === k && st.pillDark]}>
                <Text style={[st.pillText, pastKind === k && { color: '#fff' }]}>{k === 'month' ? 'Months' : 'Quarters'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Panel title="Past periods"><PastList period={pastKind} /><Sentence>Your money for a quarter shows here once the office has finished and approved it.</Sentence></Panel>
          <Panel title="My best"><MyBest /><Sentence>Your best month for each goal. The only person to beat is you.</Sentence></Panel>
        </>
      ) : loading && !o ? (
        <LoadingState />
      ) : error && !o ? (
        <ErrorState message="Could not load your goals." onRetry={retry} />
      ) : o && !o.ready ? (
        <Panel title="Your goals"><Text style={st.body}>{o.advice}</Text></Panel>
      ) : o ? (
        <>
          {isStale && <StaleDataBanner onRetry={retry} />}
          {o.mode === 'both' && (
            <View style={st.pills}>
              {(['field', 'sales'] as const).map((k) => (
                <TouchableOpacity key={k} onPress={() => setMode(k)} style={[st.pill, m === k && st.pillDark]}>
                  <Text style={[st.pillText, m === k && { color: '#fff' }]}>{k === 'field' ? 'Field' : 'Sales'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <View style={st.advice}><Text style={st.body}>{o.advice}</Text></View>

          <Panel title="Goal rings">
            <View style={st.rings}>
              {counted.map((i) => (
                <TouchableOpacity key={i.code} style={st.ringBox} onPress={() => setOpen(i)}>
                  <Ring pct={i.pct ?? 0} c={colorOf(status(i.pct, el))} />
                  <Text style={st.bold}>{i.name}</Text>
                  <Text style={st.mutedC}>{itemLine(i, o.period)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Sentence>Green is done, blue is on track, amber needs a push. Tap a ring to see the entries behind it.</Sentence>
          </Panel>

          {m === 'field' && o.field && (
            <>
              {counted.filter((i) => PACE_ITEMS.includes(i.code)).slice(0, 2).map((i) => (
                <Panel key={i.code} title={`On-track line · ${i.name}`}><PaceLine code={i.code} period={kind} /></Panel>
              ))}
              <Panel title="Trial funnel"><TrialFunnel f={o.field.trial_funnel} /><Sentence>How many farmers moved from a visit to a demo, a trial and a purchase.</Sentence></Panel>
            </>
          )}

          {m === 'sales' && o.sales && (
            <Panel title="Level ladder">
              {o.sales.waiting_for_figures ? (
                <Text style={st.body}>Waiting for sales figures. They will show here as soon as the office adds them.</Text>
              ) : o.sales.ladder && o.sales.incentive ? (
                <>
                  <Text style={[st.big, { color: C.done }]}>{rupees(o.sales.incentive.earned_so_far_paise)} earned so far</Text>
                  <LevelLadder ladder={o.sales.ladder} earned={o.sales.incentive.earned_so_far_paise} />
                  {o.sales.what_if?.message ? <View style={st.advice}><Text style={st.body}>{o.sales.what_if.message}</Text></View> : null}
                  <Sentence>Each step shows the money needed to climb and what you would earn there, at today's score.</Sentence>
                </>
              ) : <Text style={st.body}>No sales goal has been set yet.</Text>}
            </Panel>
          )}

          {tab === 'month' && <Panel title="Work calendar"><WorkCalendar /></Panel>}

          <Panel title={`My score · ${block ? Math.round(block.score) : 0} marks`}>
            <ScoreBars items={block?.items ?? []} onOpen={setOpen} />
            <Sentence>Each bar is the marks earned out of the marks it carries. "Max" means you have earned the most it can give.</Sentence>
          </Panel>
          <Panel title="My best"><MyBest /><Sentence>Your best month for each goal. The only person to beat is you.</Sentence></Panel>
        </>
      ) : null}
      {open && <EntriesSheet item={open} period={kind} onClose={() => setOpen(null)} />}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  pills: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  pill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: color.cardBg, borderWidth: 1, borderColor: color.border },
  pillOn: { backgroundColor: color.primary, borderColor: color.primary },
  pillDark: { backgroundColor: '#475569', borderColor: '#475569' },
  pillText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary },
  advice: { backgroundColor: color.cardBg, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  rings: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  ringBox: { width: '47%', alignItems: 'center', gap: 4 },
  body: { fontSize: font.body, color: color.textPrimary },
  bold: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary, textAlign: 'center' },
  mutedC: { fontSize: font.caption, color: color.textMuted, textAlign: 'center' },
  muted: { fontSize: font.caption, color: color.textMuted },
  big: { fontSize: font.title, fontWeight: fontWeight.bold, marginBottom: spacing.sm },
  link: { color: color.primary, fontWeight: fontWeight.semibold },
  h2: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  backdrop: { flex: 1, backgroundColor: color.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: color.cardBg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%', padding: spacing.lg },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  entry: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.borderLight },
});
