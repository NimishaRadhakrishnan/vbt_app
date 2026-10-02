import React from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { spacing } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';
import { FieldRow, TextInputLike, ChipPicker } from './FormFields';
import type { MasterItem } from './types';

type MicronutrientSel = Record<string, { quantity: string; unit: string }>;
type FarmOperationSel = Record<string, { date: string; remarks: string }>;
type OrganicSolutionSel = Record<string, { quantity: string; unit: string; remarks: string }>;

type Props = {
  npkN: string; setNpkN: (v: string) => void;
  npkP: string; setNpkP: (v: string) => void;
  npkK: string; setNpkK: (v: string) => void;
  npkUnit: string; setNpkUnit: (v: string) => void;
  npkFrequency: string; setNpkFrequency: (v: string) => void;

  micronutrientOptions: MasterItem[];
  selectedMicronutrients: MicronutrientSel;
  onToggleMicronutrient: (id: string) => void;
  setSelectedMicronutrients: React.Dispatch<React.SetStateAction<MicronutrientSel>>;

  farmOperationOptions: MasterItem[];
  selectedFarmOperations: FarmOperationSel;
  onToggleFarmOperation: (id: string) => void;
  setSelectedFarmOperations: React.Dispatch<React.SetStateAction<FarmOperationSel>>;

  organicSolutionOptions: MasterItem[];
  selectedOrganicSolutions: OrganicSolutionSel;
  onToggleOrganicSolution: (id: string) => void;
  setSelectedOrganicSolutions: React.Dispatch<React.SetStateAction<OrganicSolutionSel>>;

  usedAdvisory: boolean | null;
  setUsedAdvisory: (v: boolean) => void;
  onClearAdvisorySource: () => void;
  advisorySource: 'agri_clinic' | 'kvk' | 'other' | null;
  setAdvisorySource: (v: 'agri_clinic' | 'kvk' | 'other') => void;
  advisoryRemarks: string;
  setAdvisoryRemarks: (v: string) => void;
};

