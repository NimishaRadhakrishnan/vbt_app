import React, { useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type Row = [string, any];

const HIDDEN_KEYS = new Set(['id', 'visit_id', 'created_at', 'updated_at', 'is_deleted']);

const pretty = (key: string) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const titleCase = (v: any) =>
  typeof v === 'string' ? v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : v;

const yesNo = (v: any) => (v ? 'Yes' : 'No');

/** Every filled-in column of a record, labelled. For tables whose columns vary. */
function rowsOf(record: Record<string, any> | null | undefined): Row[] {
  if (!record) return [];
  return Object.entries(record)
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== '')
    .map(([k, v]) => [pretty(k), typeof v === 'boolean' ? yesNo(v) : titleCase(v)] as Row);
}

const joinNames = (items: any[] | undefined, fmt: (i: any) => string) => (items ?? []).map(fmt).join('; ');

// The full report of one visit, as an admin or manager sees it on the web:
// officer, visit, farmer, crop, inputs, crop health, trial, sales, follow-up
// and photos. Sections with nothing recorded say so instead of vanishing.
export default function AdminVisitDetailScreen({ route }: any) {
  const { visitId } = route.params;
  const [photo, setPhoto] = useState<string | null>(null);

  const { data: detail, loading, error, retry } = useDataFetch<any>(
    () => apiClient.request(`/admin/daily-visits/${visitId}`, 'GET', 'admin_action'),
    [visitId],
    { refetchOnFocus: false },
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!detail) return <EmptyState message="This visit could not be found." />;

  const crop = detail.crop ?? {};
  const inputs = detail.inputs ?? {};
  const health = detail.health ?? {};
  const trial = detail.trial ?? {};
  const sales = detail.sales ?? {};
  const photos: any[] = detail.photos ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2 }}>
      <Section title="Officer" rows={[
        ['Name', detail.officer?.name],
        ['Employee ID', detail.officer?.employee_id],
        ['Manager', detail.officer?.manager],
        ['District', detail.officer?.district],
      ]} />
      <Section title="Visit" rows={[
        ['Visit ID', detail.visit?.visit_id],
        ['Date', detail.visit?.date],
        ['Time', detail.visit?.time?.slice(0, 8)],
        ['Village/Block', detail.visit?.village_block],
        ['GPS', detail.visit?.gps ? `${detail.visit.gps.lat}, ${detail.visit.gps.lng}` : null],
      ]} />
      <Section title="Farmer" rows={[
        ['Name', detail.farmer?.name],
        ['Contact', detail.farmer?.phone],
        ['Farm Size', detail.farmer?.farm_size],
      ]} />
      <Section title="Crop" rows={[
        ['Category', crop.crop_category],
        ['Crop', crop.crop_name],
        ['Variety', crop.variety_name ?? crop.variety_text],
        ['Farming Type', titleCase(crop.farming_type)],
        ['Age', crop.crop_age_value ? `${crop.crop_age_value} ${crop.crop_age_unit ?? ''}`.trim() : null],
        ['Sowing Date', crop.sowing_date],
        ['Previous Crop', crop.previous_crop_text],
        ['Previous Yield', crop.previous_yield_value ? `${crop.previous_yield_value} ${crop.previous_yield_unit ?? ''}`.trim() : null],
      ]} />
      <Section title="Fertiliser (NPK)" rows={rowsOf(inputs.npk)} hideWhenEmpty />
      <Section title="Micronutrients" rows={[
        ['Applied', joinNames(inputs.micronutrients, (m) => `${m.name}${m.quantity ? ` ${m.quantity}${m.unit ? ` ${m.unit}` : ''}` : ''}`)],
      ]} hideWhenEmpty />
      <Section title="Farm Operations" rows={[
        ['Done', joinNames(inputs.farm_operations, (o) => `${o.name}${o.performed_date ? ` (${o.performed_date})` : ''}${o.remarks ? `: ${o.remarks}` : ''}`)],
      ]} hideWhenEmpty />
      <Section title="Organic / IPM" rows={[
        ['Used', joinNames(inputs.organic_solutions, (s) => `${s.name}${s.quantity ? ` ${s.quantity}${s.unit ? ` ${s.unit}` : ''}` : ''}${s.application_date ? ` (${s.application_date})` : ''}${s.remarks ? `: ${s.remarks}` : ''}`)],
      ]} hideWhenEmpty />
      <Section title="Advisory" rows={rowsOf(inputs.advisory)} hideWhenEmpty />
      <Section title="Crop Health" rows={[
        ['Status', titleCase(health.status)],
        ['Severity', titleCase(health.severity)],
        ['Pests', (health.pests ?? []).join(', ')],
        ['Diseases', (health.diseases ?? []).join(', ')],
        ['Chemicals', joinNames(health.chemicals, (c) => `${c.name}${c.quantity ? ` ${c.quantity}` : ''}${c.frequency ? `, ${c.frequency}` : ''}`)],
      ]} />
      <Section title="Trial / Demo" rows={[
        ['Trial', yesNo(trial.is_trial)],
        ['Purpose', titleCase(trial.purpose)],
        ['Demo Status', titleCase(trial.demo_status)],
        ['Plot Size', trial.plot_size_cents ? `${trial.plot_size_cents} cents` : null],
        ['Products', joinNames(trial.products, (p) => `${p.product_name} (given ${p.quantity_given}, left ${p.quantity_leftover})`)],
      ]} />
      <Section title="Sales" rows={[
        ['Purchased', yesNo(sales.purchased)],
        ['Order Value', sales.order_value ? `₹${sales.order_value}` : null],
        ['Conversion Status', titleCase(sales.conversion_status)],
        ['Products Bought', joinNames(detail.sale_items, (i) => `${i.product_name} x${i.quantity}${i.unit ? ` ${i.unit}` : ''}`)],
      ]} />
      <Section title="Remarks" rows={[
        ['Officer Remarks', detail.remarks?.officer_remarks],
        ['Follow-up Date', detail.remarks?.follow_up_date],
        ['Follow-up Remarks', detail.remarks?.follow_up_remarks],
      ]} />

      {photos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Photos</Text>
          <View style={styles.photoRow}>
            {photos.map((p, i) => (
              <TouchableOpacity key={i} onPress={() => setPhoto(apiClient.fileUrl(p.photo_url) ?? null)} activeOpacity={0.8}>
                <Image source={{ uri: apiClient.fileUrl(p.photo_url) }} style={styles.photo} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <Modal visible={!!photo} transparent animationType="fade" onRequestClose={() => setPhoto(null)}>
        <TouchableOpacity style={styles.viewer} activeOpacity={1} onPress={() => setPhoto(null)}>
          {!!photo && <Image source={{ uri: photo }} style={styles.viewerImage} resizeMode="contain" />}
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

function Section({ title, rows, hideWhenEmpty }: { title: string; rows: Row[]; hideWhenEmpty?: boolean }) {
  const visible = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (visible.length === 0 && hideWhenEmpty) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {visible.length === 0 ? (
        <Text style={styles.empty}>Nothing recorded</Text>
      ) : (
        visible.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{String(value)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  section: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: color.border,
  },
  sectionTitle: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.primary, marginBottom: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  rowLabel: { fontSize: font.caption, color: color.textSecondary, flex: 2 },
  rowValue: { fontSize: font.caption, color: color.textPrimary, fontWeight: fontWeight.semibold, flex: 3, textAlign: 'right' },
  empty: { fontSize: font.caption, color: color.textMuted },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap' },
  photo: { width: 96, height: 96, borderRadius: radius.sm, marginRight: spacing.sm, marginBottom: spacing.sm, backgroundColor: color.borderLight },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
});
