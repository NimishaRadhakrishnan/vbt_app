import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { color, font, fontWeight, radius, spacing } from '../../theme';
import { C, Item, Overview, Seg, fmt, num, rupees } from './common';

/* ---------------------------------------------------------- On-track line */
type Series = { goal: number; points: { date: string; actual: number; needed: number }[]; sentence: string };

export function PaceLine({ code, period }: { code: string; period: 'month' | 'quarter' }) {
  const [w, setW] = useState(0);
  const { data } = useDataFetch<Series>(() => apiClient.request(`/kpi/me/series?item=${code}&period=${period}`, 'GET', 'plan_submit'), [code, period]);
  const H = 120, P = 8;
  const pts = data?.points ?? [];
  const max = Math.max(data?.goal ?? 0, ...pts.map((p) => p.actual), 1);
  const x = (i: number) => P + (i / Math.max(pts.length - 1, 1)) * Math.max(w - 2 * P, 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const last = pts[pts.length - 1];
  const c = !last ? C.track : last.actual >= last.needed ? C.done : last.actual >= last.needed * 0.9 ? C.track : C.push;
  return (
    <View>
      <View style={{ height: H }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {w > 0 && pts.length > 1 && pts.slice(1).map((p, i) => (
          <React.Fragment key={i}>
            <Seg x1={x(i)} y1={y(pts[i]!.needed)} x2={x(i + 1)} y2={y(p.needed)} c={C.muted} w={1.5} dashed />
            <Seg x1={x(i)} y1={y(pts[i]!.actual)} x2={x(i + 1)} y2={y(p.actual)} c={c} w={3} />
          </React.Fragment>
        ))}
        {w > 0 && last && <View style={{ position: 'absolute', left: x(pts.length - 1) - 4, top: y(last.actual) - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />}
      </View>
      <Text style={s.sentence}>{data?.sentence ?? 'The dotted line is where you should be today.'}</Text>
    </View>
  );
}

/* ----------------------------------------------------------- Level ladder */
export function LevelLadder({ ladder, earned }: { ladder: NonNullable<NonNullable<Overview['sales']>['ladder']>; earned: number }) {
  const rows = [...ladder.rows].sort((a, b) => b.level - a.level);
  const all: any[] = [...rows, { level: 0 }];
  return (
    <View>
      <View style={s.ladRow}><View style={s.lvl} /><Text style={s.ladHead}>Sales</Text><Text style={s.ladHead}>Collection</Text></View>
      {all.map((r) => (
        <View key={r.level} style={s.ladRow}>
          <View style={s.lvl}><Text style={s.lvlText}>{r.level}</Text></View>
          {(['sales', 'collection'] as const).map((k) => {
            const cur = k === 'sales' ? ladder.sales_level : ladder.collection_level;
            const you = r.level === cur, reached = r.level <= cur;
            const needed = r.level === 0 ? 0 : k === 'sales' ? r.sales_needed_paise : r.collection_needed_paise;
            const inc = r.level === 0 ? 0 : k === 'sales' ? r.incentive_at_sales_level_paise : r.incentive_at_collection_level_paise;
            return (
              <View key={k} style={[s.ladCell, reached && { backgroundColor: '#f1f8e9' }, you && { borderColor: C.track, borderWidth: 2 }]}>
                {you && <Text style={[s.small, { color: C.track, fontWeight: fontWeight.bold }]}>You are here</Text>}
                {r.level > 0 && !reached && <Text style={s.small}>{rupees(needed)} more to climb</Text>}
                {r.level > 0 && <Text style={s.smallMuted}>{reached && you ? `${rupees(earned)} earned` : `${rupees(inc)} if reached`}</Text>}
                {r.level === 0 && !you && <Text style={s.smallMuted}>Start</Text>}
              </View>
            );
          })}
        </View>
      ))}
      {ladder.level_match_applied && <Text style={s.smallMuted}>One level was held back so Sales and Collection stay close together.</Text>}
    </View>
  );
}

/* ----------------------------------------------------------- Trial funnel */
export function TrialFunnel({ f }: { f: NonNullable<Overview['field']>['trial_funnel'] }) {
  const steps: [string, number][] = [['Visited', f.visited], ['Agreed for demo', f.agreed_demo], ['Trial given', f.trials], ['Paid', f.paid]];
  const max = Math.max(f.visited, 1);
  return (
    <View>
      {steps.map(([label, v], i) => (
        <View key={label} style={{ marginBottom: spacing.sm }}>
          <View style={s.between}><Text style={s.body}>{label}</Text><Text style={s.bold}>{num(v)}</Text></View>
          <View style={s.rail}><View style={[s.fill, { width: `${(v / max) * 100}%`, backgroundColor: i === 3 ? C.done : C.track }]} /></View>
        </View>
      ))}
      {f.waiting > 0 && <Text style={s.smallMuted}>{f.waiting} trial farmer{f.waiting === 1 ? ' is' : 's are'} still within the time to buy.</Text>}
    </View>
  );
}

/* --------------------------------------------------------- Work calendar */
type Cal = { days: { date: string; visits: number; closed: boolean; kind: string; note: string | null }[]; max_visits: number; sentence: string };
export function WorkCalendar() {
  const { data } = useDataFetch<Cal>(() => apiClient.request('/kpi/me/calendar', 'GET', 'plan_submit'), []);
  if (!data) return <Text style={s.smallMuted}>Loading…</Text>;
  const first = new Date(data.days[0]!.date + 'T00:00:00');
  const lead = (first.getDay() + 6) % 7;
  const cells: (Cal['days'][number] | null)[] = [...Array(lead).fill(null), ...data.days];
  return (
    <View>
      <View style={s.calGrid}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <Text key={i} style={s.calHead}>{d}</Text>)}
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={s.calCell} />;
          const grey = d.kind === 'holiday' || d.kind === 'leave' || d.kind === 'sunday';
          const a = d.kind === 'work' ? 0.15 + 0.85 * Math.min(d.visits / data.max_visits, 1) : 0;
          const bg = grey ? '#e5e7eb' : d.kind === 'future' ? '#fff' : d.visits ? `rgba(46,125,50,${a})` : '#f1f5f9';
          return (
            <View key={i} style={[s.calCell, { backgroundColor: bg }]}>
              <Text style={{ fontSize: 11, color: a > 0.6 ? '#fff' : C.ink }}>{Number(d.date.slice(8))}</Text>
            </View>
          );
        })}
      </View>
      <Text style={s.sentence}>{data.sentence}</Text>
    </View>
  );
}

