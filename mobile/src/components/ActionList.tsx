import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { color, font, fontWeight, spacing, radius } from '../theme';

export type ActionItem = {
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
};

/**
 * Compact list of things you can do here. Used where a section tab is a
 * launcher for an existing form or flow (register a farmer, start a visit)
 * rather than a list of records.
 */
export default function ActionList({ items, footer }: { items: ActionItem[]; footer?: string }) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={styles.card}>
        {items.map((item, i) => (
          <TouchableOpacity
            key={item.title}
            style={[styles.row, i === items.length - 1 && { borderBottomWidth: 0 }]}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={item.title}
          >
            <Ionicons name={item.icon as any} size={22} color={color.primary} style={{ width: 32 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={color.textDisabled} />
          </TouchableOpacity>
        ))}
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  title: { fontSize: font.subtitle, fontWeight: fontWeight.semibold, color: color.textPrimary },
  subtitle: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  footer: { fontSize: font.caption, color: color.textMuted, marginTop: spacing.md, textAlign: 'center' },
});
