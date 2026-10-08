import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { apiClient } from '../services/api';
import { color, font, fontWeight, spacing, radius } from '../theme';
import { STEP_TITLES, OTHER_ID, isOtherName, type Farmer, type MasterItem, type CropOption, type VarietyOption, FARMING_TYPES } from './dailyVisitTracker/types';
import Step1VisitDetails from './dailyVisitTracker/Step1VisitDetails';
import Step2FarmerFarm from './dailyVisitTracker/Step2FarmerFarm';
import Step3CropProfile from './dailyVisitTracker/Step3CropProfile';
import Step4FarmPractices from './dailyVisitTracker/Step4FarmPractices';
import Step5HealthDiagnosis from './dailyVisitTracker/Step5HealthDiagnosis';
import Step6TrialDemo, { type StockItem, type TrialProductSel } from './dailyVisitTracker/Step6TrialDemo';
import Step7SalesConversion, { type Product, type SaleProductSel } from './dailyVisitTracker/Step7SalesConversion';
import Step8PhotosRemarks, { type PhotoItem } from './dailyVisitTracker/Step8PhotosRemarks';
import Step9ReviewSubmit, { type ReviewSection } from './dailyVisitTracker/Step9ReviewSubmit';
import { showSubmitResult } from '../utils/offlineAlert';
import type { DailyVisitSubmitPayload } from './dailyVisitTracker/types';
import DynamicFieldRenderer from '../components/DynamicFieldRenderer';

/**
 * Daily Visit Tracker - the structured, multi-step farmer-visit report.
 *
 * Deliberately separate from VisitScreen.tsx, which stays exactly as-is:
 * VisitScreen is a quick GPS check-in/out (attendance-style, with the
 * Trial toggle and KPI-summary fields from earlier phases) and must not
 * be touched or replaced - it's a different, working feature. This is
 * the new, deeper structured report the spec calls for: farmer/crop/
 * health/trial/sales detail across 9 steps.
 *
 * This file is the container: it owns all form state and step
 * navigation, and renders one of the step components below per the
 * current step index. Split out of a single 1100+ line file once Step 4
 * landed - each step's fields, styles, and props now live in
 * ./dailyVisitTracker/StepN*.tsx so this stays readable as steps 5-9
 * get built.
 *
 * STATUS: All 9 steps are wired to real data and a real submit endpoint
 * (POST /visits/daily-tracker/submit). See the implementation notes
 * scattered through this file and its step components for the handful
 * of deliberate simplifications made along the way (chip-row pickers
 * instead of searchable dropdowns, plain-text dates instead of a native
 * picker, taluk reusing the village/block answer since Step 1 doesn't
 * separately ask for it).
 */
