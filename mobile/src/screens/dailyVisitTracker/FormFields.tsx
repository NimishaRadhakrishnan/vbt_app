import React from 'react';
import { Text, View, TouchableOpacity, TextInput } from 'react-native';
import { color } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// Small reusable single-select chip row - used for crop category/crop/
// variety/crop-age-unit throughout Step 3, and for a handful of other
// small fixed-option fields in later steps. Not a real searchable
// dropdown (section 7 asks for "searchable dropdown" for crop name
// specifically) - with master data lists in the tens, not hundreds, of
// entries, a wrapped chip row stays usable without needing a search box;
// flagging this as a simplification rather than silently treating it as
// equivalent to what was asked for.
export function ChipPicker({
  options,
  value,
  onChange,
  emptyText,
  compact,
}: {
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string) => void;
  emptyText?: string;
  compact?: boolean;
}) {
  if (options.length === 0) {
    return <Text style={styles.placeholderValue}>{emptyText ?? 'No options available'}</Text>;
  }
  return (
    <View style={styles.chipWrap}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.chip, compact && styles.chipCompact, value === opt.value && styles.chipActive]}
          onPress={() => onChange(opt.value)}
        >
          <Text style={[styles.chipText, value === opt.value && styles.chipTextActive]}>{opt.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// Minimal styled text-input wrapper shared by every step.
export function TextInputLike({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad';
  maxLength?: number;
}) {
  return (
    <TextInput
      style={styles.textInput}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={color.textMuted}
      keyboardType={keyboardType ?? 'default'}
      maxLength={maxLength}
    />
  );
}
