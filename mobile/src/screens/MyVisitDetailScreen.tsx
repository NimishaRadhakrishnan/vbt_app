import React from 'react';
import { StyleSheet, Text, View, ScrollView, Image } from 'react-native';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

// Read-only detail view for a single visit the officer already submitted
// (section 28: "allow the officer to open a visit and view its details.
// Do not allow editing submitted records unless the existing permission
// rules permit it" - no such rule exists in this codebase, so this is
// deliberately view-only, no edit path). Reuses the same
// GET /visits/daily-tracker/{visit_id} response shape the admin detail
// panel already consumes, just rendered plainly instead of in a slide-in
// panel.
export default function MyVisitDetailScreen({ route }: any) {
  const { visitId } = route.params;

  const { data: detail, loading, error, retry } = useDataFetch<any>(
    () => apiClient.request(`/visits/daily-tracker/${visitId}`, 'GET', 'plan_submit'),
    [visitId],
    { refetchOnFocus: false }
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!detail) return <EmptyState message="This visit could not be found." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <Section title="Visit" rows={[
        ['Date', detail.visit?.date],
        ['Time', detail.visit?.time],
        ['Village/Block', detail.visit?.village_block],
      ]} />
      <Section title="Farmer" rows={[
        ['Name', detail.farmer?.name],
        ['Contact', detail.farmer?.phone],
        ['Farm Size', detail.farmer?.farm_size],
      ]} />
      <Section title="Crop" rows={[
        ['Category', detail.crop?.crop_category],
        ['Crop', detail.crop?.crop_name],
        ['Variety', detail.crop?.variety_name ?? detail.crop?.variety_text],
        ['Farming Type', detail.crop?.farming_type],
      ]} />
      <Section title="Crop Health" rows={[
        ['Status', detail.health?.status],
        ['Severity', detail.health?.severity],
        ['Pests', (detail.health?.pests ?? []).join(', ')],
        ['Diseases', (detail.health?.diseases ?? []).join(', ')],
      ]} />
      {detail.trial?.is_trial && (
        <Section title="Trial / Demo" rows={[
          ['Purpose', detail.trial?.purpose],
          ['Status', detail.trial?.demo_status],
          ['Plot Size', detail.trial?.plot_size_cents ? `${detail.trial.plot_size_cents} cents` : null],
          ['Products', (detail.trial?.products ?? []).map((p: any) => `${p.product_name} (given ${p.quantity_given}, left ${p.quantity_leftover})`).join('; ')],
        ]} />
      )}
      <Section title="Sales" rows={[
        ['Purchased', detail.sales?.purchased ? 'Yes' : 'No'],
        ['Order Value', detail.sales?.order_value ? `₹${detail.sales.order_value}` : null],
        ['Conversion Status', detail.sales?.conversion_status],
      ]} />
      <Section title="Remarks" rows={[
        ['Officer Remarks', detail.remarks?.officer_remarks],
        ['Follow-up Date', detail.remarks?.follow_up_date],
        ['Follow-up Remarks', detail.remarks?.follow_up_remarks],
      ]} />
      {detail.photos?.length > 0 && (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <View style={styles.photoRow}>
            {detail.photos.map((p: any, i: number) => (
              <Image key={i} source={{ uri: p.photo_url }} style={styles.photo} />
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

function Section({ title, rows }: { title: string; rows: [string, any][] }) {
  const visible = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (visible.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {visible.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowValue}>{String(value)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  section: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: color.border,
  },
  sectionTitle: {
    fontSize: font.body,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  rowLabel: {
    fontSize: font.caption,
    color: color.textSecondary,
    flex: 1,
  },
  rowValue: {
    fontSize: font.caption,
    color: color.textPrimary,
    fontWeight: fontWeight.semibold,
    flex: 1,
    textAlign: 'right',
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  photo: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
});