export default function DailyVisitTrackerScreen({ navigation, route }: any) {
  // Section 17 (safe area): this footer is a custom bottom bar inside a
  // pushed stack screen, not the tab bar itself, so it doesn't get React
  // Navigation's automatic inset handling - on a phone with a home
  // indicator/gesture bar, Back/Next/Save Draft would sit flush against
  // it. This is the app's single highest-traffic form (every field
  // officer, every visit), so it's worth the explicit fix.
  const insets = useSafeAreaInsets();
  const resumeDraftId: string | undefined = route?.params?.draftId;
  // When launched from the day-closure gate (ProfileScreen's Sign Out
  // flow) instead of the normal "New Visit" entry point, submit to
  // /day-closure instead of /visits/daily-tracker/submit - same payload
  // shape, same steps, same every field, since day_closure_router.py's
  // POST endpoint accepts the exact same DailyVisitTrackerSubmitRequest
  // and internally calls the same submit_daily_visit() logic. Reusing
  // this whole screen rather than building a second one keeps the field
  // set from ever being able to drift between "a normal visit" and
  // "today's closure" - they're the same form either way.
  const isDayClosureMode: boolean = !!route?.params?.dayClosureMode;
  // Admin's "File Missed Closure" screen (AdminFileClosureScreen.tsx)
  // launches this same screen with an officer already chosen, so the
  // admin fills out one FIELD OFFICER'S missed day on their behalf -
  // same exact form, only the submit target changes to POST
  // /admin/day-closures?officer_id=... (admin_create_day_closure in
  // admin_router.py), matching web's DayClosureForm adminOfficerId prop
  // exactly. Implies day-closure mode, since an admin is never filing an
  // ordinary ad-hoc visit on someone else's behalf.
  const adminOfficerId: string | undefined = route?.params?.adminOfficerId;
  const [draftId, setDraftId] = useState<string | undefined>(resumeDraftId);
  const [savingDraft, setSavingDraft] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(!!resumeDraftId);
  const [step, setStep] = useState(0);
  const currentUser = apiClient.getCurrentUser();

  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customFieldAnswers, setCustomFieldAnswers] = useState<Record<string, any>>({});
  const [configVersion, setConfigVersion] = useState<number>(1);

  useEffect(() => {
    apiClient.request('/custom-fields/day_closure', 'GET', 'plan_submit')
      .then((res: any) => {
        setCustomFields(res?.fields || []);
        if (res?.version) setConfigVersion(res.version);
      })
      .catch((err) => console.warn('Failed to load custom fields', err));
  }, []);

  // --- Step 1 state ---
  const [visitDate] = useState(new Date());
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [district, setDistrict] = useState('');
  const [villageBlock, setVillageBlock] = useState('');

  // --- Step 2 state ---
  const [farmerMode, setFarmerMode] = useState<'new' | 'existing'>('new');
  const [myFarmers, setMyFarmers] = useState<Farmer[]>([]);
  const [loadingFarmers, setLoadingFarmers] = useState(false);
  const [farmerSearch, setFarmerSearch] = useState('');
  const [selectedFarmer, setSelectedFarmer] = useState<Farmer | null>(null);
  const [farmerName, setFarmerName] = useState('');
  const [farmerPhone, setFarmerPhone] = useState('');
  const [farmSize, setFarmSize] = useState('');
  const [farmSizeUnit] = useState('cents');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    if (farmerMode !== 'existing' || myFarmers.length > 0) return;
    setLoadingFarmers(true);
    apiClient
      .request('/farmers/search', 'GET', 'farmer_register')
      .then((data: Farmer[]) => setMyFarmers(data || []))
      .catch((err) => console.warn('Failed to load farmer list', err))
      .finally(() => setLoadingFarmers(false));
  }, [farmerMode]);

  const filteredFarmers = myFarmers.filter((f) => {
    const q = farmerSearch.trim().toLowerCase();
    if (!q) return true;
    return f.name.toLowerCase().includes(q) || f.phone.includes(q);
  });

  const selectExistingFarmer = (farmer: Farmer) => {
    setSelectedFarmer(farmer);
    setFarmerName(farmer.name);
    setFarmerPhone(farmer.phone);
    setFarmSize(farmer.cents ? String(farmer.cents) : '');
    if (farmer.district) setDistrict(farmer.district);
    if (farmer.village) setVillageBlock(farmer.village);
  };

  const validatePhone = (value: string): boolean => {
    const valid = /^[6-9]\d{9}$/.test(value.trim());
    setPhoneError(valid || value.trim() === '' ? null : 'Enter a valid 10-digit Indian mobile number');
    return valid;
  };

  // --- Step 3 state ---
  const [cropCategories, setCropCategories] = useState<MasterItem[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [varieties, setVarieties] = useState<VarietyOption[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedCropId, setSelectedCropId] = useState<string | null>(null);
  const [selectedVarietyId, setSelectedVarietyId] = useState<string | null>(null);
  const [varietyText, setVarietyText] = useState('');
  const [cropAgeValue, setCropAgeValue] = useState('');
  const [cropAgeUnit, setCropAgeUnit] = useState<'days' | 'weeks' | 'months'>('days');
  const [sowingDate, setSowingDate] = useState('');
  const [previousCropText, setPreviousCropText] = useState('');
  const [previousYieldValue, setPreviousYieldValue] = useState('');
  const [previousYieldUnit, setPreviousYieldUnit] = useState('');
  const [farmingType, setFarmingType] = useState<string | null>(null);

  // What the officer typed after choosing "Other", keyed by list:
  // category, crop, pests, diseases, chemical, micro:<id>, op:<id>, org:<id>.
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const setOtherText = (key: string, v: string) => setOtherTexts((prev) => ({ ...prev, [key]: v }));

  useEffect(() => {
    if (step !== 2 || cropCategories.length > 0) return;
    apiClient
      .request('/master-data/crop-categories', 'GET', 'plan_submit')
      .then((data: MasterItem[]) => setCropCategories(data || []))
      .catch((err) => console.warn('Failed to load crop categories', err));
  }, [step]);

  useEffect(() => {
    if (!selectedCategoryId || selectedCategoryId === OTHER_ID) { setCrops([]); if (selectedCategoryId) setSelectedCropId(null); return; }
    setSelectedCropId(null);
    apiClient
      .request(`/master-data/crops?crop_category_id=${selectedCategoryId}`, 'GET', 'plan_submit')
      .then((data: CropOption[]) => setCrops(data || []))
      .catch((err) => console.warn('Failed to load crops', err));
  }, [selectedCategoryId]);

  useEffect(() => {
    if (!selectedCropId || selectedCropId === OTHER_ID) { setVarieties([]); return; }
    setSelectedVarietyId(null);
    apiClient
      .request(`/master-data/crop-varieties?crop_id=${selectedCropId}`, 'GET', 'plan_submit')
      .then((data: VarietyOption[]) => setVarieties(data || []))
      .catch((err) => console.warn('Failed to load crop varieties', err));
  }, [selectedCropId]);

  // --- Step 4 state ---
  const [npkN, setNpkN] = useState('');
  const [npkP, setNpkP] = useState('');
  const [npkK, setNpkK] = useState('');
  const [npkUnit, setNpkUnit] = useState('kg');
  const [npkFrequency, setNpkFrequency] = useState('');

  const [micronutrientOptions, setMicronutrientOptions] = useState<MasterItem[]>([]);
  const [selectedMicronutrients, setSelectedMicronutrients] = useState<Record<string, { quantity: string; unit: string }>>({});

  const [farmOperationOptions, setFarmOperationOptions] = useState<MasterItem[]>([]);
  const [selectedFarmOperations, setSelectedFarmOperations] = useState<Record<string, { date: string; remarks: string }>>({});

  const [organicSolutionOptions, setOrganicSolutionOptions] = useState<MasterItem[]>([]);
  const [selectedOrganicSolutions, setSelectedOrganicSolutions] = useState<Record<string, { quantity: string; unit: string; remarks: string }>>({});

  const [usedAdvisory, setUsedAdvisory] = useState<boolean | null>(null);
  const [advisorySource, setAdvisorySource] = useState<'agri_clinic' | 'kvk' | 'other' | null>(null);
  const [advisoryRemarks, setAdvisoryRemarks] = useState('');

  // --- Step 5 state ---
  const [cropStatus, setCropStatus] = useState<string | null>(null);
  const [statusOtherText, setStatusOtherText] = useState('');
  const [pestOptions, setPestOptions] = useState<MasterItem[]>([]);
  const [selectedPestIds, setSelectedPestIds] = useState<string[]>([]);
  const [diseaseOptions, setDiseaseOptions] = useState<MasterItem[]>([]);
  const [selectedDiseaseIds, setSelectedDiseaseIds] = useState<string[]>([]);
  const [chemicalOptions, setChemicalOptions] = useState<MasterItem[]>([]);
  const [selectedChemicals, setSelectedChemicals] = useState<Record<string, { quantity: string; frequency: string }>>({});
  const [severity, setSeverity] = useState<number | null>(null);

  // Only fetched once the officer actually needs them (crop status =
  // Pest/Disease Affected) rather than on every visit to step 5, since
  // most visits won't need this diagnosis branch at all.
  useEffect(() => {
    if (step !== 4 || cropStatus !== 'pest_disease_affected') return;
    if (pestOptions.length === 0) {
      apiClient.request('/master-data/pests', 'GET', 'plan_submit')
        .then((d: MasterItem[]) => setPestOptions(d || []))
        .catch((err) => console.warn('Failed to load pests', err));
    }
    if (diseaseOptions.length === 0) {
      apiClient.request('/master-data/diseases', 'GET', 'plan_submit')
        .then((d: MasterItem[]) => setDiseaseOptions(d || []))
        .catch((err) => console.warn('Failed to load diseases', err));
    }
    if (chemicalOptions.length === 0) {
      apiClient.request('/master-data/chemicals', 'GET', 'plan_submit')
        .then((d: MasterItem[]) => setChemicalOptions(d || []))
        .catch((err) => console.warn('Failed to load chemicals', err));
    }
  }, [step, cropStatus]);

  const togglePest = (id: string) => {
    setSelectedPestIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };
  const toggleDisease = (id: string) => {
    setSelectedDiseaseIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };
  const toggleChemical = (id: string) => {
    setSelectedChemicals((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = { quantity: '', frequency: '' };
      return next;
    });
  };

  // --- Step 6 state ---
  const [isTrial, setIsTrial] = useState<boolean | null>(null);
  const [visitPurpose, setVisitPurpose] = useState<string | null>(null);
  const [demoStatus, setDemoStatus] = useState<string | null>(null);
  const [trialPlotSize, setTrialPlotSize] = useState('');
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [selectedTrialProducts, setSelectedTrialProducts] = useState<TrialProductSel>({});

  useEffect(() => {
    if (step !== 5 || isTrial !== true || stockItems.length > 0) return;
    setLoadingStock(true);
    apiClient
      .request('/stock/my-stock', 'GET', 'plan_submit')
      .then((data: any[]) => setStockItems((data || []).map(item => ({
        ...item,
        remaining_stock: item.current_quantity
      }))))
      .catch((err) => console.warn('Failed to load officer stock', err))
      .finally(() => setLoadingStock(false));
  }, [step, isTrial]);

  const toggleTrialProduct = (productId: string) => {
    setSelectedTrialProducts((prev) => {
      const next = { ...prev };
      if (next[productId]) delete next[productId];
      else next[productId] = { quantityGiven: '' };
      return next;
    });
  };

  // --- Step 7 state ---
  const [purchased, setPurchased] = useState<boolean | null>(null);
  const [saleProducts, setSaleProducts] = useState<Product[]>([]);
  const [loadingSaleProducts, setLoadingSaleProducts] = useState(false);
  const [selectedSaleProducts, setSelectedSaleProducts] = useState<SaleProductSel>({});
  const [orderValue, setOrderValue] = useState('');
  const [conversionStatus, setConversionStatus] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 6 || purchased !== true || saleProducts.length > 0) return;
    setLoadingSaleProducts(true);
    apiClient
      .request('/dealers/products/catalog', 'GET', 'stock_audit')
      .then((data: Product[]) => setSaleProducts(data || []))
      .catch((err) => console.warn('Failed to load product catalog', err))
      .finally(() => setLoadingSaleProducts(false));
  }, [step, purchased]);

  const toggleSaleProduct = (productId: string) => {
    setSelectedSaleProducts((prev) => {
      const next = { ...prev };
      if (next[productId]) delete next[productId];
      else next[productId] = { quantity: '' };
      return next;
    });
  };

  // --- Step 8 state ---
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [officerRemarks, setOfficerRemarks] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [followUpRemarks, setFollowUpRemarks] = useState('');

  const uploadPhoto = async (uri: string) => {
    setPhotos((prev) => [...prev, { uri, uploadedUrl: null, uploading: true }]);
    try {
      // Same /issues/upload endpoint + apiClient.uploadFile pattern
      // VisitScreen and CropIssueScreen already use - one centralized
      // file-storage seam, not a new upload path for this step.
      const url = await apiClient.uploadFile('/issues/upload', uri, `visit-${Date.now()}.jpg`, 'image/jpeg');
      setPhotos((prev) => prev.map((p) => (p.uri === uri ? { ...p, uploadedUrl: url, uploading: false } : p)));
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message || 'Could not upload the photo.');
      setPhotos((prev) => prev.filter((p) => p.uri !== uri));
    }
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera Required', 'Camera access is needed to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (result.canceled || !result.assets?.[0]) return;
    uploadPhoto(result.assets[0].uri);
  };

  const handlePickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Gallery Access Required', 'Photo library access is needed to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });
    if (result.canceled || !result.assets?.[0]) return;
    uploadPhoto(result.assets[0].uri);
  };

  const removePhoto = (uri: string) => {
    setPhotos((prev) => prev.filter((p) => p.uri !== uri));
  };

  // --- Step 9: build payload + review summary from everything above ---
  const [submitting, setSubmitting] = useState(false);

  const nameIn = (list: MasterItem[], id: string | null | undefined) => list.find((i) => i.id === id)?.name;
  const categoryIsOther = selectedCategoryId === OTHER_ID || isOtherName(nameIn(cropCategories, selectedCategoryId));
  const cropIsOther = selectedCropId === OTHER_ID || isOtherName(nameIn(crops, selectedCropId));
  const pestIsOther = selectedPestIds.some((id) => isOtherName(nameIn(pestOptions, id)));
  const diseaseIsOther = selectedDiseaseIds.some((id) => isOtherName(nameIn(diseaseOptions, id)));
  const typed = (key: string): string | undefined => otherTexts[key]?.trim() || undefined;

  // The first "Other" the officer chose but did not describe, or null.
  const missingOtherText = (forStep: number): string | null => {
    if (forStep === 2) {
      if (categoryIsOther && !typed('category')) return 'Please type the crop category you chose as "Other".';
      if (cropIsOther && !typed('crop')) return 'Please type the crop you chose as "Other".';
      if (selectedVarietyId && (selectedVarietyId === OTHER_ID || isOtherName(nameIn(varieties, selectedVarietyId))) && !varietyText.trim()) {
        return 'Please type the variety you chose as "Other".';
      }
    }
    if (forStep === 3) {
      const lists: [Record<string, unknown>, MasterItem[], string][] = [
        [selectedMicronutrients, micronutrientOptions, 'micro'],
        [selectedFarmOperations, farmOperationOptions, 'op'],
        [selectedOrganicSolutions, organicSolutionOptions, 'org'],
      ];
      for (const [chosen, options, prefix] of lists) {
        for (const id of Object.keys(chosen)) {
          if (isOtherName(nameIn(options, id)) && !typed(`${prefix}:${id}`)) return 'Please type your answer for the "Other" you selected.';
        }
      }
    }
    if (forStep === 4 && cropStatus === 'pest_disease_affected') {
      if (pestIsOther && !typed('pests')) return 'Please type the pest you chose as "Other".';
      if (diseaseIsOther && !typed('diseases')) return 'Please type the disease you chose as "Other".';
      if (selectedChemicals[OTHER_ID] && !typed('chemical')) return 'Please type the chemical you chose as "Other".';
    }
    return null;
  };

  const buildPayload = (): DailyVisitSubmitPayload => ({
    latitude: gps?.lat ?? 0,
    longitude: gps?.lng ?? 0,
    ...(farmerMode === 'existing' && selectedFarmer
      ? { farmer_id: selectedFarmer.id }
      : {
          new_farmer: {
            name: farmerName,
            phone: farmerPhone,
            village: villageBlock,
            taluk: villageBlock, // no separate taluk field collected in this wizard - village/block doubles as taluk for new-farmer creation, matching the coarser granularity Step 1 actually asks for
            district,
            crop: cropIsOther ? (typed('crop') ?? 'Other') : (crops.find((c) => c.id === selectedCropId)?.name ?? ''),
            cents: Number(farmSize) || 0,
          },
        }),
    farm_size_value: Number(farmSize) || 0,
    farm_size_unit: farmSizeUnit,
    crop_category_id: selectedCategoryId && selectedCategoryId !== OTHER_ID ? selectedCategoryId : undefined,
    crop_category_other_text: categoryIsOther ? typed('category') : undefined,
    crop_id: selectedCropId && selectedCropId !== OTHER_ID ? selectedCropId : undefined,
    crop_other_text: cropIsOther ? typed('crop') : undefined,
    variety_id: selectedVarietyId && selectedVarietyId !== OTHER_ID ? selectedVarietyId : undefined,
    variety_text: varietyText || undefined,
    crop_age_value: cropAgeValue ? Number(cropAgeValue) : undefined,
    crop_age_unit: cropAgeValue ? cropAgeUnit : undefined,
    sowing_date: sowingDate || undefined,
    previous_crop_text: previousCropText || undefined,
    previous_yield_value: previousYieldValue ? Number(previousYieldValue) : undefined,
    previous_yield_unit: previousYieldUnit || undefined,
    farming_type: farmingType ?? '',
    npk_n: npkN ? Number(npkN) : undefined,
    npk_p: npkP ? Number(npkP) : undefined,
    npk_k: npkK ? Number(npkK) : undefined,
    npk_unit: (npkN || npkP || npkK) ? npkUnit : undefined,
    npk_frequency: npkFrequency || undefined,
    micronutrients: Object.entries(selectedMicronutrients).map(([id, v]) => ({
      micronutrient_id: id,
      quantity: v.quantity ? Number(v.quantity) : undefined,
      unit: v.unit || undefined,
      other_text: isOtherName(nameIn(micronutrientOptions, id)) ? typed(`micro:${id}`) : undefined,
    })),
    farm_operations: Object.entries(selectedFarmOperations).map(([id, v]) => ({
      farm_operation_id: id,
      performed_date: v.date || undefined,
      remarks: v.remarks || undefined,
      other_text: isOtherName(nameIn(farmOperationOptions, id)) ? typed(`op:${id}`) : undefined,
    })),
    organic_solutions: Object.entries(selectedOrganicSolutions).map(([id, v]) => ({
      organic_solution_id: id,
      quantity: v.quantity ? Number(v.quantity) : undefined,
      unit: v.unit || undefined,
      remarks: v.remarks || undefined,
      other_text: isOtherName(nameIn(organicSolutionOptions, id)) ? typed(`org:${id}`) : undefined,
    })),
    used_advisory: usedAdvisory === true,
    advisory_source: advisorySource ?? undefined,
    advisory_remarks: advisoryRemarks || undefined,
    crop_status: cropStatus ?? '',
    status_other_text: cropStatus === 'other' ? (statusOtherText || undefined) : undefined,
    pest_ids: selectedPestIds,
    pest_other_text: pestIsOther ? typed('pests') : undefined,
    disease_ids: selectedDiseaseIds,
    disease_other_text: diseaseIsOther ? typed('diseases') : undefined,
    chemicals: Object.entries(selectedChemicals).map(([id, v]) => ({
      chemical_id: id === OTHER_ID ? undefined : id,
      chemical_name_text: id === OTHER_ID ? typed('chemical') : undefined,
      quantity: v.quantity || undefined,
      frequency: v.frequency || undefined,
    })),
    severity: cropStatus === 'pest_disease_affected' ? severity ?? undefined : undefined,
    is_trial: isTrial === true,
    visit_purpose: isTrial ? visitPurpose ?? undefined : undefined,
    demo_status: isTrial ? demoStatus ?? undefined : undefined,
    trial_plot_size_cents: isTrial && trialPlotSize ? Number(trialPlotSize) : undefined,
    trial_products: isTrial
      ? Object.entries(selectedTrialProducts).map(([id, v]) => ({ product_id: id, quantity_given: Number(v.quantityGiven) || 0 }))
      : [],
    purchased: purchased === true,
    sale_items: purchased
      ? Object.entries(selectedSaleProducts).map(([id, v]) => ({ product_id: id, quantity: Number(v.quantity) || 0 }))
      : [],
    order_value: purchased && orderValue ? Number(orderValue) : undefined,
    conversion_status: purchased ? conversionStatus ?? undefined : undefined,
    photo_urls: photos.filter((p) => p.uploadedUrl).map((p) => p.uploadedUrl as string),
    config_version: configVersion,
    custom_field_answers: customFieldAnswers,
    officer_remarks: officerRemarks || undefined,
    next_follow_up_date: nextFollowUpDate || undefined,
    follow_up_remarks: followUpRemarks || undefined,
  });

  const buildReviewSections = (): ReviewSection[] => [
    {
      title: 'Visit Details',
      stepIndex: 0,
      rows: [
        { label: 'District', value: district || '—' },
        { label: 'Village/Block', value: villageBlock || '—' },
        { label: 'GPS', value: gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'Not captured' },
      ],
    },
    {
      title: 'Farmer & Farm',
      stepIndex: 1,
      rows: [
        { label: 'Farmer', value: farmerName || '—' },
        { label: 'Contact', value: farmerPhone || '—' },
        { label: 'Farm Size', value: farmSize ? `${farmSize} ${farmSizeUnit}` : '—' },
      ],
    },
    {
      title: 'Crop Profile',
      stepIndex: 2,
      rows: [
        { label: 'Crop', value: cropIsOther ? `Other: ${typed('crop') ?? ''}` : crops.find((c) => c.id === selectedCropId)?.name ?? '—' },
        { label: 'Farming Type', value: FARMING_TYPES.find((f) => f.value === farmingType)?.label ?? '—' },
      ],
    },
    {
      title: 'Crop Health',
      stepIndex: 4,
      rows: [
        { label: 'Status', value: cropStatus ?? '—' },
        ...(cropStatus === 'pest_disease_affected' ? [{ label: 'Severity', value: severity !== null ? String(severity) : '—' }] : []),
      ],
    },
    {
      title: 'Trial / Demo',
      stepIndex: 5,
      rows: [
        { label: 'Trial', value: isTrial === null ? '—' : isTrial ? 'Yes' : 'No' },
        ...(isTrial
          ? [{ label: 'Products', value: Object.keys(selectedTrialProducts).length > 0 ? `${Object.keys(selectedTrialProducts).length} selected` : '—' }]
          : []),
      ],
    },
    {
      title: 'Sales Conversion',
      stepIndex: 6,
      rows: [
        { label: 'Purchased', value: purchased === null ? '—' : purchased ? 'Yes' : 'No' },
        ...(purchased ? [{ label: 'Order Value', value: orderValue ? `₹${orderValue}` : '—' }] : []),
      ],
    },
  ];

  const handleSubmit = async () => {
    for (const s of [2, 3, 4]) {
      const problem = missingOtherText(s);
      if (problem) {
        Alert.alert('Missing Information', problem);
        return;
      }
    }
    setSubmitting(true);
    try {
      const endpoint = adminOfficerId
        ? `/admin/day-closures?officer_id=${encodeURIComponent(adminOfficerId)}`
        : isDayClosureMode
        ? '/day-closure'
        : '/visits/daily-tracker/submit';
      const res = await apiClient.request(endpoint, 'POST', 'visit_tracker_submit', {
        ...buildPayload(),
        // draft_id only makes sense for the officer's own draft - an
        // admin filing on someone else's behalf never has one.
        draft_id: adminOfficerId ? undefined : draftId,
      });
      if (adminOfficerId) {
        showSubmitResult(res, 'Closure Filed', "The missed closure has been recorded for this officer.");
      } else if (isDayClosureMode) {
        showSubmitResult(res, 'Closure Submitted', "Today's closure has been recorded.");
      } else {
        showSubmitResult(res, 'Visit Submitted', 'The visit report has been saved.');
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Could Not Submit', err.message || 'Please check the form and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // --- Save Draft / Resume Draft (sections 26/27) ---

  // A raw snapshot of everything the officer has entered so far, not the
  // typed submit payload - a draft is legitimately incomplete (missing
  // required fields buildPayload's shape assumes), so this captures
  // state as-is rather than trying to force it through
  // DailyVisitSubmitPayload's validation. The three underscore-prefixed
  // fields exist only so the drafts list can show something meaningful
  // without the backend needing to understand this blob's shape.
  const buildDraftBlob = () => ({
    _farmer_name: farmerName || undefined,
    _crop_name: cropIsOther ? typed('crop') : crops.find((c) => c.id === selectedCropId)?.name,
    _step_label: STEP_TITLES[step],
    step, district, villageBlock, gps,
    farmerMode, selectedFarmer, farmerName, farmerPhone, farmSize,
    selectedCategoryId, selectedCropId, selectedVarietyId, varietyText,
    cropAgeValue, cropAgeUnit, sowingDate, previousCropText, previousYieldValue, previousYieldUnit, farmingType,
    npkN, npkP, npkK, npkUnit, npkFrequency,
    selectedMicronutrients, selectedFarmOperations, selectedOrganicSolutions,
    usedAdvisory, advisorySource, advisoryRemarks,
    cropStatus, selectedPestIds, selectedDiseaseIds, selectedChemicals, severity, otherTexts,
    isTrial, visitPurpose, demoStatus, trialPlotSize, selectedTrialProducts,
    purchased, selectedSaleProducts, orderValue, conversionStatus,
    // Only fully-uploaded photos are worth saving - a mid-upload local
    // URI won't exist as a stable reference once the app is closed and
    // reopened later to resume this draft.
    photos: photos.filter((p) => p.uploadedUrl).map((p) => ({ uri: p.uri, uploadedUrl: p.uploadedUrl, uploading: false })),
    officerRemarks, nextFollowUpDate, followUpRemarks,
  });

  const loadDraftBlob = (d: any) => {
    if (typeof d.step === 'number') setStep(d.step);
    if (d.district) setDistrict(d.district);
    if (d.villageBlock) setVillageBlock(d.villageBlock);
    if (d.gps) setGps(d.gps);
    if (d.farmerMode) setFarmerMode(d.farmerMode);
    if (d.selectedFarmer) setSelectedFarmer(d.selectedFarmer);
    if (d.farmerName) setFarmerName(d.farmerName);
    if (d.farmerPhone) setFarmerPhone(d.farmerPhone);
    if (d.farmSize) setFarmSize(d.farmSize);
    if (d.selectedCategoryId) setSelectedCategoryId(d.selectedCategoryId);
    if (d.selectedCropId) setSelectedCropId(d.selectedCropId);
    if (d.selectedVarietyId) setSelectedVarietyId(d.selectedVarietyId);
    if (d.varietyText) setVarietyText(d.varietyText);
    if (d.cropAgeValue) setCropAgeValue(d.cropAgeValue);
    if (d.cropAgeUnit) setCropAgeUnit(d.cropAgeUnit);
    if (d.sowingDate) setSowingDate(d.sowingDate);
    if (d.previousCropText) setPreviousCropText(d.previousCropText);
    if (d.previousYieldValue) setPreviousYieldValue(d.previousYieldValue);
    if (d.previousYieldUnit) setPreviousYieldUnit(d.previousYieldUnit);
    if (d.farmingType) setFarmingType(d.farmingType);
    if (d.npkN) setNpkN(d.npkN);
    if (d.npkP) setNpkP(d.npkP);
    if (d.npkK) setNpkK(d.npkK);
    if (d.npkUnit) setNpkUnit(d.npkUnit);
    if (d.npkFrequency) setNpkFrequency(d.npkFrequency);
    if (d.selectedMicronutrients) setSelectedMicronutrients(d.selectedMicronutrients);
    if (d.selectedFarmOperations) setSelectedFarmOperations(d.selectedFarmOperations);
    if (d.selectedOrganicSolutions) setSelectedOrganicSolutions(d.selectedOrganicSolutions);
    if (typeof d.usedAdvisory === 'boolean') setUsedAdvisory(d.usedAdvisory);
    if (d.advisorySource) setAdvisorySource(d.advisorySource);
    if (d.advisoryRemarks) setAdvisoryRemarks(d.advisoryRemarks);
    if (d.cropStatus) setCropStatus(d.cropStatus);
    if (d.selectedPestIds) setSelectedPestIds(d.selectedPestIds);
    if (d.selectedDiseaseIds) setSelectedDiseaseIds(d.selectedDiseaseIds);
    if (d.selectedChemicals) setSelectedChemicals(d.selectedChemicals);
    if (typeof d.severity === 'number') setSeverity(d.severity);
    if (d.otherTexts) setOtherTexts(d.otherTexts);
    if (typeof d.isTrial === 'boolean') setIsTrial(d.isTrial);
    if (d.visitPurpose) setVisitPurpose(d.visitPurpose);
    if (d.demoStatus) setDemoStatus(d.demoStatus);
    if (d.trialPlotSize) setTrialPlotSize(d.trialPlotSize);
    if (d.selectedTrialProducts) setSelectedTrialProducts(d.selectedTrialProducts);
    if (typeof d.purchased === 'boolean') setPurchased(d.purchased);
    if (d.selectedSaleProducts) setSelectedSaleProducts(d.selectedSaleProducts);
    if (d.orderValue) setOrderValue(d.orderValue);
    if (d.conversionStatus) setConversionStatus(d.conversionStatus);
    if (d.photos) setPhotos(d.photos);
    if (d.officerRemarks) setOfficerRemarks(d.officerRemarks);
    if (d.nextFollowUpDate) setNextFollowUpDate(d.nextFollowUpDate);
    if (d.followUpRemarks) setFollowUpRemarks(d.followUpRemarks);
  };

  useEffect(() => {
    if (!resumeDraftId) return;
    apiClient
      .request(`/visits/daily-tracker/drafts/${resumeDraftId}`, 'GET', 'plan_submit')
      .then((data: any) => loadDraftBlob(data))
      .catch((err) => Alert.alert('Could Not Load Draft', err.message || 'Please try again.'))
      .finally(() => setLoadingDraft(false));
  }, [resumeDraftId]);

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const res: any = await apiClient.request('/visits/daily-tracker/drafts', 'POST', 'plan_submit', {
        draft_id: draftId,
        draft_data: buildDraftBlob(),
      });
      if (res?.draft_id) setDraftId(res.draft_id);
      Alert.alert('Draft Saved', 'You can continue this visit later from Field Network → Draft Visits.');
    } catch (err: any) {
      Alert.alert('Could Not Save Draft', err.message || 'Please try again.');
    } finally {
      setSavingDraft(false);
    }
  };

  useEffect(() => {
    if (step !== 3) return;
    if (micronutrientOptions.length === 0) {
      apiClient.request('/master-data/micronutrients', 'GET', 'plan_submit')
        .then((d: MasterItem[]) => setMicronutrientOptions(d || []))
        .catch((err) => console.warn('Failed to load micronutrients', err));
    }
    if (farmOperationOptions.length === 0) {
      apiClient.request('/master-data/farm-operations', 'GET', 'plan_submit')
        .then((d: MasterItem[]) => setFarmOperationOptions(d || []))
        .catch((err) => console.warn('Failed to load farm operations', err));
    }
    if (organicSolutionOptions.length === 0) {
      apiClient.request('/master-data/organic-solutions', 'GET', 'plan_submit')
        .then((d: MasterItem[]) => setOrganicSolutionOptions(d || []))
        .catch((err) => console.warn('Failed to load organic solutions', err));
    }
  }, [step]);

  const toggleMicronutrient = (id: string) => {
    setSelectedMicronutrients((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = { quantity: '', unit: 'kg' };
      return next;
    });
  };
  const toggleFarmOperation = (id: string) => {
    setSelectedFarmOperations((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = { date: '', remarks: '' };
      return next;
    });
  };
  const toggleOrganicSolution = (id: string) => {
    setSelectedOrganicSolutions((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = { quantity: '', unit: '', remarks: '' };
      return next;
    });
  };

  const handleGetLocation = async () => {
    setGpsLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Required', 'Location permission is needed to record this visit.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGps({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch (err: any) {
      Alert.alert('Location Error', err.message || 'Could not get current location.');
    } finally {
      setGpsLoading(false);
    }
  };

  const goNext = () => {
    if (step === 0) {
      if (!district.trim() || !villageBlock.trim()) {
        Alert.alert('Missing Information', 'Please enter District and Village/Block before continuing.');
        return;
      }
    }
    if (step === 1) {
      if (farmerMode === 'existing' && !selectedFarmer) {
        Alert.alert('Select a Farmer', 'Please select an existing farmer, or switch to "New Farmer".');
        return;
      }
      if (farmerMode === 'new') {
        if (!farmerName.trim()) {
          Alert.alert('Missing Information', "Please enter the farmer's name.");
          return;
        }
        if (!validatePhone(farmerPhone)) {
          Alert.alert('Invalid Phone Number', 'Please enter a valid 10-digit Indian mobile number.');
          return;
        }
      }
      if (!farmSize.trim() || Number(farmSize) <= 0) {
        Alert.alert('Missing Information', 'Please enter a farm size greater than zero.');
        return;
      }
    }
    if (step >= 2 && step <= 4) {
      const problem = missingOtherText(step);
      if (problem) {
        Alert.alert('Missing Information', problem);
        return;
      }
    }
    if (step === 2) {
      if (!selectedCategoryId) {
        Alert.alert('Missing Information', 'Please select a crop category.');
        return;
      }
      if (!selectedCropId) {
        Alert.alert('Missing Information', 'Please select a crop.');
        return;
      }
      if (!farmingType) {
        Alert.alert('Missing Information', 'Please select a farming type.');
        return;
      }
      if (sowingDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(sowingDate.trim())) {
        Alert.alert('Invalid Date', 'Enter the sowing date as YYYY-MM-DD, or leave it blank.');
        return;
      }
    }
    if (step === 3) {
      if (usedAdvisory === true && !advisorySource) {
        Alert.alert('Missing Information', 'Please select which advisory service the farmer used.');
        return;
      }
    }
    if (step === 4) {
      if (!cropStatus) {
        Alert.alert('Missing Information', 'Please select the current crop status.');
        return;
      }
      if (cropStatus === 'pest_disease_affected' && selectedPestIds.length === 0 && selectedDiseaseIds.length === 0) {
        Alert.alert('Missing Information', 'Please select at least one pest or disease, or choose a different crop status.');
        return;
      }
      if (cropStatus === 'pest_disease_affected' && severity === null) {
        Alert.alert('Missing Information', 'Please set a severity rating.');
        return;
      }
    }
    if (step === 5) {
      if (isTrial === null) {
        Alert.alert('Missing Information', 'Please select Trial / Demo: Yes or No.');
        return;
      }
      if (isTrial) {
        if (!visitPurpose) {
          Alert.alert('Missing Information', 'Please select a visit purpose.');
          return;
        }
        if (!demoStatus) {
          Alert.alert('Missing Information', 'Please select a demo status.');
          return;
        }
        if (!trialPlotSize.trim() || Number(trialPlotSize) <= 0) {
          Alert.alert('Missing Information', 'Please enter a trial plot size greater than zero.');
          return;
        }
        const productIds = Object.keys(selectedTrialProducts);
        if (productIds.length === 0) {
          Alert.alert('Missing Information', 'Please select at least one trial product.');
          return;
        }
        for (const id of productIds) {
          const sel = selectedTrialProducts[id];
          const item = stockItems.find((s) => s.product_id === id);
          const qty = Number(sel.quantityGiven);
          if (!sel.quantityGiven.trim() || qty <= 0) {
            Alert.alert('Missing Information', 'Please enter a quantity given for every selected product.');
            return;
          }
          if (item && qty > item.remaining_stock) {
            Alert.alert('Stock Exceeded', `You only have ${item.remaining_stock} of ${item.product_name} remaining.`);
            return;
          }
        }
      }
    }
    if (step === 6) {
      if (purchased === null) {
        Alert.alert('Missing Information', 'Please select whether the farmer purchased any products.');
        return;
      }
      if (purchased) {
        const productIds = Object.keys(selectedSaleProducts);
        if (productIds.length === 0) {
          Alert.alert('Missing Information', 'Please select at least one product bought.');
          return;
        }
        for (const id of productIds) {
          if (!selectedSaleProducts[id].quantity.trim() || Number(selectedSaleProducts[id].quantity) <= 0) {
            Alert.alert('Missing Information', 'Please enter a quantity for every product bought.');
            return;
          }
        }
        if (!orderValue.trim() || Number(orderValue) <= 0) {
          Alert.alert('Missing Information', 'Please enter an order value greater than zero.');
          return;
        }
        if (!conversionStatus) {
          Alert.alert('Missing Information', 'Please select a conversion status.');
          return;
        }
      }
    }
    if (step === 7) {
      if (photos.some((p) => p.uploading)) {
        Alert.alert('Please Wait', 'A photo is still uploading.');
        return;
      }
      if (nextFollowUpDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(nextFollowUpDate.trim())) {
        Alert.alert('Invalid Date', 'Enter the follow-up date as YYYY-MM-DD, or leave it blank.');
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEP_TITLES.length - 1));
  };

  const goBack = () => {
    if (step === 0) navigation.goBack();
    else setStep((s) => s - 1);
  };

  if (loadingDraft) {
    return (
      <View style={styles.loadingDraftContainer}>
        <ActivityIndicator size="large" color={color.primary} />
        <Text style={styles.loadingDraftText}>Loading draft…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${((step + 1) / STEP_TITLES.length) * 100}%` }]} />
      </View>
      <Text style={styles.stepLabel}>
        Step {step + 1} of {STEP_TITLES.length}: {STEP_TITLES[step]}
      </Text>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
        {step === 0 ? (
          <Step1VisitDetails
            officerName={currentUser?.fullName ?? '—'}
            employeeId={currentUser?.employeeId ?? '—'}
            visitDate={visitDate}
            district={district}
            setDistrict={setDistrict}
            villageBlock={villageBlock}
            setVillageBlock={setVillageBlock}
            gps={gps}
            gpsLoading={gpsLoading}
            onGetLocation={handleGetLocation}
          />
        ) : step === 1 ? (
          <Step2FarmerFarm
            farmerMode={farmerMode}
            onSwitchToNew={() => { setFarmerMode('new'); setSelectedFarmer(null); setFarmerName(''); setFarmerPhone(''); setFarmSize(''); }}
            onSwitchToExisting={() => setFarmerMode('existing')}
            myFarmers={myFarmers}
            loadingFarmers={loadingFarmers}
            farmerSearch={farmerSearch}
            setFarmerSearch={setFarmerSearch}
            filteredFarmers={filteredFarmers}
            selectedFarmer={selectedFarmer}
            onSelectFarmer={selectExistingFarmer}
            farmerName={farmerName}
            setFarmerName={setFarmerName}
            farmerPhone={farmerPhone}
            onChangePhone={(v) => { setFarmerPhone(v); if (phoneError) validatePhone(v); }}
            phoneError={phoneError}
            farmSize={farmSize}
            setFarmSize={setFarmSize}
            farmSizeUnit={farmSizeUnit}
          />
        ) : step === 2 ? (
          <Step3CropProfile
            cropCategories={cropCategories}
            crops={crops}
            varieties={varieties}
            selectedCategoryId={selectedCategoryId}
            setSelectedCategoryId={setSelectedCategoryId}
            selectedCropId={selectedCropId}
            setSelectedCropId={setSelectedCropId}
            selectedVarietyId={selectedVarietyId}
            setSelectedVarietyId={setSelectedVarietyId}
            varietyText={varietyText}
            setVarietyText={setVarietyText}
            cropAgeValue={cropAgeValue}
            setCropAgeValue={setCropAgeValue}
            cropAgeUnit={cropAgeUnit}
            setCropAgeUnit={setCropAgeUnit}
            sowingDate={sowingDate}
            setSowingDate={setSowingDate}
            previousCropText={previousCropText}
            setPreviousCropText={setPreviousCropText}
            previousYieldValue={previousYieldValue}
            setPreviousYieldValue={setPreviousYieldValue}
            previousYieldUnit={previousYieldUnit}
            setPreviousYieldUnit={setPreviousYieldUnit}
            farmingType={farmingType}
            setFarmingType={setFarmingType}
            otherTexts={otherTexts}
            setOtherText={setOtherText}
          />
        ) : step === 3 ? (
          <Step4FarmPractices
            npkN={npkN} setNpkN={setNpkN}
            npkP={npkP} setNpkP={setNpkP}
            npkK={npkK} setNpkK={setNpkK}
            npkUnit={npkUnit} setNpkUnit={setNpkUnit}
            npkFrequency={npkFrequency} setNpkFrequency={setNpkFrequency}
            micronutrientOptions={micronutrientOptions}
            selectedMicronutrients={selectedMicronutrients}
            onToggleMicronutrient={toggleMicronutrient}
            setSelectedMicronutrients={setSelectedMicronutrients}
            farmOperationOptions={farmOperationOptions}
            selectedFarmOperations={selectedFarmOperations}
            onToggleFarmOperation={toggleFarmOperation}
            setSelectedFarmOperations={setSelectedFarmOperations}
            organicSolutionOptions={organicSolutionOptions}
            selectedOrganicSolutions={selectedOrganicSolutions}
            onToggleOrganicSolution={toggleOrganicSolution}
            setSelectedOrganicSolutions={setSelectedOrganicSolutions}
            usedAdvisory={usedAdvisory}
            setUsedAdvisory={setUsedAdvisory}
            onClearAdvisorySource={() => { setUsedAdvisory(false); setAdvisorySource(null); }}
            advisorySource={advisorySource}
            setAdvisorySource={setAdvisorySource}
            advisoryRemarks={advisoryRemarks}
            setAdvisoryRemarks={setAdvisoryRemarks}
            otherTexts={otherTexts}
            setOtherText={setOtherText}
          />
        ) : step === 4 ? (
          <Step5HealthDiagnosis
            cropStatus={cropStatus}
            setCropStatus={setCropStatus}
            pestOptions={pestOptions}
            selectedPestIds={selectedPestIds}
            onTogglePest={togglePest}
            diseaseOptions={diseaseOptions}
            selectedDiseaseIds={selectedDiseaseIds}
            onToggleDisease={toggleDisease}
            chemicalOptions={chemicalOptions}
            selectedChemicals={selectedChemicals}
            onToggleChemical={toggleChemical}
            setSelectedChemicals={setSelectedChemicals}
            severity={severity}
            setSeverity={setSeverity}
            statusOtherText={statusOtherText}
            setStatusOtherText={setStatusOtherText}
            otherTexts={otherTexts}
            setOtherText={setOtherText}
          />
        ) : step === 5 ? (
          <Step6TrialDemo
            isTrial={isTrial}
            setIsTrial={setIsTrial}
            visitPurpose={visitPurpose}
            setVisitPurpose={setVisitPurpose}
            demoStatus={demoStatus}
            setDemoStatus={setDemoStatus}
            trialPlotSize={trialPlotSize}
            setTrialPlotSize={setTrialPlotSize}
            stockItems={stockItems}
            loadingStock={loadingStock}
            selectedTrialProducts={selectedTrialProducts}
            onToggleProduct={toggleTrialProduct}
            setSelectedTrialProducts={setSelectedTrialProducts}
          />
        ) : step === 6 ? (
          <Step7SalesConversion
            purchased={purchased}
            setPurchased={setPurchased}
            products={saleProducts}
            loadingProducts={loadingSaleProducts}
            selectedSaleProducts={selectedSaleProducts}
            onToggleProduct={toggleSaleProduct}
            setSelectedSaleProducts={setSelectedSaleProducts}
            orderValue={orderValue}
            setOrderValue={setOrderValue}
            conversionStatus={conversionStatus}
            setConversionStatus={setConversionStatus}
          />
        ) : step === 7 ? (
          <Step8PhotosRemarks
            photos={photos}
            onTakePhoto={handleTakePhoto}
            onPickFromGallery={handlePickFromGallery}
            onRemovePhoto={removePhoto}
            officerRemarks={officerRemarks}
            setOfficerRemarks={setOfficerRemarks}
            nextFollowUpDate={nextFollowUpDate}
            setNextFollowUpDate={setNextFollowUpDate}
            followUpRemarks={followUpRemarks}
            setFollowUpRemarks={setFollowUpRemarks}
          />
        ) : (
          <Step9ReviewSubmit
            sections={buildReviewSections()}
            onEditStep={(i) => setStep(i)}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        )}
        {step === STEP_TITLES.length - 1 && customFields.length > 0 && (
          <View style={{ marginTop: 24, marginBottom: 24, backgroundColor: color.cardBg, padding: 16, borderRadius: radius.md, borderWidth: 1, borderColor: color.border }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 16, color: color.textPrimary }}>Additional Information</Text>
            <DynamicFieldRenderer
              fields={customFields}
              answers={customFieldAnswers}
              onChange={(key, val) => setCustomFieldAnswers(prev => ({ ...prev, [key]: val }))}
            />
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
        <TouchableOpacity style={styles.footerBtnSecondary} onPress={goBack}>
          <Text style={styles.footerBtnSecondaryText}>{step === 0 ? 'Cancel' : 'Back'}</Text>
        </TouchableOpacity>
        {step < STEP_TITLES.length - 1 && !adminOfficerId && (
          <TouchableOpacity style={styles.footerBtnSaveDraft} onPress={handleSaveDraft} disabled={savingDraft}>
            {savingDraft ? (
              <ActivityIndicator color={color.primary} size="small" />
            ) : (
              <Text style={styles.footerBtnSaveDraftText}>Save Draft</Text>
            )}
          </TouchableOpacity>
        )}
        {step < STEP_TITLES.length - 1 && (
          <TouchableOpacity style={styles.footerBtnPrimary} onPress={goNext}>
            <Text style={styles.footerBtnPrimaryText}>Next</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  progressBar: { height: 4, backgroundColor: color.border },
  progressFill: { height: '100%', backgroundColor: color.primary },
  stepLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    padding: spacing.md,
  },
  body: { flex: 1, paddingHorizontal: spacing.lg },
  footer: {
    flexDirection: 'row',
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.cardBg,
  },
  footerBtnSecondary: { flex: 1, padding: spacing.md, alignItems: 'center', marginRight: spacing.sm },
  footerBtnSecondaryText: { color: color.textSecondary, fontWeight: fontWeight.semibold },
  loadingDraftContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.screenBg,
  },
  loadingDraftText: {
    marginTop: spacing.md,
    fontSize: font.body,
    color: color.textSecondary,
  },
  footerBtnSaveDraft: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: color.primary,
    borderRadius: radius.sm,
  },
  footerBtnSaveDraftText: {
    color: color.primary,
    fontWeight: fontWeight.semibold,
    fontSize: font.caption,
  },
  footerBtnPrimary: {
    flex: 1,
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  footerBtnPrimaryText: { color: color.white, fontWeight: fontWeight.bold },
});
