import React from 'react';
import { Text, View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { color, spacing, font, fontWeight, radius } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';
import { FieldRow, TextInputLike } from './FormFields';
import type { Farmer } from './types';

type Props = {
  farmerMode: 'new' | 'existing';
  onSwitchToNew: () => void;
  onSwitchToExisting: () => void;
  myFarmers: Farmer[];
  loadingFarmers: boolean;
  farmerSearch: string;
  setFarmerSearch: (v: string) => void;
  filteredFarmers: Farmer[];
  selectedFarmer: Farmer | null;
  onSelectFarmer: (farmer: Farmer) => void;
  farmerName: string;
  setFarmerName: (v: string) => void;
  farmerPhone: string;
  onChangePhone: (v: string) => void;
  phoneError: string | null;
  farmSize: string;
  setFarmSize: (v: string) => void;
  farmSizeUnit: string;
};

export default function Step2FarmerFarm({
  farmerMode,
  onSwitchToNew,
  onSwitchToExisting,
  myFarmers,
  loadingFarmers,
  farmerSearch,
  setFarmerSearch,
  filteredFarmers,
  selectedFarmer,
  onSelectFarmer,
  farmerName,
  setFarmerName,
  farmerPhone,
  onChangePhone,
  phoneError,
  farmSize,
  setFarmSize,
  farmSizeUnit,
}: Props) {
  return (
    <View>
      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.modeChip, farmerMode === 'new' && styles.modeChipActive]}
          onPress={onSwitchToNew}
        >
          <Text style={[styles.modeChipText, farmerMode === 'new' && styles.modeChipTextActive]}>New Farmer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeChip, farmerMode === 'existing' && styles.modeChipActive]}
          onPress={onSwitchToExisting}
        >
          <Text style={[styles.modeChipText, farmerMode === 'existing' && styles.modeChipTextActive]}>Existing Farmer</Text>
        </TouchableOpacity>
      </View>

      {farmerMode === 'existing' && (
        <View style={{ marginBottom: spacing.lg }}>
          <TextInputLike value={farmerSearch} onChangeText={setFarmerSearch} placeholder="Search by name or phone" />
          {loadingFarmers ? (
            <ActivityIndicator color={color.primary} style={{ marginTop: spacing.md }} />
          ) : filteredFarmers.length === 0 ? (
            <Text style={styles.placeholderValue}>
              {myFarmers.length === 0 ? 'No farmers registered by you yet.' : 'No match found.'}
            </Text>
          ) : (
            <View style={{ marginTop: spacing.sm }}>
              {filteredFarmers.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[localStyles.farmerRow, selectedFarmer?.id === f.id && localStyles.farmerRowSelected]}
                  onPress={() => onSelectFarmer(f)}
                >
                  <Text style={localStyles.farmerRowName}>{f.name}</Text>
                  <Text style={localStyles.farmerRowMeta}>{f.phone} · {f.village}, {f.district}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      <FieldRow label="Farmer Name">
        {farmerMode === 'existing' && selectedFarmer ? (
          <Text style={styles.readonlyValue}>{farmerName}</Text>
        ) : (
          <TextInputLike value={farmerName} onChangeText={setFarmerName} placeholder="Farmer's full name" />
        )}
      </FieldRow>
      <FieldRow label="Contact Number">
        {farmerMode === 'existing' && selectedFarmer ? (
          <Text style={styles.readonlyValue}>{farmerPhone}</Text>
        ) : (
          <>
            <TextInputLike
              value={farmerPhone}
              onChangeText={onChangePhone}
              placeholder="10-digit mobile number"
              keyboardType="phone-pad"
              maxLength={10}
            />
            {phoneError && <Text style={styles.errorText}>{phoneError}</Text>}
          </>
        )}
      </FieldRow>
      <FieldRow label={`Farm Size (${farmSizeUnit})`}>
        <TextInputLike value={farmSize} onChangeText={setFarmSize} placeholder="e.g. 2.5" keyboardType="numeric" />
      </FieldRow>
    </View>
  );
}

const localStyles = StyleSheet.create({
  farmerRow: {
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  farmerRowSelected: {
    borderColor: color.primary,
    backgroundColor: color.primaryPale,
  },
  farmerRowName: {
    fontSize: font.body,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
  },
  farmerRowMeta: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: 2,
  },
});
