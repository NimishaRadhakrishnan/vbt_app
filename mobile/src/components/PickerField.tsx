import React, { useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, fontWeight, spacing, radius } from '../theme';

export type PickerOption = { value: string; label: string };

/**
 * A labelled field that opens a searchable list. The first entry is always
 * "Any" and clears the choice. Used by filter panels with many long lists.
 */
export default function PickerField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = options.find((o) => o.value === value);
  const shown = options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));

  const close = () => {
    setOpen(false);
    setSearch('');
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={[styles.value, !current && styles.placeholder]} numberOfLines={1}>
          {current?.label ?? 'Any'}
        </Text>
        <Ionicons name="chevron-down" size={16} color={color.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <TouchableOpacity onPress={close} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={color.textPrimary} />
              </TouchableOpacity>
            </View>
            {options.length > 8 && (
              <TextInput style={styles.search} placeholder="Search" value={search} onChangeText={setSearch} />
            )}
            <FlatList
              data={[{ value: '', label: 'Any' }, ...shown]}
              keyExtractor={(o) => o.value || 'any'}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => {
                    onChange(item.value);
                    close();
                  }}
                >
                  <Text style={[styles.optionText, item.value === value && styles.optionActive]}>{item.label}</Text>
                  {item.value === value && <Ionicons name="checkmark" size={18} color={color.primary} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '48.5%', marginBottom: spacing.md },
  label: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginBottom: 4 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  value: { flex: 1, fontSize: font.body, color: color.textPrimary, marginRight: spacing.xs },
  placeholder: { color: color.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.cardBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '75%',
    paddingBottom: spacing.xl,
  },
  sheetHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  sheetTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  search: {
    margin: spacing.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  optionText: { fontSize: font.body, color: color.textPrimary },
  optionActive: { color: color.primary, fontWeight: fontWeight.bold },
});
