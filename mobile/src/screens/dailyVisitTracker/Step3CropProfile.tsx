import React from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { spacing } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';
import { FieldRow, TextInputLike, ChipPicker } from './FormFields';
import { FARMING_TYPES, CROP_AGE_UNITS, type MasterItem, type CropOption, type VarietyOption } from './types';

type Props = {
  cropCategories: MasterItem[];
  crops: CropOption[];
  varieties: VarietyOption[];
  selectedCategoryId: string | null;
  setSelectedCategoryId: (v: string) => void;
  selectedCropId: string | null;
  setSelectedCropId: (v: string) => void;
  selectedVarietyId: string | null;
  setSelectedVarietyId: (v: string) => void;
  varietyText: string;
  setVarietyText: (v: string) => void;
  cropAgeValue: string;
  setCropAgeValue: (v: string) => void;
  cropAgeUnit: typeof CROP_AGE_UNITS[number];
  setCropAgeUnit: (v: typeof CROP_AGE_UNITS[number]) => void;
  sowingDate: string;
  setSowingDate: (v: string) => void;
  previousCropText: string;
  setPreviousCropText: (v: string) => void;
  previousYieldValue: string;
  setPreviousYieldValue: (v: string) => void;
  previousYieldUnit: string;
  setPreviousYieldUnit: (v: string) => void;
  farmingType: string | null;
  setFarmingType: (v: string) => void;
};

export default function Step3CropProfile({
  cropCategories,
  crops,
  varieties,
  selectedCategoryId,
  setSelectedCategoryId,
  selectedCropId,
  setSelectedCropId,
  selectedVarietyId,
  setSelectedVarietyId,
  varietyText,
  setVarietyText,
  cropAgeValue,
  setCropAgeValue,
  cropAgeUnit,
  setCropAgeUnit,
  sowingDate,
  setSowingDate,
  previousCropText,
  setPreviousCropText,
  previousYieldValue,
  setPreviousYieldValue,
  previousYieldUnit,
  setPreviousYieldUnit,
  farmingType,
  setFarmingType,
}: Props) {
  return (
    <View>
      <FieldRow label="Crop Category">
        <ChipPicker
          options={cropCategories.map((c) => ({ value: c.id, label: c.name }))}
          value={selectedCategoryId}
          onChange={setSelectedCategoryId}
          emptyText="Loading categories…"
        />
      </FieldRow>

      <FieldRow label="Crop">
        {!selectedCategoryId ? (
          <Text style={styles.placeholderValue}>Select a category first</Text>
        ) : (
          <ChipPicker
            options={crops.map((c) => ({ value: c.id, label: c.name }))}
            value={selectedCropId}
            onChange={setSelectedCropId}
            emptyText="No crops found for this category"
          />
        )}
      </FieldRow>

      <FieldRow label="Variety / Hybrid">
        {selectedCropId && varieties.length > 0 ? (
          <ChipPicker
            options={varieties.map((v) => ({ value: v.id, label: v.name }))}
            value={selectedVarietyId}
            onChange={setSelectedVarietyId}
            emptyText="No varieties listed"
          />
        ) : (
          <TextInputLike
            value={varietyText}
            onChangeText={setVarietyText}
            placeholder={selectedCropId ? 'Not listed — type variety name' : 'Select a crop first'}
          />
        )}
      </FieldRow>

      <FieldRow label="Crop Age">
        <View style={styles.inlineRow}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <TextInputLike value={cropAgeValue} onChangeText={setCropAgeValue} placeholder="e.g. 45" keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <ChipPicker
              options={CROP_AGE_UNITS.map((u) => ({ value: u, label: u }))}
              value={cropAgeUnit}
              onChange={(v) => setCropAgeUnit(v as typeof CROP_AGE_UNITS[number])}
              compact
            />
          </View>
        </View>
      </FieldRow>

      <FieldRow label="Sowing / Planting Date">
        <TextInputLike value={sowingDate} onChangeText={setSowingDate} placeholder="YYYY-MM-DD" />
        {/* Plain text entry rather than a native date picker - no
            date-picker library exists in this app yet
            (@react-native-community/datetimepicker isn't a dependency),
            and adding a new native module isn't something verifiable
            without a device/emulator (none available in this
            environment). Same YYYY-MM-DD text pattern MyLeaveScreen's
            apply-leave modal already uses for its end-date field. */}
      </FieldRow>

      <FieldRow label="Previous Season Crop">
        <TextInputLike value={previousCropText} onChangeText={setPreviousCropText} placeholder="e.g. Groundnut" />
      </FieldRow>

      <FieldRow label="Previous Season Yield">
        <View style={styles.inlineRow}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <TextInputLike value={previousYieldValue} onChangeText={setPreviousYieldValue} placeholder="Quantity" keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <TextInputLike value={previousYieldUnit} onChangeText={setPreviousYieldUnit} placeholder="Unit (e.g. quintals)" />
          </View>
        </View>
      </FieldRow>

      <FieldRow label="Farming Type">
        <View>
          {FARMING_TYPES.map((ft) => (
            <TouchableOpacity
              key={ft.value}
              style={[styles.radioCard, farmingType === ft.value && styles.radioCardActive]}
              onPress={() => setFarmingType(ft.value)}
            >
              <View style={[styles.radioDot, farmingType === ft.value && styles.radioDotActive]} />
              <Text style={[styles.radioCardText, farmingType === ft.value && styles.radioCardTextActive]}>{ft.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </FieldRow>
    </View>
  );
}
