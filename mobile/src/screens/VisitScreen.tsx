import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ScrollView, TextInput, Image, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { takePhoto } from '../utils/camera';
import SearchBox, { matchesQuery } from '../components/SearchBox';
import { apiClient } from '../services/api';
import { LocationService } from '../services/LocationService';
import { showSubmitResult } from '../utils/offlineAlert';

import { useDataFetch } from '../hooks/useDataFetch';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Product = { id: string; name: string; available: number; unit?: string | null };
type Target = { id: string; name: string; sub: string };

type TrialSelection = {
  productId: string;
  productName: string;
  quantityGiven: string; // kept as text while editing
};

export default function VisitScreen({ navigation }: any) {
  const [inVisit, setInVisit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startTime, setStartTime] = useState<string | null>(null);
  // Several photos per visit: each is uploaded as soon as it is taken.
  type VisitPhoto = { uri: string; url: string | null; failed?: boolean };
  const [photos, setPhotos] = useState<VisitPhoto[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const uploadingPhoto = uploadingCount > 0;
  const uploadedUrls = photos.filter((p) => p.url).map((p) => p.url as string);
  const MAX_PHOTOS = 10;
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
    // Only the products admin has issued to this officer, with what is left.
    () =>
      apiClient
        .request('/stock/my-stock?issued_only=true', 'GET', 'stock_audit')
        .then((d: any[]) => (d || []).map((r) => ({ id: r.product_id, name: r.product_name, available: Number(r.current_quantity) || 0, unit: r.unit }))),
    [],
    { refetchOnFocus: false }
  );


  const [productQuery, setProductQuery] = useState('');

  // Every visit is for one farmer or one dealer (the server refuses a visit
  // that names neither), so the officer picks who they are visiting.
  const { data: targetLists } = useDataFetch<{ farmer: Target[]; dealer: Target[] }>(
    () =>
      Promise.all([
        apiClient.request('/farmers/search', 'GET', 'farmer_register').catch(() => []),
        apiClient.request('/dealers/search', 'GET', 'stock_audit').catch(() => []),
      ]).then(([f, d]: any[]) => ({
        farmer: (f || []).map((x: any) => ({ id: x.id, name: x.name, sub: [x.village, x.district].filter(Boolean).join(', ') })),
        dealer: (d || []).map((x: any) => ({ id: x.id, name: x.name, sub: [x.village, x.district].filter(Boolean).join(', ') })),
      })),
    [],
    { refetchOnFocus: false }
  );
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const targets = (targetLists?.[visitType] ?? []) as Target[];
  const selectedTarget = targets.find((t) => t.id === targetId) ?? null;
  const shownTargets = targets.filter((t) => matchesQuery(`${t.name} ${t.sub}`, targetQuery)).slice(0, 8);

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

  const uploadAsset = async (uri: string) => {
    setPhotos((prev) => [...prev, { uri, url: null }]);
    setUploadingCount((n) => n + 1);
    try {
      const url = await apiClient.uploadFile('/issues/upload', uri, `visit-${Date.now()}.jpg`, 'image/jpeg');
      setPhotos((prev) => prev.map((p) => (p.uri === uri ? { ...p, url } : p)));
    } catch (err: any) {
      setPhotos((prev) => prev.map((p) => (p.uri === uri ? { ...p, failed: true } : p)));
      Alert.alert('Upload Failed', err?.message || 'Could not upload the photo. Tap it to try again.');
    } finally {
      setUploadingCount((n) => Math.max(0, n - 1));
    }
  };

  // Android can restart the app while the camera is open; the photo that was
  // just taken is waiting here, so pick it up instead of losing it.
  useEffect(() => {
    (async () => {
      try {
        const pending: any = await (ImagePicker as any).getPendingResultAsync?.();
        const list = Array.isArray(pending) ? pending : pending?.assets ? pending.assets : [];
        for (const a of list) if (a?.uri) void uploadAsset(a.uri);
      } catch {
        /* nothing pending */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTakePhoto = async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Photo limit', `You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const uri = await takePhoto();
    if (uri) await uploadAsset(uri);
  };

  const handlePickPhotos = async () => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      Alert.alert('Photo limit', `You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Gallery Required', 'Allow photo access in Settings to choose photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.5,
        allowsMultipleSelection: true,
        selectionLimit: room,
      });
      if (result.canceled || !result.assets?.length) return;
      for (const asset of result.assets.slice(0, room)) await uploadAsset(asset.uri);
    } catch (err: any) {
      Alert.alert('Gallery problem', err?.message || 'Could not open the gallery.');
    }
  };

  const retryPhoto = async (uri: string) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
    await uploadAsset(uri);
  };

  const removePhoto = (uri: string) => setPhotos((prev) => prev.filter((p) => p.uri !== uri));

  const handleStartVisit = async () => {
    if (busy) return;
    if (!purpose.trim()) {
      Alert.alert('Purpose Required', 'Please describe the purpose of this visit.');
      return;
    }
    if (!targetId) {
      Alert.alert(visitType === 'farmer' ? 'Choose the farmer' : 'Choose the dealer', `Pick who you are visiting. If they are not listed, register them first (Field > ${visitType === 'farmer' ? 'Farmers' : 'Dealers'}).`);
      return;
    }
    if (uploadingPhoto) {
      Alert.alert('Please wait', 'Photos are still uploading.');
      return;
    }
    if (uploadedUrls.length === 0) {
      Alert.alert('Photo Required', 'Please attach at least one farm photo before starting the visit.');
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
    const over = isTrial ? trialSelections.find((p) => Number(p.quantityGiven) > (products ?? []).find((x) => x.id === p.productId)!.available) : undefined;
    if (over) {
      const have = (products ?? []).find((x) => x.id === over.productId)!.available;
      Alert.alert('Not enough stock', `You only have ${have} of ${over.productName}. Reduce the quantity, or ask admin to issue more.`);
      return;
    }

    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Required', 'Location permission is needed to start a visit.');
        return;
      }
      // Never waits forever: recent fix, else live fix for up to 12s, else last known.
      const position = await LocationService.getFix();
      if (!position) {
        Alert.alert('No GPS signal', 'Could not get your location. Turn on GPS / Location, step outside or near a window, and try again.');
        return;
      }

      let startRes: any;
      try {
        startRes = await apiClient.request('/visits/start', 'POST', 'check_in', {
          visit_type: visitType,
          farmer_id: visitType === 'farmer' ? targetId : undefined,
          dealer_id: visitType === 'dealer' ? targetId : undefined,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          purpose: purpose.trim(),
          photo_url_farm: uploadedUrls[0],
          photo_urls: uploadedUrls,
          is_trial: isTrial,
          trial_products: isTrial
            ? trialSelections.map((p) => ({ product_id: p.productId, quantity_given: Number(p.quantityGiven) }))
            : [],
        });
      } catch (err: any) {
        // An earlier visit is still open on the server: carry on with it
        // instead of leaving the officer stuck on this screen.
        if (/active visit/i.test(err?.message || '')) {
          setInVisit(true);
          setStartTime(new Date().toLocaleTimeString());
          Alert.alert('Visit already running', 'You already have an open visit session. Finish it with "Complete & Save Visit".');
          return;
        }
        throw err;
      }

        // The officer counts what is left at the end; nothing is assumed.
      setLeftovers({});

      setInVisit(true);
      setStartTime(new Date().toLocaleTimeString());
      showSubmitResult(startRes, 'Visit Session Started', 'GPS check and timer running.');
    } catch (err: any) {
      Alert.alert('Could not start visit', err?.message || 'Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleEndVisit = async () => {
    if (isTrial) {
      for (const p of trialSelections) {
        const raw = (leftovers[p.productId] ?? '').trim();
        const left = Number(raw);
        if (raw === '' || !Number.isFinite(left) || left < 0) {
          Alert.alert('Leftover needed', `Enter how much ${p.productName} is left unused (0 if all was used).`);
          return;
        }
        if (left > Number(p.quantityGiven)) {
          Alert.alert('Check leftover', `${p.productName}: you took ${p.quantityGiven}, so the leftover cannot be more than that.`);
          return;
        }
      }
    }
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
              quantity_leftover: Number(leftovers[p.productId] ?? 0),
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
      setPhotos([]);
      setTargetId(null);
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
              onPress={() => { setVisitType('farmer'); setTargetId(null); }}
            >
              <Text style={[styles.typeChipText, visitType === 'farmer' && styles.typeChipTextActive]}>Farmer Visit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.typeChip, visitType === 'dealer' && styles.typeChipActive]}
              onPress={() => { setVisitType('dealer'); setTargetId(null); }}
            >
              <Text style={[styles.typeChipText, visitType === 'dealer' && styles.typeChipTextActive]}>Dealer Visit</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.trialBoxTitle}>{visitType === 'farmer' ? 'Farmer visited' : 'Dealer visited'}</Text>
          {selectedTarget ? (
            <TouchableOpacity style={styles.purposeInput} onPress={() => setTargetId(null)}>
              <Text style={styles.productName}>{selectedTarget.name}{selectedTarget.sub ? ` · ${selectedTarget.sub}` : ''}  (change)</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ marginBottom: 12 }}>
              <SearchBox value={targetQuery} onChangeText={setTargetQuery} placeholder={`Search ${visitType === 'farmer' ? 'farmer' : 'dealer'}…`} />
              {targets.length === 0 && (
                <Text style={styles.trialHint}>No {visitType}s found yet. Register one first (Field &gt; {visitType === 'farmer' ? 'Farmers' : 'Dealers'}).</Text>
              )}
              {shownTargets.map((t) => (
                <TouchableOpacity key={t.id} style={styles.productCheckRow} onPress={() => setTargetId(t.id)}>
                  <Text style={styles.productName}>{t.name}{t.sub ? ` · ${t.sub}` : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.photoButtons}>
            <TouchableOpacity style={[styles.btnAction, styles.photoButton]} onPress={handleTakePhoto}>
              <Ionicons name="camera-outline" size={28} color={color.primary} style={styles.actionIcon} />
              <Text style={styles.actionLabel}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnAction, styles.photoButton]} onPress={handlePickPhotos}>
              <Ionicons name="images-outline" size={28} color={color.primary} style={styles.actionIcon} />
              <Text style={styles.actionLabel}>From Gallery</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.photoHint}>
            {uploadingPhoto
              ? 'Uploading...'
              : photos.length === 0
                ? 'Add one or more farm photos (up to 10).'
                : `${uploadedUrls.length} photo${uploadedUrls.length === 1 ? '' : 's'} attached. Tap a failed one to retry.`}
          </Text>
          {photos.length > 0 && (
            <ScrollView horizontal style={styles.photoStrip} showsHorizontalScrollIndicator={false}>
              {photos.map((p) => (
                <TouchableOpacity key={p.uri} onPress={() => (p.failed ? retryPhoto(p.uri) : undefined)} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={[styles.thumb, !p.url && !p.failed && { opacity: 0.5 }]} />
                  {p.failed && <Text style={styles.thumbFailed}>Retry</Text>}
                  <TouchableOpacity onPress={() => removePhoto(p.uri)} style={styles.thumbRemove} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={color.error} />
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

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
                <Text style={styles.trialHint}>Admin has not issued any product to you yet, so there is nothing to give in a trial. Ask admin to issue stock.</Text>
              ) : (
                <>
                <SearchBox value={productQuery} onChangeText={setProductQuery} />
                {(products ?? []).filter((p) => matchesQuery(p.name, productQuery) || trialSelections.some((t) => t.productId === p.id)).length === 0 && (
                  <Text style={styles.trialHint}>No product matches “{productQuery}”.</Text>
                )}
                {(products ?? []).filter((p) => matchesQuery(p.name, productQuery) || trialSelections.some((t) => t.productId === p.id)).map((product) => {
                  const selected = trialSelections.find((p) => p.productId === product.id);
                  return (
                    <View key={product.id} style={styles.productRow}>
                      <TouchableOpacity style={styles.productCheckRow} onPress={() => toggleProduct(product)}>
                        <View style={[styles.checkbox, !!selected && styles.checkboxChecked]}>
                          {!!selected && <Text style={styles.checkmark}>✓</Text>}
                        </View>
                        <Text style={styles.productName}>{product.name} ({product.available} left)</Text>
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
                })}
                </>
              )}
            </View>
          )}

          <TouchableOpacity style={[styles.btnStart, busy && { opacity: 0.6 }]} onPress={handleStartVisit} disabled={busy}>
            <Text style={styles.btnText}>{busy ? 'Starting… getting GPS' : 'Start Visit Session'}</Text>
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
                  <Text style={styles.productName}>{p.productName} (took {p.quantityGiven})</Text>
                  <TextInput
                    style={styles.qtyInput}
                    placeholder="Left unused"
                    placeholderTextColor={color.textMuted}
                    keyboardType="numeric"
                    value={leftovers[p.productId] ?? ''}
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
  photoButtons: { flexDirection: 'row', gap: 10 },
  photoButton: { flex: 1 },
  photoHint: { fontSize: font.caption, color: color.textSecondary, marginTop: 6, marginBottom: 6 },
  photoStrip: { marginBottom: 10 },
  thumbWrap: { marginRight: 8 },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: color.borderLight },
  thumbFailed: { position: 'absolute', bottom: 4, left: 4, right: 4, textAlign: 'center', fontSize: 11, color: '#fff', backgroundColor: 'rgba(160,30,30,0.85)', borderRadius: 4 },
  thumbRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 10 },
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
