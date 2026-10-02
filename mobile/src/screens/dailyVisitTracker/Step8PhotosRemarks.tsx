import React from 'react';
import { Text, View, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { color, font, fontWeight, spacing, radius } from '../../theme';
import { sharedStyles as styles } from './sharedStyles';
import { FieldRow, TextInputLike } from './FormFields';

export type PhotoItem = { uri: string; uploadedUrl: string | null; uploading: boolean };

type Props = {
  photos: PhotoItem[];
  onTakePhoto: () => void;
  onPickFromGallery: () => void;
  onRemovePhoto: (uri: string) => void;
  officerRemarks: string;
  setOfficerRemarks: (v: string) => void;
  nextFollowUpDate: string;
  setNextFollowUpDate: (v: string) => void;
  followUpRemarks: string;
  setFollowUpRemarks: (v: string) => void;
};

// Section 17 (crop condition photo, at minimum) + section 24 (additional
// photos, remarks, follow-up). Reuses the same ImagePicker + upload-on-
// select pattern already used in VisitScreen/CropIssueScreen (same
// /issues/upload endpoint backed by the app's one centralized file-
// storage seam) rather than a new upload flow - this just allows more
// than one photo, backed by the visit_photos table added in the schema
// migration (a real 1:many gallery, not a single column).
export default function Step8PhotosRemarks({
  photos,
  onTakePhoto,
  onPickFromGallery,
  onRemovePhoto,
  officerRemarks,
  setOfficerRemarks,
  nextFollowUpDate,
  setNextFollowUpDate,
  followUpRemarks,
  setFollowUpRemarks,
}: Props) {
  return (
    <View>
      <Text style={styles.sectionHeading}>Photos</Text>
      <View style={localStyles.photoGrid}>
        {photos.map((p) => (
          <View key={p.uri} style={localStyles.photoTile}>
            <Image source={{ uri: p.uri }} style={localStyles.photoImage} />
            {p.uploading ? (
              <View style={localStyles.photoOverlay}>
                <ActivityIndicator color={color.white} />
              </View>
            ) : (
              <TouchableOpacity
                style={localStyles.removeBtn}
                onPress={() => onRemovePhoto(p.uri)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={localStyles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
      <View style={styles.inlineRow}>
        <TouchableOpacity style={[localStyles.photoActionBtn, { marginRight: spacing.sm }]} onPress={onTakePhoto}>
          <Text style={localStyles.photoActionText}>📸 Take Photo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={localStyles.photoActionBtn} onPress={onPickFromGallery}>
          <Text style={localStyles.photoActionText}>🖼 Choose from Gallery</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeading}>Remarks & Follow-up</Text>
      <FieldRow label="Field Officer Remarks (optional)">
        <TextInputLike value={officerRemarks} onChangeText={setOfficerRemarks} placeholder="Any observations or notes" />
      </FieldRow>
      <FieldRow label="Next Follow-up Date (optional)">
        <TextInputLike value={nextFollowUpDate} onChangeText={setNextFollowUpDate} placeholder="YYYY-MM-DD" />
      </FieldRow>
      <FieldRow label="Follow-up Remarks (optional)">
        <TextInputLike value={followUpRemarks} onChangeText={setFollowUpRemarks} placeholder="What to check next time" />
      </FieldRow>
    </View>
  );
}

const localStyles = StyleSheet.create({
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.md,
  },
  photoTile: {
    width: 90,
    height: 90,
    borderRadius: radius.sm,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: color.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: {
    color: color.white,
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
  },
  photoActionBtn: {
    flex: 1,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  photoActionText: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
  },
});
