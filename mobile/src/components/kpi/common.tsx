import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font, fontWeight, radius, spacing } from '../../theme';

/** Colours: green = done, blue = on track, amber = needs a push. Never red. */
export const C = { done: '#2e7d32', track: '#1565c0', push: '#ef6c00', rail: '#e5e7eb', ink: '#333333', muted: '#6c6c6c' };

export type Item = {
  code: string; name: string; help: string | null; unit: string | null; weight: number; marks: number; max_marks: number;
  skipped: boolean; at_max: boolean; done: number; goal: number; pct: number | null; left: number; extra: number;
};
export type LadderRow = {
  level: number; sales_needed_paise: number; collection_needed_paise: number;
  incentive_at_sales_level_paise: number; incentive_at_collection_level_paise: number;
};
export type Overview = {
  period: { type: 'month' | 'quarter'; start: string; end: string; status: string; days_total: number; days_left: number; working_days_left: number };
  mode: 'field' | 'sales' | 'both'; ready: boolean; advice: string;
  field?: { score: number; items: Item[]; trial_funnel: { visited: number; agreed_demo: number; trials: number; paid: number; waiting: number } };
  sales?: {
    score: number; items: Item[]; waiting_for_figures: boolean;
    incentive?: { sales_level: number; collection_level: number; level_match_applied: boolean; earned_so_far_paise: number };
    what_if?: { message: string | null };
    ladder?: { rows: LadderRow[]; sales_level: number; collection_level: number; level_match_applied: boolean } | null;
  };
};

export const elapsedShare = (p: Overview['period']) =>
  Math.min(1, Math.max(0, (p.days_total - p.days_left) / Math.max(p.days_total, 1)));
export function status(pct: number | null, elapsed: number): 'done' | 'track' | 'push' {
  if (pct == null) return 'track';
  if (pct >= 1) return 'done';
  return pct >= elapsed * 0.9 ? 'track' : 'push';
}
export const colorOf = (s: 'done' | 'track' | 'push') => C[s];

export const rupees = (paise: number) => '₹' + Math.round(paise / 100).toLocaleString('en-IN');
export const num = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
export const fmt = (code: string, v: number) =>
  code === 'sales_done' || code === 'money_collected' ? '₹' + Math.round(v).toLocaleString('en-IN')
    : code === 'trial_to_paid' ? `${Math.round(v)}%` : num(v);
export function itemLine(i: Item, p: Overview['period']) {
  const rest = i.extra > 0 ? `${fmt(i.code, i.extra)} extra` : `${fmt(i.code, i.left)} left`;
  return `${fmt(i.code, i.done)} of ${fmt(i.code, i.goal)} done · ${rest} · ${p.days_left} day${p.days_left === 1 ? '' : 's'} left`;
}

/** A straight line between two points, drawn with one rotated View (no native chart library needed). */
export function Seg({ x1, y1, x2, y2, c, w = 2, dashed = false }: { x1: number; y1: number; x2: number; y2: number; c: string; w?: number; dashed?: boolean }) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.max(Math.hypot(dx, dy), 0.1);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute', left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - w / 2, width: len, height: w,
        backgroundColor: dashed ? 'transparent' : c, borderTopWidth: dashed ? w : 0, borderColor: c,
        borderStyle: dashed ? 'dashed' : 'solid', transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
}

/** Ring made of 40 small ticks around a circle; the done share is coloured. */
export function Ring({ pct, c, size = 72 }: { pct: number; c: string; size?: number }) {
  const N = 40, r = size / 2 - 6, filled = Math.round(Math.min(Math.max(pct, 0), 1) * N);
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`${Math.round(pct * 100)} percent`}>
      {Array.from({ length: N }).map((_, k) => (
        <View
          key={k}
          style={{
            position: 'absolute', left: size / 2 - 2, top: size / 2 - 5, width: 4, height: 10, borderRadius: 2,
            backgroundColor: k < filled ? c : C.rail,
            transform: [{ rotate: `${(k * 360) / N}deg` }, { translateY: -r }],
          }}
        />
      ))}
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: size / 4.6, fontWeight: fontWeight.bold, color: C.ink }}>{Math.round(pct * 100)}%</Text>
      </View>
    </View>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}
export const Sentence = ({ children }: { children: React.ReactNode }) => <Text style={s.sentence}>{children}</Text>;

const s = StyleSheet.create({
  panel: { backgroundColor: color.cardBg, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  panelTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginBottom: spacing.sm },
  sentence: { fontSize: font.body, color: color.textSecondary, marginTop: spacing.sm },
});
