import { StyleSheet } from 'react-native';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Styles reused across 3+ of the Daily Visit Tracker's step components
// (field rows, chips, checkboxes, radio cards, the shared text input).
// Each step file may still define a handful of its own one-off styles,
// but anything used by more than one step lives here so the 9 step files
// don't each redefine the same field-row/chip/checkbox look independently
// and drift apart the way the app's original 44-color sprawl did before
// the theme migration.
export const sharedStyles = StyleSheet.create({
  fieldRow: {
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    marginBottom: spacing.xs,
  },
  readonlyValue: {
    fontSize: font.body,
    color: color.textPrimary,
    fontWeight: fontWeight.semibold,
  },
  placeholderValue: {
    fontSize: font.body,
    color: color.textMuted,
    fontStyle: 'italic',
  },
  textInput: {
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    color: color.textPrimary,
  },
  errorText: {
    fontSize: font.caption,
    color: color.error,
    marginTop: spacing.xs,
    fontWeight: fontWeight.semibold,
  },
  inlineRow: {
    flexDirection: 'row',
  },
  sectionHeading: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipCompact: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  chipActive: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  chipText: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
  },
  chipTextActive: {
    color: color.white,
  },
  modeToggle: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  modeChip: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
  },
  modeChipActive: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  modeChipText: {
    fontSize: font.body,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
  },
  modeChipTextActive: {
    color: color.white,
  },
  radioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    backgroundColor: color.cardBg,
    marginBottom: spacing.sm,
  },
  radioCardActive: {
    borderColor: color.primary,
    backgroundColor: color.primaryPale,
  },
  radioDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: color.border,
    marginRight: spacing.md,
  },
  radioDotActive: {
    borderColor: color.primary,
    backgroundColor: color.primary,
  },
  radioCardText: {
    fontSize: font.body,
    color: color.textPrimary,
  },
  radioCardTextActive: {
    fontWeight: fontWeight.semibold,
  },
  multiSelectRow: {
    marginBottom: spacing.md,
    backgroundColor: color.cardBg,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: color.border,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: color.border,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  checkmark: {
    color: color.white,
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
  },
  checkLabel: {
    fontSize: font.body,
    color: color.textPrimary,
  },
});