export default function Step4FarmPractices({
  npkN, setNpkN, npkP, setNpkP, npkK, setNpkK, npkUnit, setNpkUnit, npkFrequency, setNpkFrequency,
  micronutrientOptions, selectedMicronutrients, onToggleMicronutrient, setSelectedMicronutrients,
  farmOperationOptions, selectedFarmOperations, onToggleFarmOperation, setSelectedFarmOperations,
  organicSolutionOptions, selectedOrganicSolutions, onToggleOrganicSolution, setSelectedOrganicSolutions,
  usedAdvisory, setUsedAdvisory, onClearAdvisorySource, advisorySource, setAdvisorySource, advisoryRemarks, setAdvisoryRemarks,
}: Props) {
  return (
    <View>
      <Text style={styles.sectionHeading}>Nutrients — NPK</Text>
      <View style={styles.inlineRow}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <TextInputLike value={npkN} onChangeText={setNpkN} placeholder="N" keyboardType="numeric" />
        </View>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <TextInputLike value={npkP} onChangeText={setNpkP} placeholder="P" keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <TextInputLike value={npkK} onChangeText={setNpkK} placeholder="K" keyboardType="numeric" />
        </View>
      </View>
      {(npkN || npkP || npkK) && (
        <View style={{ marginTop: spacing.sm }}>
          <ChipPicker options={['kg', 'g', 'L'].map((u) => ({ value: u, label: u }))} value={npkUnit} onChange={setNpkUnit} compact />
          <TextInputLike value={npkFrequency} onChangeText={setNpkFrequency} placeholder="Frequency (e.g. once a week)" />
        </View>
      )}

      <Text style={styles.sectionHeading}>Micronutrients</Text>
      {micronutrientOptions.length === 0 ? (
        <Text style={styles.placeholderValue}>Loading…</Text>
      ) : (
        micronutrientOptions.map((m) => {
          const sel = selectedMicronutrients[m.id];
          return (
            <View key={m.id} style={styles.multiSelectRow}>
              <TouchableOpacity style={styles.checkRow} onPress={() => onToggleMicronutrient(m.id)}>
                <View style={[styles.checkbox, !!sel && styles.checkboxChecked]}>
                  {!!sel && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkLabel}>{m.name}</Text>
              </TouchableOpacity>
              {sel && (
                <View style={styles.inlineRow}>
                  <View style={{ flex: 1, marginRight: spacing.sm }}>
                    <TextInputLike
                      value={sel.quantity}
                      onChangeText={(v) => setSelectedMicronutrients((prev) => ({ ...prev, [m.id]: { ...prev[m.id], quantity: v } }))}
                      placeholder="Qty"
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextInputLike
                      value={sel.unit}
                      onChangeText={(v) => setSelectedMicronutrients((prev) => ({ ...prev, [m.id]: { ...prev[m.id], unit: v } }))}
                      placeholder="Unit"
                    />
                  </View>
                </View>
              )}
            </View>
          );
        })
      )}

      <Text style={styles.sectionHeading}>Farm Operations</Text>
      {farmOperationOptions.length === 0 ? (
        <Text style={styles.placeholderValue}>Loading…</Text>
      ) : (
        farmOperationOptions.map((op) => {
          const sel = selectedFarmOperations[op.id];
          return (
            <View key={op.id} style={styles.multiSelectRow}>
              <TouchableOpacity style={styles.checkRow} onPress={() => onToggleFarmOperation(op.id)}>
                <View style={[styles.checkbox, !!sel && styles.checkboxChecked]}>
                  {!!sel && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkLabel}>{op.name}</Text>
              </TouchableOpacity>
              {sel && (
                <View>
                  <TextInputLike
                    value={sel.date}
                    onChangeText={(v) => setSelectedFarmOperations((prev) => ({ ...prev, [op.id]: { ...prev[op.id], date: v } }))}
                    placeholder="Date (YYYY-MM-DD, optional)"
                  />
                  <TextInputLike
                    value={sel.remarks}
                    onChangeText={(v) => setSelectedFarmOperations((prev) => ({ ...prev, [op.id]: { ...prev[op.id], remarks: v } }))}
                    placeholder="Remarks (optional)"
                  />
                </View>
              )}
            </View>
          );
        })
      )}

      <Text style={styles.sectionHeading}>Organic / IPM Solutions</Text>
      {organicSolutionOptions.length === 0 ? (
        <Text style={styles.placeholderValue}>Loading…</Text>
      ) : (
        organicSolutionOptions.map((sol) => {
          const sel = selectedOrganicSolutions[sol.id];
          return (
            <View key={sol.id} style={styles.multiSelectRow}>
              <TouchableOpacity style={styles.checkRow} onPress={() => onToggleOrganicSolution(sol.id)}>
                <View style={[styles.checkbox, !!sel && styles.checkboxChecked]}>
                  {!!sel && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkLabel}>{sol.name}</Text>
              </TouchableOpacity>
              {sel && (
                <View>
                  <View style={styles.inlineRow}>
                    <View style={{ flex: 1, marginRight: spacing.sm }}>
                      <TextInputLike
                        value={sel.quantity}
                        onChangeText={(v) => setSelectedOrganicSolutions((prev) => ({ ...prev, [sol.id]: { ...prev[sol.id], quantity: v } }))}
                        placeholder="Qty"
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextInputLike
                        value={sel.unit}
                        onChangeText={(v) => setSelectedOrganicSolutions((prev) => ({ ...prev, [sol.id]: { ...prev[sol.id], unit: v } }))}
                        placeholder="Unit"
                      />
                    </View>
                  </View>
                  <TextInputLike
                    value={sel.remarks}
                    onChangeText={(v) => setSelectedOrganicSolutions((prev) => ({ ...prev, [sol.id]: { ...prev[sol.id], remarks: v } }))}
                    placeholder="Remarks (optional)"
                  />
                </View>
              )}
            </View>
          );
        })
      )}

      <Text style={styles.sectionHeading}>Advisory</Text>
      <FieldRow label="Did the farmer use agricultural advisory services?">
        <View style={styles.inlineRow}>
          <TouchableOpacity
            style={[styles.modeChip, { flex: 1, marginRight: spacing.sm }, usedAdvisory === true && styles.modeChipActive]}
            onPress={() => setUsedAdvisory(true)}
          >
            <Text style={[styles.modeChipText, usedAdvisory === true && styles.modeChipTextActive]}>Yes</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeChip, { flex: 1 }, usedAdvisory === false && styles.modeChipActive]}
            onPress={onClearAdvisorySource}
          >
            <Text style={[styles.modeChipText, usedAdvisory === false && styles.modeChipTextActive]}>No</Text>
          </TouchableOpacity>
        </View>
      </FieldRow>
      {usedAdvisory === true && (
        <>
          <FieldRow label="Source">
            <ChipPicker
              options={[
                { value: 'agri_clinic', label: 'Agri-clinic' },
                { value: 'kvk', label: 'KVK' },
                { value: 'other', label: 'Other' },
              ]}
              value={advisorySource}
              onChange={(v) => setAdvisorySource(v as 'agri_clinic' | 'kvk' | 'other')}
            />
          </FieldRow>
          <FieldRow label="Remarks (optional)">
            <TextInputLike value={advisoryRemarks} onChangeText={setAdvisoryRemarks} placeholder="Any notes" />
          </FieldRow>
        </>
      )}
    </View>
  );
}
