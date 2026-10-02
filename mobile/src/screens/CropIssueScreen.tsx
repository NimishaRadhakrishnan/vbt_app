import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, StaleDataBanner } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Farmer = { id: string; name: string; village: string; district: string };

export default function CropIssueScreen({ navigation }: any) {
  const [selectedFarmerId, setSelectedFarmerId] = useState<string | null>(null);
  const [crop, setCrop] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Previously farmer_id and district were hardcoded to a single fake
  // farmer/district for every report, regardless of who was actually
  // visited. This pulls the officer's real farmer list so they pick one.
  const { data: farmers, loading, error, isStale, retry } = useDataFetch<Farmer[]>(
    () => apiClient.request('/farmers/search', 'GET', 'crop_issue').then((d) => d || []),
    []
  );

  const selectedFarmer = (farmers ?? []).find((f) => f.id === selectedFarmerId) ?? null;

  // Real capture + upload. Previously this was a plain UI boolean with no
  // camera and a fabricated image_url ("http://image-bucket/crop_pest_001.jpg")
  // sent to the backend as if a real photo existed.
  const handleCapture = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera Required', 'Camera access is needed to attach a leaf/pest photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setPhotoUri(asset.uri);
    setUploadedPhotoUrl(null);
    setUploadingPhoto(true);
    try {
      const url = await apiClient.uploadFile('/issues/upload', asset.uri, `crop-issue-${Date.now()}.jpg`, 'image/jpeg');
      setUploadedPhotoUrl(url);
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message || 'Could not upload the photo. You can retake it.');
      setPhotoUri(null);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleReport = async () => {
    if (!selectedFarmer || !crop || !symptoms || !uploadedPhotoUrl) {
      Alert.alert('Incomplete Form', 'Please select a farmer, provide crop name, symptoms, and attach a photo.');
      return;
    }

    try {
      const res = await apiClient.request('/issues', 'POST', 'crop_issue', {
        farmer_id: selectedFarmer.id,
        crop,
        district: selectedFarmer.district,
        symptoms,
        image_url: uploadedPhotoUrl,
      });

      showSubmitResult(
        res,
        'Ticket Dispatched',
        `Details uploaded. Routed to the ${selectedFarmer.district} district agricultural specialist.`
      );
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Dispatch failed.');
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  const farmerList = farmers ?? [];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Report Crop Issue</Text>
      {isStale && <StaleDataBanner onRetry={retry} />}

      <View style={styles.form}>
        <Text style={styles.fieldLabel}>Farmer</Text>
        {farmerList.length === 0 ? (
          <Text style={styles.emptyNote}>No farmers found in your area yet — register one first.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.farmerRow}>
            {farmerList.map((f) => (
              <TouchableOpacity
                key={f.id}
                style={[styles.farmerChip, selectedFarmerId === f.id && styles.farmerChipActive]}
                onPress={() => setSelectedFarmerId(f.id)}
              >
                <Text style={[styles.farmerChipText, selectedFarmerId === f.id && styles.farmerChipTextActive]}>
                  {f.name} · {f.village}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <TextInput
          style={styles.input}
          placeholder="Crop Name (e.g. Paddy)"
          placeholderTextColor={color.textMuted}
          value={crop}
          onChangeText={setCrop}
        />

        <TextInput
          style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
          placeholder="Describe symptoms (e.g. Yellow leaf spots, pest activity...)"
          placeholderTextColor={color.textMuted}
          multiline
          value={symptoms}
          onChangeText={setSymptoms}
        />

        {/* Leaf capture block */}
        <TouchableOpacity style={styles.btnCapture} onPress={handleCapture} disabled={uploadingPhoto}>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.photoPreview} />}
          <Text style={styles.btnCaptureText}>
            {uploadingPhoto ? 'Uploading...' : uploadedPhotoUrl ? 'Leaf Photo Attached ✓ (tap to retake)' : '📸 Take Leaf/Pest Photo'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btnSubmit} onPress={handleReport}>
          <Text style={styles.btnSubmitText}>Submit to Specialist</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
        <Text style={styles.btnBackText}>Cancel & Go Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
    padding: spacing.xl,
  },
  title: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginBottom: spacing.xxl,
    marginTop: spacing.xl,
  },
  form: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: color.border,
  },
  input: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.subtitle,
    color: color.textPrimary,
    marginBottom: spacing.lg,
  },
  fieldLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  emptyNote: {
    fontSize: font.body,
    color: color.textMuted,
    fontStyle: 'italic',
    marginBottom: spacing.lg,
  },
  farmerRow: {
    marginBottom: spacing.lg,
  },
  farmerChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.screenBg,
    marginRight: spacing.sm,
  },
  farmerChipActive: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  farmerChipText: {
    fontSize: font.body,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
  },
  farmerChipTextActive: {
    color: color.white,
  },
  btnCapture: {
    backgroundColor: '#efebe9',
    borderRadius: radius.sm,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: '#d7ccc8',
    borderStyle: 'dashed',
  },
  photoPreview: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  btnCaptureText: {
    color: '#5d4037',
    fontWeight: fontWeight.bold,
    fontSize: font.body,
  },
  btnSubmit: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: 14,
    alignItems: 'center',
  },
  btnSubmitText: {
    color: color.white,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
  btnBack: {
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 40,
  },
  btnBackText: {
    color: color.primary,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
});
