import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type DataType = {
  key: string;
  label: string;
  parentKey?: string; // GET /master-data/<parentKey> for the parent picker
  parentLabel?: string;
};

// Mirrors master_data_router.py's 9 generically-handled tables exactly -
// same types the web admin console's Master Data page manages. Crops and
// Crop Varieties need a parent picked at create time (crop_category_id /
// crop_id respectively); everything else is a flat name+is_active row.
const DATA_TYPES: DataType[] = [
  { key: 'crop-categories', label: 'Crop Categories' },
  { key: 'crops', label: 'Crops', parentKey: 'crop-categories', parentLabel: 'Category' },
  { key: 'crop-varieties', label: 'Crop Varieties', parentKey: 'crops', parentLabel: 'Crop' },
  { key: 'pests', label: 'Pests' },
  { key: 'diseases', label: 'Diseases' },
  { key: 'chemicals', label: 'Chemicals' },
  { key: 'micronutrients', label: 'Micronutrients' },
  { key: 'farm-operations', label: 'Farm Operations' },
  { key: 'organic-solutions', label: 'Organic Solutions' },
];

type AdminItem = { id: string; name: string; is_active: boolean; parent_id?: string | null };
type SimpleItem = { id: string; name: string };

export default function AdminMasterDataScreen() {
  const [selected, setSelected] = useState<DataType>(DATA_TYPES[0]!);
  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: items, loading, error, retry } = useDataFetch<AdminItem[]>(
    () => apiClient.request(`/master-data/${selected.key}/admin`, 'GET', 'admin_action'),
    [selected.key]
  );

  const { data: parentOptions } = useDataFetch<SimpleItem[]>(
    () => (selected.parentKey ? apiClient.request(`/master-data/${selected.parentKey}`, 'GET', 'admin_action') : Promise.resolve([])),
    [selected.parentKey],
    { refetchOnFocus: false }
  );

  const addItem = async () => {
    if (!newName.trim()) {
      Alert.alert('Missing Name', 'Please enter a name.');
      return;
    }
    if (selected.parentKey && !newParentId) {
      Alert.alert('Missing Selection', `Please pick a ${selected.parentLabel}.`);
      return;
    }
    setAdding(true);
    try {
      await apiClient.request(`/master-data/${selected.key}`, 'POST', 'admin_action', {
        name: newName.trim(),
        parent_id: newParentId ?? undefined,
        is_active: true,
      });
      setNewName('');
      setNewParentId(null);
      retry();
    } catch (err: any) {
      Alert.alert('Could Not Add', err?.message ?? 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const toggleActive = async (item: AdminItem) => {
    setBusyId(item.id);
    try {
      await apiClient.request(`/master-data/${selected.key}/${item.id}`, 'PATCH', 'admin_action', {
        is_active: !item.is_active,
      });
      retry();
    } catch (err: any) {
      Alert.alert('Could Not Update', err?.message ?? 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeTabs} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        {DATA_TYPES.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.typeTab, selected.key === t.key && styles.typeTabActive]}
            onPress={() => {
              setSelected(t);
              setNewName('');
              setNewParentId(null);
            }}
          >
            <Text style={[styles.typeTabText, selected.key === t.key && styles.typeTabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          placeholder={`Add a new ${selected.label.toLowerCase().replace(/s$/, '')}`}
          value={newName}
          onChangeText={setNewName}
        />
        <TouchableOpacity style={styles.addBtn} onPress={addItem} disabled={adding}>
          {adding ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.addBtnText}>Add</Text>}
        </TouchableOpacity>
      </View>

      {selected.parentKey && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
          {(parentOptions ?? []).map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.parentChip, newParentId === p.id && styles.parentChipActive]}
              onPress={() => setNewParentId(p.id)}
            >
              <Text style={[styles.parentChipText, newParentId === p.id && styles.parentChipTextActive]}>{p.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !items || items.length === 0 ? (
        <EmptyState message={`No ${selected.label.toLowerCase()} yet.`} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={[styles.rowName, !item.is_active && styles.rowNameInactive]}>{item.name}</Text>
              <TouchableOpacity
                style={[styles.toggleBtn, { backgroundColor: item.is_active ? color.error : color.success }]}
                disabled={busyId === item.id}
                onPress={() => toggleActive(item)}
              >
                {busyId === item.id ? (
                  <ActivityIndicator color={color.white} size="small" />
                ) : (
                  <Text style={styles.toggleText}>{item.is_active ? 'Deactivate' : 'Activate'}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  typeTabs: { maxHeight: 52, marginTop: spacing.md },
  typeTab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    marginRight: spacing.sm,
    justifyContent: 'center',
  },
  typeTabActive: { backgroundColor: color.primary, borderColor: color.primary },
  typeTabText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textPrimary },
  typeTabTextActive: { color: color.white },
  addRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginTop: spacing.md },
  addInput: {
    flex: 1,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    marginRight: spacing.sm,
  },
  addBtn: { backgroundColor: color.primary, borderRadius: radius.sm, paddingHorizontal: spacing.lg, justifyContent: 'center', minWidth: 64, alignItems: 'center' },
  addBtnText: { color: color.white, fontWeight: fontWeight.bold },
  parentChip: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.sm,
    backgroundColor: color.cardBg,
  },
  parentChipActive: { backgroundColor: color.info, borderColor: color.info },
  parentChipText: { fontSize: font.caption, color: color.textPrimary },
  parentChipTextActive: { color: color.white, fontWeight: fontWeight.semibold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rowName: { fontSize: font.subtitle, color: color.textPrimary, flex: 1 },
  rowNameInactive: { color: color.textDisabled, textDecorationLine: 'line-through' },
  toggleBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, minWidth: 92, alignItems: 'center' },
  toggleText: { color: color.white, fontSize: font.caption, fontWeight: fontWeight.bold },
});
