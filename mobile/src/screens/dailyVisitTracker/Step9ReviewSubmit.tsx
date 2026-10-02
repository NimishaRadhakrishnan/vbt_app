import React from 'react';
import { Text, View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { color, font, fontWeight, spacing, radius } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';

export type ReviewRow = { label: string; value: string };
export type ReviewSection = { title: string; stepIndex: number; rows: ReviewRow[] };

type Props = {
  sections: ReviewSection[];
  onEditStep: (stepIndex: number) => void;
  onSubmit: () => void;
  submitting: boolean;
};

// Section 25: a real summary built from the actual collected state (not
// a hardcoded mockup like the spec's own example table), grouped by step
// with an Edit link that jumps straight back to that step - not just
// "Back" through everything already reviewed.
export default function Step9ReviewSubmit({ sections, onEditStep, onSubmit, submitting }: Props) {
  return (
    <View>
      {sections.map((section) => (
        <View key={section.title} style={localStyles.card}>
          <View style={localStyles.cardHeader}>
            <Text style={localStyles.cardTitle}>{section.title}</Text>
            <TouchableOpacity onPress={() => onEditStep(section.stepIndex)}>
              <Text style={localStyles.editLink}>Edit</Text>
            </TouchableOpacity>
          </View>
          {section.rows.length === 0 ? (
            <Text style={styles.placeholderValue}>Nothing entered</Text>
          ) : (
            section.rows.map((row) => (
              <View key={row.label} style={localStyles.row}>
                <Text style={localStyles.rowLabel}>{row.label}</Text>
                <Text style={localStyles.rowValue}>{row.value}</Text>
              </View>
            ))
          )}
        </View>
      ))}

      <TouchableOpacity style={localStyles.submitBtn} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color={color.white} /> : <Text style={localStyles.submitBtnText}>Submit Visit</Text>}
      </TouchableOpacity>
    </View>
  );
}

const localStyles = StyleSheet.create({
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: color.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  cardTitle: {
    fontSize: font.body,
    fontWeight: fontWeight.bold,
    color: color.primary,
  },
  editLink: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.info,
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
  submitBtn: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
  },
  submitBtnText: {
    color: color.white,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
});