/* ------------------------------------------------------------- Score bars */
export function ScoreBars({ items, onOpen }: { items: Item[]; onOpen: (i: Item) => void }) {
  return (
    <View>
      {items.map((i) => (
        <View key={i.code} style={{ marginBottom: spacing.sm }} onTouchEnd={() => !i.skipped && onOpen(i)}>
          <View style={s.between}>
            <Text style={s.body}>{i.name}</Text>
            <Text style={s.bold}>{i.skipped ? 'Not counted' : `${num(i.marks)} / ${num(i.weight)}`}{i.at_max ? '  Max' : ''}</Text>
          </View>
          <View style={s.rail}><View style={[s.fill, { width: `${i.max_marks ? Math.min(i.marks / i.max_marks, 1) * 100 : 0}%`, backgroundColor: i.at_max ? C.done : C.track }]} /></View>
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------------- My best/Past */
export function MyBest() {
  const { data } = useDataFetch<{ items: { code: string; name: string; value: number; month: string }[] }>(
    () => apiClient.request('/kpi/me/best', 'GET', 'plan_submit'), []);
  if (!data) return <Text style={s.smallMuted}>Loading…</Text>;
  if (!data.items.length) return <Text style={s.body}>Your best months will show here after your first full month.</Text>;
  return (
    <View>
      {data.items.map((r) => (
        <View key={r.code} style={[s.between, { paddingVertical: 4 }]}>
          <Text style={s.body}>{r.name}</Text>
          <Text style={s.bold}>{fmt(r.code, r.value)} <Text style={s.smallMuted}>{r.month.slice(0, 7)}</Text></Text>
        </View>
      ))}
    </View>
  );
}

type PastRow = { period_id: string; start: string; score: number | null; grade: string | null; statement_status: string | null; final_amount_paise: number | null; waiting_for_figures: boolean };
export function PastList({ period }: { period: 'month' | 'quarter' }) {
  const { data } = useDataFetch<{ periods: PastRow[] }>(() => apiClient.request(`/kpi/me/past?period=${period}`, 'GET', 'plan_submit'), [period]);
  if (!data) return <Text style={s.smallMuted}>Loading…</Text>;
  if (!data.periods.length) return <Text style={s.body}>Nothing yet. Finished {period}s will be listed here.</Text>;
  return (
    <View>
      {data.periods.map((r) => (
        <View key={r.start} style={[s.between, { paddingVertical: 6 }]}>
          <Text style={s.body}>{r.start.slice(0, 7)}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.bold}>{r.score == null ? '–' : `${num(r.score)} marks`}{r.grade ? ` · Grade ${r.grade}` : ''}</Text>
            {r.final_amount_paise != null && r.statement_status ? <Text style={[s.small, { color: C.done }]}>{rupees(r.final_amount_paise)} · {({ draft: 'Closed', approved: 'Approved', paid: 'Paid' } as Record<string, string>)[r.statement_status] ?? r.statement_status}</Text> : null}
            {r.waiting_for_figures && <Text style={s.smallMuted}>Sales figures were not in</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  sentence: { fontSize: font.body, color: color.textSecondary, marginTop: spacing.sm },
  body: { fontSize: font.body, color: color.textPrimary, flexShrink: 1 },
  bold: { fontSize: font.body, color: color.textPrimary, fontWeight: fontWeight.semibold },
  small: { fontSize: font.caption, color: color.textPrimary },
  smallMuted: { fontSize: font.caption, color: color.textMuted },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  rail: { height: 10, borderRadius: 5, backgroundColor: C.rail, overflow: 'hidden', marginTop: 2 },
  fill: { height: 10, borderRadius: 5 },
  ladRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: 6, alignItems: 'stretch' },
  ladHead: { flex: 1, fontSize: font.caption, color: color.textMuted },
  lvl: { width: 34, borderRadius: radius.sm, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  lvlText: { fontWeight: fontWeight.bold, color: color.textPrimary },
  ladCell: { flex: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderLight, padding: 6 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calHead: { width: '14.28%', textAlign: 'center', fontSize: 10, color: color.textMuted, marginBottom: 2 },
  calCell: { width: '12.5%', margin: '0.9%', aspectRatio: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
