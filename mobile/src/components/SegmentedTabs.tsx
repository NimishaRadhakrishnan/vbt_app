import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { color, font, fontWeight, spacing } from '../theme';

type Tab = { id: string; label: string };

/** Compact tab strip under the header: the tabs of one section. */
export default function SegmentedTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (tabs.length < 2) return null;
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => onSelect(t.id)}
              style={[styles.tab, active && styles.tabActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.label, active && styles.labelActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: color.cardBg, borderBottomWidth: 1, borderBottomColor: color.border },
  row: { paddingHorizontal: spacing.sm },
  tab: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: color.primary },
  label: { fontSize: font.body, color: color.textSecondary, fontWeight: fontWeight.semibold },
  labelActive: { color: color.primary },
});
