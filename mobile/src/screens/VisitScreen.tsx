import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ScrollView, TextInput, Image, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';

import { useDataFetch } from '../hooks/useDataFetch';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Product = { id: string; name: string };

type TrialSelection = {
  productId: string;
  productName: string;
  quantityGiven: string; // kept as text while editing
};

export default function VisitScreen({ navigation }: any) {
  const [inVisit, setInVisit] = useState(false);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploadedPhotoUrl, setUploadedPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [visitType, setVisitType] = useState<'farmer' | 'dealer'>('farmer');
  const [purpose, setPurpose] = useState('');

  // Trial field (section 4) - Yes/No toggle; extra fields only appear
  // when Yes, and nothing below them is validated when No.
  const [isTrial, setIsTrial] = useState(false);
  const [trialSelections, setTrialSelections] = useState<TrialSelection[]>([]);
  // Leftover per product, entered at end-of-visit (decision 5: quantity
  // given is locked in at start, leftover stays editable through end).
  const [leftovers, setLeftovers] = useState<Record<string, string>>({});

  // Structured KPI fields (section 5) - captured at end of visit,
  // replacing the old free-text "work done" report for this visit.
  const [farmersCovered, setFarmersCovered] = useState('');
  const [demosConducted, setDemosConducted] = useState('');
  const [villagesCovered, setVillagesCovered] = useState(''); // comma-separated
  const [centsCovered, setCentsCovered] = useState('');
  const [conversions, setConversions] = useState('');

  // Reuses the existing dealer product catalog endpoint - there's no
  // separate "products" screen/endpoint, and this is the same list
  // DealerScreen already draws from for stock audits. Kept as its own
  // small, non-blocking fetch (not gating the whole screen) since most
  // visits don't use Trial at all - only the Trial section itself needs
  // to show its loading/error state, not the entire form.
  const {
    data: products,
    loading: loadingProducts,
    error: productsError,
    retry: retryProducts,
  } = useDataFetch<Product[]>(
    () => apiClient.request('/dealers/products/catalog', 'GET', 'stock_audit').then((d) => d || []),
    [],
    { refetchOnFocus: false }
  );


  const toggleProduct = (product: Product) => {
    setTrialSelections((prev) => {
      const exists = prev.find((p) => p.productId === product.id);
      if (exists) return prev.filter((p) => p.productId !== product.id);
      return [...prev, { productId: product.id, productName: product.name, quantityGiven: '' }];
    });
  };

  const setQuantityGiven = (productId: string, value: string) => {
    setTrialSelections((prev) => prev.map((p) => (p.productId === productId ? { ...p, quantityGiven: value } : p)));
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera Required', 'Camera access is needed to attach a farm photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setPhotoUri(asset.uri);
    setUploadedPhotoUrl(null);
    setUploadingPhoto(true);
    try {
      const url = await apiClient.uploadFile('/issues/upload', asset.uri, `visit-${Date.now()}.jpg`, 'image/jpeg');
      setUploadedPhotoUrl(url);
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message || 'Could not upload the photo. You can retake it.');
      setPhotoUri(null);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleStartVisit = async () => {
    if (!purpose.trim()) {
      Alert.alert('Purpose Required', 'Please describe the purpose of this visit.');
      return;
    }
    if (!uploadedPhotoUrl) {
      Alert.alert('Photo Required', 'Please attach a farm photo before starting the visit.');
      return;
    }
    if (isTrial && trialSelections.length === 0) {
      Alert.alert('Product Required', 'Select at least one product given for the trial.');
      return;
    }
    if (isTrial && trialSelections.some((p) => !p.quantityGiven || Number(p.quantityGiven) <= 0)) {
      Alert.alert('Quantity Required', 'Enter a quantity given for each selected product.');
      return;
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Required', 'Location permission is needed to start a visit.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

      const startRes = await apiClient.request('/visits/start', 'POST', 'check_in', {
        visit_type: visitType,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        purpose: purpose.trim(),
        photo_url_farm: uploadedPhotoUrl,
        is_trial: isTrial,
        trial_products: isTrial
          ? trialSelections.map((p) => ({ product_id: p.productId, quantity_given: Number(p.quantityGiven) }))
          : [],
      });

      // Leftover defaults to quantity given until adjusted at end-of-visit.
      const initialLeftovers: Record<string, string> = {};
      trialSelections.forEach((p) => {
        initialLeftovers[p.productId] = p.quantityGiven;
      });
      setLeftovers(initialLeftovers);

      setInVisit(true);
      setStartTime(new Date().toLocaleTimeString());
      showSubmitResult(startRes, 'Visit Session Started', 'GPS check and timer running.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not start visit.');
    }
  };

  const handleEndVisit = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Required', 'Location permission is needed to end a visit.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

      const endRes = await apiClient.request('/visits/end', 'POST', 'check_out', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        task_completed: true,
        trial_leftovers: isTrial
          ? trialSelections.map((p) => ({
              product_id: p.productId,
              quantity_leftover: Number(leftovers[p.productId] ?? p.quantityGiven ?? 0),
            }))
          : [],
        farmers_covered: farmersCovered ? Number(farmersCovered) : undefined,
        demos_conducted: demosConducted ? Number(demosConducted) : undefined,
        villages_covered: villagesCovered.trim()
          ? villagesCovered.split(',').map((v) => v.trim()).filter(Boolean)
          : undefined,
        cents_covered: centsCovered ? Number(centsCovered) : undefined,
        conversions: conversions ? Number(conversions) : undefined,
      });

      setInVisit(false);
      setPhotoUri(null);
      setUploadedPhotoUrl(null);
      setStartTime(null);
      setPurpose('');
      setIsTrial(false);
      setTrialSelections([]);
      setLeftovers({});
      setFarmersCovered('');
      setDemosConducted('');
      setVillagesCovered('');
      setCentsCovered('');
      setConversions('');
      showSubmitResult(endRes, 'Visit Session Ended', 'Completed logs synchronized with backend.');
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not end visit.');
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Field Visit Log</Text>

      {!inVisit ? (
        <View style={styles.card}>
          <Text style={styles.cardInfo}>Select visit type, attach a farm photo, and describe the purpose before starting.</Text>

          <View style={styles.typeToggle}>
            <TouchableOpacity
              style={[styles.typeChip, visitType === 'farmer' && styles.typeChipActive]}
              onPress={() => setVisitType('farmer')}
            >
              <Text style={[styles.typeChipText, visitType === 'farmer' && styles.typeChipTextActive]}>Farmer Visit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeChip, visitType === 'dealer' && styles.typeChipActive]}
              onPress={() => setVisitType('dealer')}
            >
              <Text style={[styles.typeChipText, visitType === 'dealer' && styles.typeChipTextActive]}>Dealer Visit</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.btnAction} onPress={handleTakePhoto} disabled={uploadingPhoto}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            ) : (
              <Ionicons name="camera-outline" size={32} color={color.primary} style={styles.actionIcon} />
            )}
            <Text style={styles.actionLabel}>
              {uploadingPhoto ? 'Uploading...' : uploadedPhotoUrl ? 'Farm Photo Attached ✓ (tap to retake)' : 'Take Farm Photo'}
            </Text>
          </TouchableOpacity>

          <TextInput
            style={styles.purposeInput}
            placeholder="Purpose (e.g. Bio-NPK demonstration, stock check)"
            placeholderTextColor={color.textMuted}
            value={purpose}
            onChangeText={setPurpose}
          />

          <View style={styles.trialRow}>
            <Text style={styles.trialLabel}>Trial?</Text>
            <Switch
              value={isTrial}
              onValueChange={setIsTrial}
              trackColor={{ false: color.border, true: color.primaryLight }}
              thumbColor={isTrial ? color.primary : color.textSecondary}
            />
          </View>

          {isTrial && (
            <View style={styles.trialBox}>
              <Text style={styles.trialBoxTitle}>Products Given</Text>
              {loadingProducts ? (
                <Text style={styles.trialHint}>Loading products…</Text>
              ) : productsError ? (
                <TouchableOpacity onPress={retryProducts}>
                  <Text style={styles.trialHintError}>{productsError} (tap to retry)</Text>
                </TouchableOpacity>
              ) : (products ?? []).length === 0 ? (
                <Text style={styles.trialHint}>No products available yet.</Text>
              ) : (
                (products ?? []).map((product) => {
                  const selected = trialSelections.find((p) => p.productId === product.id);
                  return (
                    <View key={product.id} style={styles.productRow}>
                      <TouchableOpacity style={styles.productCheckRow} onPress={() => toggleProduct(product)}>
                        <View style={[styles.checkbox, !!selected && styles.checkboxChecked]}>
                          {!!selected && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.productName}>{product.name}</Text>
                      </TouchableOpacity>
                      {selected && (
                        <TextInput
                          style={styles.qtyInput}
                          placeholder="Qty given"
                          placeholderTextColor={color.textMuted}
                          keyboardType="numeric"
                          value={selected.quantityGiven}
                          onChangeText={(v) => setQuantityGiven(product.id, v)}
                        />
                      )}
                    </View>
                  );
                })
              )}
            </View>
          )}

          <TouchableOpacity style={styles.btnStart} onPress={handleStartVisit}>
            <Text style={styles.btnText}>Start Visit Session</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.visitRunning}>Visit Session Active</Text>
          <Text style={styles.visitTime}>Started at: {startTime}</Text>

          {isTrial && trialSelections.length > 0 && (
            <View style={styles.trialBox}>
              <Text style={styles.trialBoxTitle}>Leftover Stock</Text>
              {trialSelections.map((p) => (
                <View key={p.productId} style={styles.leftoverRow}>
                  <Text style={styles.productName}>{p.productName}</Text>
                  <TextInput
                    style={styles.qtyInput}
                    placeholder="Leftover"
                    placeholderTextColor={color.textMuted}
                    keyboardType="numeric"
                    value={leftovers[p.productId] ?? p.quantityGiven}
                    onChangeText={(v) => setLeftovers((prev) => ({ ...prev, [p.productId]: v }))}
                  />
                </View>
              ))}
            </View>
          )}

          <View style={styles.kpiBox}>
            <Text style={styles.trialBoxTitle}>Visit Summary</Text>
            <TextInput
              style={styles.purposeInput}
              placeholder="Farmers covered"
              placeholderTextColor={color.textMuted}
              keyboardType="numeric"
              value={farmersCovered}
              onChangeText={setFarmersCovered}
            />
            <TextInput
              style={styles.purposeInput}
              placeholder="Demos conducted"
              placeholderTextColor={color.textMuted}
              keyboardType="numeric"
              value={demosConducted}
              onChangeText={setDemosConducted}
            />
            <TextInput
              style={styles.purposeInput}
              placeholder="Villages covered (comma separated)"
              placeholderTextColor={color.textMuted}
              value={villagesCovered}
              onChangeText={setVillagesCovered}
            />
            <TextInput
              style={styles.purposeInput}
              placeholder="Cents covered"
              placeholderTextColor={color.textMuted}
              keyboardType="numeric"
              value={centsCovered}
              onChangeText={setCentsCovered}
            />
            <TextInput
              style={styles.purposeInput}
              placeholder="Conversions"
              placeholderTextColor={color.textMuted}
              keyboardType="numeric"
              value={conversions}
              onChangeText={setConversions}
            />
          </View>

          <TouchableOpacity style={styles.btnEnd} onPress={handleEndVisit}>
            <Text style={styles.btnText}>Complete & Save Visit</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
        <Text style={styles.btnBackText}>Go Back</Text>
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
  card: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    borderWidth: 1,
    borderColor: color.border,
    shadowColor: color.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    marginBottom: spacing.xl,
  },
  cardInfo: {
    fontSize: font.body,
    color: color.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  typeToggle: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.screenBg,
  },
  typeChipActive: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  typeChipText: {
    fontSize: font.body,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
  },
  typeChipTextActive: {
    color: color.white,
  },
  purposeInput: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    color: color.textPrimary,
    marginBottom: spacing.md,
  },
  trialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  trialLabel: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
  },
  trialBox: {
    backgroundColor: color.screenBg,
    borderRadius: 10,
    padding: 14,
    marginBottom: spacing.xl,
  },
  trialBoxTitle: {
    fontSize: font.body,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginBottom: 10,
  },
  trialHint: {
    fontSize: font.caption,
    color: color.textMuted,
  },
  trialHintError: {
    fontSize: font.caption,
    color: color.error,
    fontWeight: fontWeight.semibold,
  },
  productRow: {
    marginBottom: 10,
  },
  productCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: color.textDisabled,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  checkmark: {
    color: color.white,
    fontSize: font.body,
    fontWeight: fontWeight.bold,
  },
  productName: {
    fontSize: font.body,
    color: color.textPrimary,
    flex: 1,
  },
  qtyInput: {
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: 10,
    fontSize: font.body,
    color: color.textPrimary,
    marginLeft: 30,
  },
  leftoverRow: {
    marginBottom: 10,
  },
  kpiBox: {
    marginBottom: spacing.xl,
  },
  visitRunning: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.success,
    textAlign: 'center',
  },
  visitTime: {
    fontSize: font.body,
    color: color.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xxl,
  },
  btnAction: {
    width: '100%',
    backgroundColor: color.screenBg,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: spacing.xl,
  },
  photoPreview: {
    width: 80,
    height: 80,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  actionIcon: {
    marginBottom: spacing.sm,
  },
  actionLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    textAlign: 'center',
  },
  btnStart: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: 14,
    alignItems: 'center',
  },
  btnEnd: {
    backgroundColor: color.error,
    borderRadius: radius.sm,
    padding: 14,
    alignItems: 'center',
  },
  btnText: {
    color: color.white,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
  btnBack: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  btnBackText: {
    color: color.primary,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
});
