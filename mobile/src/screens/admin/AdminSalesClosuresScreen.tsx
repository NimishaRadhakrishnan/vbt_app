import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Modal, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type SalesClosure = {
  closure_id: string;
  officer_name: string;
  date: string;
  district?: string | null;
  dealer_name?: string | null;
  village?: string | null;
  amount_collected?: number | null;
  order_value?: number | null;
  remarks?: string | null;
};

// Mirrors the web dashboard's Sales Day Closures tab for admin/manager:
// GET /day-closure/sales (list, admin+manager) and PUT /day-closure/
// sales/{closure_id} (edit, admin-only - the backend itself refuses this
// for manager, so the Edit button only renders for admin here, matching
// the same restriction rather than offering a button that would 403).
// This closes a web/mobile gap - previously there was no mobile screen
// reaching these endpoints at all. Edit fields match the web edit form
// exactly (dealer_name, district, amount_collected, remarks) - these are
// the only fields the web dashboard itself allows correcting.
export default function AdminSalesClosuresScreen() {
  const currentUserRole = apiClient.getCurrentUser()?.role;
  const [editing, setEditing] = useState<SalesClosure | null>(null);
  const [form, setForm] = useState({ dealer_name: '', district: '', amount_collected: '', remarks: '' });
  const [saving, setSaving] = useState(false);
  const canEdit = currentUserRole === 'admin';

  const { data, loading, error, retry } = useDataFetch<SalesClosure[]>(
    () => apiClient.request('/day-closure/sales', 'GET', 'admin_action'),
    []
  );

  const openEdit = (c: SalesClosure) => {
    setEditing(c);
    setForm({
      dealer_name: c.dealer_name || '',
      district: c.district || '',
      amount_collected: c.amount_collected != null ? String(c.amount_collected) : '',
      remarks: c.remarks || '',
    });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        dealer_name: form.dealer_name,
        district: form.district,
        remarks: form.remarks,
      };
      if (form.amount_collected !== '') payload.amount_collected = parseFloat(form.amount_collected);
      await apiClient.request(`/day-closure/sales/${editing.closure_id}`, 'PUT', 'admin_action', payload);
      setEditing(null);
      retry();
    } catch (err: any) {
      Alert.alert('Could Not Save', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !data || data.length === 0 ? (
        <EmptyState message="No sales closures recorded yet." />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.closure_id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.name}>{item.officer_name}</Text>
              <Text style={styles.meta}>
                {item.date}{item.dealer_name ? ` · ${item.dealer_name}` : ''}{item.district ? ` (${item.district})` : ''}
              </Text>
              {item.amount_collected != null && <Text style={styles.meta}>Collected: {item.amount_collected}</Text>}
              {canEdit && (
                <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
                  <Text style={styles.editBtnText}>Edit</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>
                Edit Sales Closure{editing ? ` — ${editing.officer_name} (${editing.date})` : ''}
              </Text>

              <Text style={styles.fieldLabel}>Dealer Name</Text>
              <TextInput style={styles.input} value={form.dealer_name} onChangeText={(v) => setForm((f) => ({ ...f, dealer_name: v }))} />

              <Text style={styles.fieldLabel}>District</Text>
              <TextInput style={styles.input} value={form.district} onChangeText={(v) => setForm((f) => ({ ...f, district: v }))} />

              <Text style={styles.fieldLabel}>Amount Collected</Text>
              <TextInput
                style={styles.input}
                value={form.amount_collected}
                onChangeText={(v) => setForm((f) => ({ ...f, amount_collected: v }))}
                keyboardType="numeric"
              />

              <Text style={styles.fieldLabel}>Remarks</Text>
              <TextInput
                style={[styles.input, { height: 80 }]}
                value={form.remarks}
                onChangeText={(v) => setForm((f) => ({ ...f, remarks: v }))}
                multiline
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: color.border }]} onPress={() => setEditing(null)}>
                  <Text style={[styles.modalBtnText, { color: color.textPrimary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: color.primary }]} disabled={saving} onPress={save}>
                  {saving ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.modalBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  editBtn: { alignSelf: 'flex-start', backgroundColor: color.info, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.sm, marginTop: spacing.md },
  editBtnText: { color: color.white, fontSize: font.caption, fontWeight: fontWeight.bold },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: color.cardBg, borderRadius: radius.md, padding: spacing.lg, maxHeight: '85%' },
  modalTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginBottom: spacing.lg },
  fieldLabel: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginTop: spacing.md, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    color: color.textPrimary,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  modalBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center' },
  modalBtnText: { color: color.white, fontWeight: fontWeight.bold },
});
