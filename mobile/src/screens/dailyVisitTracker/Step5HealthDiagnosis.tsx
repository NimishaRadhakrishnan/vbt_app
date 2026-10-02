import React from 'react';
import { Text, View, TouchableOpacity, StyleSheet } from 'react-native';
import { color, font, fontWeight, spacing } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';
import { FieldRow, TextInputLike } from './FormFields';
import LinearScaleInput from '../../components/LinearScaleInput';
import type { MasterItem } from './types';

const CROP_STATUSES: { value: string; label: string; emoji: string }[] = [
  { value: 'healthy', label: 'Healthy', emoji: '✅' },
  { value: 'mild_stress', label: 'Mild Stress', emoji: '⚠️' },
  { value: 'pest_disease_affected', label: 'Pest/Disease Affected', emoji: '🐛' },
  { value: 'drought', label: 'Drought', emoji: '☀️' },
  { value: 'waterlogged', label: 'Waterlogged', emoji: '💧' },
  { value: 'nutrient_deficiency', label: 'Nutrient Deficiency', emoji: '🍃' },
  { value: 'other', label: 'Other', emoji: '❔' },
];

type ChemicalSel = Record<string, { quantity: string; frequency: string }>;

type Props = {
  cropStatus: string | null;
  setCropStatus: (v: string) => void;

  pestOptions: MasterItem[];
  selectedPestIds: string[];
  onTogglePest: (id: string) => void;

  diseaseOptions: MasterItem[];
  selectedDiseaseIds: string[];
  onToggleDisease: (id: string) => void;

  chemicalOptions: MasterItem[];
  selectedChemicals: ChemicalSel;
  onToggleChemical: (id: string) => void;
  setSelectedChemicals: React.Dispatch<React.SetStateAction<ChemicalSel>>;

  severity: number | null;
  setSeverity: (v: number) => void;

  statusOtherText: string;
  setStatusOtherText: (v: string) => void;
};

// Section 13/14/15/16: current crop status drives which fields appear
// below it. "Healthy" hides pest/disease/chemical/severity entirely
// (nothing to diagnose) rather than showing empty sections - matches the
// same reveal-only-what's-needed pattern already used for Trial and
// Advisory in earlier steps.
export default function Step5HealthDiagnosis({
  cropStatus,
  setCropStatus,
  pestOptions,
  selectedPestIds,
  onTogglePest,
  diseaseOptions,
  selectedDiseaseIds,
  onToggleDisease,
  chemicalOptions,
  selectedChemicals,
  onToggleChemical,
  setSelectedChemicals,
  severity,
  setSeverity,
  statusOtherText,
  setStatusOtherText,
}: Props) {
  const showDiagnosis = cropStatus === 'pest_disease_affected';
  const showStatusOther = cropStatus === 'other';

  return (
    <View>
      <FieldRow label="Current Crop Status">
        <View>
          {CROP_STATUSES.map((s) => (
            <TouchableOpacity
              key={s.value}
              style={[styles.radioCard, cropStatus === s.value && styles.radioCardActive]}
              onPress={() => setCropStatus(s.value)}
            >
              <Text style={localStyles.statusEmoji}>{s.emoji}</Text>
              <Text style={[styles.radioCardText, cropStatus === s.value && styles.radioCardTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </FieldRow>

      {showStatusOther && (
        <FieldRow label="Describe the crop status">
          <TextInputLike value={statusOtherText} onChangeText={setStatusOtherText} placeholder="e.g. Wind damage" />
        </FieldRow>
      )}

      {showDiagnosis && (
        <>
          <Text style={styles.sectionHeading}>Pest</Text>
          {pestOptions.length === 0 ? (
            <Text style={styles.placeholderValue}>Loading…</Text>
          ) : (
            <View style={styles.chipWrap}>
              {pestOptions.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, selectedPestIds.includes(p.id) && styles.chipActive]}
                  onPress={() => onTogglePest(p.id)}
                >
                  <Text style={[styles.chipText, selectedPestIds.includes(p.id) && styles.chipTextActive]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionHeading}>Disease</Text>
          {diseaseOptions.length === 0 ? (
            <Text style={styles.placeholderValue}>Loading…</Text>
          ) : (
            <View style={styles.chipWrap}>
              {diseaseOptions.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.chip, selectedDiseaseIds.includes(d.id) && styles.chipActive]}
                  onPress={() => onToggleDisease(d.id)}
                >
                  <Text style={[styles.chipText, selectedDiseaseIds.includes(d.id) && styles.chipTextActive]}>{d.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionHeading}>Chemicals Currently in Use</Text>
          {chemicalOptions.length === 0 ? (
            <Text style={styles.placeholderValue}>Loading…</Text>
          ) : (
            chemicalOptions.map((c) => {
              const sel = selectedChemicals[c.id];
              return (
                <View key={c.id} style={styles.multiSelectRow}>
                  <TouchableOpacity style={styles.checkRow} onPress={() => onToggleChemical(c.id)}>
                    <View style={[styles.checkbox, !!sel && styles.checkboxChecked]}>
                      {!!sel && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={styles.checkLabel}>{c.name}</Text>
                  </TouchableOpacity>
                  {sel && (
                    <View style={styles.inlineRow}>
                      <View style={{ flex: 1, marginRight: spacing.sm }}>
                        <TextInputLike
                          value={sel.quantity}
                          onChangeText={(v) => setSelectedChemicals((prev) => ({ ...prev, [c.id]: { ...prev[c.id], quantity: v } }))}
                          placeholder="Dosage"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <TextInputLike
                          value={sel.frequency}
                          onChangeText={(v) => setSelectedChemicals((prev) => ({ ...prev, [c.id]: { ...prev[c.id], frequency: v } }))}
                          placeholder="Frequency"
                        />
                      </View>
                    </View>
                  )}
                </View>
              );
            })
          )}

          <FieldRow label="Severity Level (1-10)">
            <LinearScaleInput
              value={severity}
              onChange={setSeverity}
              lowLabel="Not at all severe"
              highLabel="Extremely severe"
            />
          </FieldRow>
        </>
      )}
      {/* Per section 16: severity defaults to "not applicable" (null,
          not stored as 0) whenever status isn't Pest/Disease Affected -
          there's nothing to rate on a drought or waterlogged visit, and
          forcing a 0 would look like a real "no severity" measurement
          rather than "not asked". */}
    </View>
  );
}

const localStyles = StyleSheet.create({
  statusEmoji: {
    fontSize: font.subtitle,
    marginRight: spacing.md,
  },
});
