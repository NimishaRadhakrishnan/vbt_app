import React, { useState } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, StaleDataBanner } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

type KpiSummary = {
  month: string;
  farmers_covered: number;
  demos_conducted: number;
  cents_covered: number;
  conversions: number;
  villages_covered: number;
};

function currentMonthISO(offset = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Section 5: the structured visit-KPI rollup - farmers/demos/villages/
// cents/conversions for the month, pulled straight from /visits/kpi-summary
// now that visits carry these as real columns instead of a free-text
// daily report.
export default function KpiSummaryScreen() {
  const [monthOffset, setMonthOffset] = useState(0);
  const month = currentMonthISO(monthOffset);

  const { data, loading, error, isStale, retry } = useDataFetch<KpiSummary>(
    () => apiClient.request(`/visits/kpi-summary?month=${month}`, 'GET', 'plan_submit'),
    [month]
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setMonthOffset((o) => o - 1)} style={styles.navBtn}>
          <Text style={styles.navBtnText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel(month)}</Text>
        <TouchableOpacity
          onPress={() => setMonthOffset((o) => Math.min(0, o + 1))}
          style={styles.navBtn}
          disabled={monthOffset >= 0}
        >
          <Text style={[styles.navBtnText, monthOffset >= 0 && styles.navBtnDisabled]}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      {isStale && <StaleDataBanner onRetry={retry} />}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : (
        <View style={styles.grid}>
          <KpiCard label="Farmers Covered" value={data?.farmers_covered ?? 0} color="#e8f5e9" />
          <KpiCard label="Demos Conducted" value={data?.demos_conducted ?? 0} color="#e0f2f1" />
          <KpiCard label="Villages Covered" value={data?.villages_covered ?? 0} color="#f1f8e9" />
          <KpiCard label="Cents Covered" value={data?.cents_covered ?? 0} color="#efebe9" />
          <KpiCard label="Conversions" value={data?.conversions ?? 0} color="#fbe9e7" wide />
        </View>
      )}
    </ScrollView>
  );
}

function KpiCard({ label, value, color, wide }: { label: string; value: number; color: string; wide?: boolean }) {
  return (
    <View style={[styles.card, { backgroundColor: color }, wide && styles.cardWide]}>
      <Text style={styles.cardValue}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: color.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  navBtn: {
    padding: spacing.sm,
  },
  navBtnText: {
    color: color.white,
    fontSize: font.title,
    fontWeight: fontWeight.bold,
  },
  navBtnDisabled: {
    color: 'rgba(255,255,255,0.3)',
  },
  monthLabel: {
    color: color.white,
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
  },
  grid: {
    padding: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  card: {
    width: '48%',
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
  },
  cardWide: {
    width: '100%',
  },
  cardValue: {
    fontSize: font.heading,
    fontWeight: fontWeight.bold,
    color: color.primary,
  },
  cardLabel: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: 6,
    textAlign: 'center',
  },
});
