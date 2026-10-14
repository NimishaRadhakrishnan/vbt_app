import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { color, radius, spacing } from '../theme';

// Search field for long lists (products). Matches anywhere in the name,
// ignoring case and extra spaces.
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return true;
  const n = (name || '').toLowerCase();
  return q.split(' ').every((part) => n.includes(part));
}

export default function SearchBox({ value, onChangeText, placeholder = 'Search products…' }: { value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  return (
    <View style={styles.wrap}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {value.length > 0 && (
        <TouchableOpacity onPress={() => onChangeText('')} style={styles.clear} accessibilityLabel="Clear search">
          <Text style={styles.clearText}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  input: { flex: 1, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, backgroundColor: color.white, paddingVertical: 10, paddingHorizontal: 12, color: color.textPrimary },
  clear: { position: 'absolute', right: 10, padding: 6 },
  clearText: { color: color.textMuted, fontSize: 16 },
});
