import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Modal, TextInput, Alert, ActivityIndicator, ScrollView, Switch } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type MissingOfficer = { officer_id: string; officer_name: string; role: string };
type ClosureRow = {
  id: string;
  officer_name: string;
  date: string;
  farmer_name?: string | null;
  village?: string | null;
  crop_name?: string | null;
  crop_status?: string | null;
  demo_status?: string | null;
  purchased?: boolean | null;
  order_value?: number | null;
};

const TABS = ['missing', 'recent'] as const;
type TabKey = typeof TABS[number];

// Mirrors the web admin's Day Closure oversight: GET /day-closure/missing-
// today (who hasn't closed yet) and GET /day-closure (recent closures,
// already-submitted). Both are real admin/manager-only endpoints that
// existed before this fix but had no mobile screen reaching them.
//
// Edit/Delete added here to close a previously-flagged gap: the web
// dashboard could correct or remove a submitted closure (PUT/DELETE
// /admin/day-closures/{id}, admin-only) but this screen was read-only.
// The edit fields mirror exactly what the web edit modal sends - crop
// status, demo status, purchase + order value, conversion status - since
// GET /day-closure already returns crop_status/demo_status/purchased/
// order_value per row (day_closure_router.py's list_day_closures), the
// same data the web form pre-fills from.
export default function AdminDayClosureScreen() {
  const isAdmin = apiClient.getCurrentUser()?.role === 'admin';
  const [tab, setTab] = useState<TabKey>('missing');
  const [editingClosure, setEditingClosure] = useState<ClosureRow | null>(null);
  const [editForm, setEditForm] = useState({
    crop_status: '',
    demo_status: '',
    purchased: false,
    order_value: '',
    conversion_status: '',
  });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const missing = useDataFetch<MissingOfficer[]>(
    () => apiClient.request('/day-closure/missing-today', 'GET', 'admin_action'),
    []
  );
  // Only the last two weeks, newest first: asking for everything ever
  // recorded made this tab load for a long time.
  const recent = useDataFetch<ClosureRow[]>(() => {
    const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    return apiClient.request(`/day-closure?date_from=${from}&limit=200`, 'GET', 'admin_action');
  }, []);

  const active = tab === 'missing' ? missing : recent;

  const openEdit = (closure: ClosureRow) => {
    setEditingClosure(closure);
    setEditForm({
      crop_status: closure.crop_status || '',
      demo_status: closure.demo_status || '',
      purchased: !!closure.purchased,
      order_value: closure.order_value != null ? String(closure.order_value) : '',
      conversion_status: '',
    });
  };

  const saveEdit = async () => {
    if (!editingClosure) return;
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      if (editForm.crop_status) payload.crop_status = editForm.crop_status;
      if (editForm.demo_status) payload.demo_status = editForm.demo_status;
      payload.purchased = !!editForm.purchased;
      if (editForm.order_value !== '') payload.order_value = parseFloat(editForm.order_value);
      if (editForm.conversion_status) payload.conversion_status = editForm.conversion_status;

      await apiClient.request(`/admin/day-closures/${editingClosure.id}`, 'PUT', 'admin_action', payload);
      setEditingClosure(null);
      recent.retry();
    } catch (err: any) {
      Alert.alert('Could Not Save', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const deleteClosure = (closure: ClosureRow) => {
    Alert.alert(
      'Delete Day Closure',
      `Delete this day closure record for ${closure.officer_name} (${closure.date})?\n\nThis removes the closure record only; the underlying visit data (farmer, crop, sales history) is kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(closure.id);
            try {
              await apiClient.request(`/admin/day-closures/${closure.id}`, 'DELETE', 'admin_action');
              recent.retry();
            } catch (err: any) {
              Alert.alert('Could Not Delete', err?.message ?? 'Please try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, tab === 'missing' && styles.tabActive]} onPress={() => setTab('missing')}>
          <Text style={[styles.tabText, tab === 'missing' && styles.tabTextActive]}>Missing Today</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'recent' && styles.tabActive]} onPress={() => setTab('recent')}>
          <Text style={[styles.tabText, tab === 'recent' && styles.tabTextActive]}>Recent Closures</Text>
        </TouchableOpacity>
      </View>

      {active.loading ? (
        <LoadingState />
      ) : active.error ? (
        <ErrorState message={active.error} onRetry={active.retry} />
      ) : tab === 'missing' ? (
        !missing.data || missing.data.length === 0 ? (
          <EmptyState message="Everyone has submitted today's closure." />
        ) : (
          <FlatList
            data={missing.data}
            keyExtractor={(o) => o.officer_id}
            contentContainerStyle={{ padding: spacing.lg }}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.name}>{item.officer_name}</Text>
                <Text style={styles.meta}>{item.role.replace('_', ' ')} · no closure submitted yet</Text>
              </View>
            )}
          />
        )
      ) : !recent.data || recent.data.length === 0 ? (
        <EmptyState message="No day closures recorded yet." />
      ) : (
        <FlatList
          data={recent.data}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.name}>{item.officer_name}</Text>
              <Text style={styles.meta}>
                {item.date}{item.farmer_name ? ` · ${item.farmer_name}` : ''}{item.village ? ` (${item.village})` : ''}
              </Text>
              {!!item.crop_name && <Text style={styles.meta}>{item.crop_name}</Text>}
              {/* PUT/DELETE /admin/day-closures/{id} are admin-only on the
                  server (require_role(Role.ADMIN)); a manager can read
                  closures but those buttons would only ever 403. */}
              {isAdmin && (
              <View style={styles.cardActions}>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: color.info }]} onPress={() => openEdit(item)}>
                  <Text style={styles.actionBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: color.error }]}
                  disabled={busyId === item.id}
                  onPress={() => deleteClosure(item)}
                >
                  {busyId === item.id ? (
                    <ActivityIndicator color={color.white} size="small" />
                  ) : (
                    <Text style={styles.actionBtnText}>Delete</Text>
                  )}
                </TouchableOpacity>
              </View>
              )}
            </View>
          )}
        />
      )}

      <Modal visible={!!editingClosure} animationType="slide" transparent onRequestClose={() => setEditingClosure(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>
                Edit Day Closure{editingClosure ? ` — ${editingClosure.officer_name} (${editingClosure.date})` : ''}
              </Text>

              <Text style={styles.fieldLabel}>Crop Status</Text>
              <TextInput
                style={styles.input}
                value={editForm.crop_status}
                onChangeText={(v) => setEditForm((f) => ({ ...f, crop_status: v }))}
                placeholder="e.g. healthy, pest_damage, disease"
              />

              <Text style={styles.fieldLabel}>Demo Status</Text>
              <TextInput
                style={styles.input}
                value={editForm.demo_status}
                onChangeText={(v) => setEditForm((f) => ({ ...f, demo_status: v }))}
                placeholder="e.g. completed, scheduled"
              />

              <View style={styles.switchRow}>
                <Text style={styles.fieldLabel}>Purchased</Text>
                <Switch
                  value={editForm.purchased}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, purchased: v }))}
                />
              </View>

              <Text style={styles.fieldLabel}>Order Value</Text>
              <TextInput
                style={styles.input}
                value={editForm.order_value}
                onChangeText={(v) => setEditForm((f) => ({ ...f, order_value: v }))}
                keyboardType="numeric"
                placeholder="0"
              />

              <Text style={styles.fieldLabel}>Conversion Status</Text>
              <TextInput
                style={styles.input}
                value={editForm.conversion_status}
                onChangeText={(v) => setEditForm((f) => ({ ...f, conversion_status: v }))}
                placeholder="e.g. converted, pending, lost"
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: color.border }]} onPress={() => setEditingClosure(null)}>
                  <Text style={[styles.modalBtnText, { color: color.textPrimary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: color.primary }]} disabled={saving} onPress={saveEdit}>
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
  tabs: {
    flexDirection: 'row',
    backgroundColor: color.cardBg,
    margin: spacing.lg,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
  },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: 'center' },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary },
  tabTextActive: { color: color.white },
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
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  actionBtnText: { color: color.white, fontSize: font.caption, fontWeight: fontWeight.bold },
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
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  modalBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center' },
  modalBtnText: { color: color.white, fontWeight: fontWeight.bold },
});
