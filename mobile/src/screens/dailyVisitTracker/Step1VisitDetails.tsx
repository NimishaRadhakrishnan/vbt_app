import React from 'react';
import { Text, View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { color, spacing, radius, fontWeight } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';
import { FieldRow, TextInputLike, ChipPicker } from './FormFields';

// Same 7-district list already established as the correct one on the
// web app's own Day Closure form (components/DayClosureForm.tsx) - no
// backend districts table exists anywhere in this system (district is
// free text throughout), so there's no real "lookup" to wire this to.
// Was previously a free-text TextInputLike here, matching
// FarmerScreen.tsx's own district field - but a constrained list is a
// real improvement over free text either way: it prevents exactly the
// kind of inconsistent entry ("coimbatore" vs "Coimbatore") that shows
// up in this app's actual farmer records today.
const DISTRICT_OPTIONS = [
  { value: 'Coimbatore', label: 'Coimbatore' },
  { value: 'Tiruppur', label: 'Tiruppur' },
  { value: 'Theni', label: 'Theni' },
  { value: 'Erode', label: 'Erode' },
  { value: 'Dindigul', label: 'Dindigul' },
  { value: 'Idukki', label: 'Idukki' },
  { value: 'Tirunelveli', label: 'Tirunelveli' },
];

type Props = {
  officerName: string;
  employeeId: string;
  visitDate: Date;
  district: string;
  setDistrict: (v: string) => void;
  villageBlock: string;
  setVillageBlock: (v: string) => void;
  gps: { lat: number; lng: number } | null;
  gpsLoading: boolean;
  onGetLocation: () => void;
};

export default function Step1VisitDetails({
  officerName,
  employeeId,
  visitDate,
  district,
  setDistrict,
  villageBlock,
  setVillageBlock,
  gps,
  gpsLoading,
  onGetLocation,
}: Props) {
  return (
    <View>
      <FieldRow label="Field Officer">
        <Text style={styles.readonlyValue}>{officerName}</Text>
      </FieldRow>
      <FieldRow label="Employee ID">
        <Text style={styles.readonlyValue}>{employeeId}</Text>
      </FieldRow>
      <FieldRow label="Visit Date">
        <Text style={styles.readonlyValue}>{visitDate.toLocaleDateString()}</Text>
      </FieldRow>
      <FieldRow label="Visit Time">
        <Text style={styles.readonlyValue}>{visitDate.toLocaleTimeString()}</Text>
      </FieldRow>

      <FieldRow label="District">
        <ChipPicker options={DISTRICT_OPTIONS} value={district || null} onChange={setDistrict} />
      </FieldRow>
      <FieldRow label="Village / Block">
        <TextInputLike value={villageBlock} onChangeText={setVillageBlock} placeholder="Village or block" />
      </FieldRow>

      <FieldRow label="GPS Location">
        {gps ? (
          <Text style={styles.readonlyValue}>{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</Text>
        ) : (
          <Text style={styles.placeholderValue}>Not captured yet</Text>
        )}
      </FieldRow>
      <TouchableOpacity style={localStyles.gpsBtn} onPress={onGetLocation} disabled={gpsLoading}>
        {gpsLoading ? (
          <ActivityIndicator color={color.white} />
        ) : (
          <Text style={localStyles.gpsBtnText}>Get Current Location</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const localStyles = StyleSheet.create({
  gpsBtn: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  gpsBtnText: {
    color: color.white,
    fontWeight: fontWeight.bold,
  },
});
