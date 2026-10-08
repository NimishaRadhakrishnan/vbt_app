"use client";

import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";
import { tokenStorage } from "@/lib/api/token-storage";
import {
  OtherDescriptionInput, needsDescription, descriptionMissing, clearIfNotRequired,
  OTHER_DESCRIPTION_MESSAGE,
} from "@/components/OtherDescriptionInput";
import DynamicFieldRenderer from "@/components/DynamicFieldRenderer";

// Full Day Closure submission form. Per direct request this now covers
// every field from the source Field Officer Google Form (crop profile,
// NPK/micronutrients/operations/organic solutions, health & pest/disease
// diagnosis, demo/trial, sales conversion, photos) - the same field set
// Daily Visit Tracker already models on the backend
// (daily_visit_tracker_schemas.py). This form POSTs the exact same
// DailyVisitTrackerSubmitRequest shape to /day-closure, which creates a
// real visit through the same submit_daily_visit() logic and links a
// day_closures marker to it - see day_closure_router.py's module
// docstring for why this reuses that endpoint rather than a parallel one.
//
// One component, used from two places (the "work-doc" standalone tab and
// the logout-gate modal) so the field set can't drift between them.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

type Option = { id: string; name: string };
type CropOption = Option & { crop_category_id: string };
type VarietyOption = Option & { crop_id: string };
type Farmer = { id: string; name: string; phone: string; village: string; district: string };

const DISTRICTS = ["Coimbatore", "Tiruppur", "Theni", "Erode", "Dindigul", "Idukki", "Tirunelveli"];
// Fallback values only - used if the live fetch below fails. The real
// source of truth is now GET /enum-options/{field_name} (migration
// 202608260010 converted these 3 fields from CHECK constraints to
// admin-manageable rows in enum_field_options), not this hardcoded
// list. Kept in sync with the migration's seed values so a fetch
// failure still shows a form that matches what the backend actually
// accepts, rather than silently drifting from it over time.
const CROP_STATUSES_FALLBACK = [
  { value: "healthy", label: "Healthy" },
  { value: "mild_stress", label: "Mild stress" },
  { value: "pest_disease_affected", label: "Pest/Disease affected" },
  { value: "drought", label: "Drought" },
  { value: "waterlogged", label: "Waterlogged" },
  { value: "nutrient_deficiency", label: "Nutrient Deficiency" },
  { value: "other", label: "Other" },
];
const FARMING_TYPES_FALLBACK = [
  { value: "certified_organic", label: "Yes - certified organic" },
  { value: "natural_farming", label: "Yes - natural farming (no certification)" },
  { value: "transitioning", label: "Transitioning to organic" },
  { value: "conventional", label: "No - conventional (chemical)" },
];
const VISIT_PURPOSES = [
  { value: "new_contact", label: "New farmer contact" },
  { value: "demo_setup", label: "Demo / trial plot setup" },
  { value: "demo_followup", label: "Demo follow-up" },
  { value: "field_day", label: "Field day / group meeting" },
  { value: "dealer_visit", label: "Dealer / retailer visit" },
  { value: "routine_followup", label: "Routine follow-up" },
];
const DEMO_STAGES_FALLBACK = [
  { value: "not_discussed", label: "No demo - not discussed" },
  { value: "explained_not_interested", label: "Demo explained - farmer not interested" },
  { value: "agreed_not_started", label: "Farmer AGREED for demo - not yet started" },
  { value: "started_today", label: "Demo STARTED today - plot set up" },
  { value: "followup_running", label: "Follow-up visit on running demo" },
  { value: "completed_success", label: "Demo completed - success" },
  { value: "completed_failed", label: "Demo completed - failed" },
  { value: "converted", label: "Converted to paid purchase" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
      <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-600";

function MultiSelectChips({ options, selected, onToggle }: { options: Option[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          type="button"
          key={o.id}
          onClick={() => onToggle(o.id)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
            selected.includes(o.id) ? "bg-green-700 text-white border-green-700" : "bg-white text-slate-600 border-slate-200 hover:border-green-400"
          }`}
        >
          {o.name}
        </button>
      ))}
      {options.length === 0 && <span className="text-xs text-slate-400 italic">Loading options...</span>}
    </div>
  );
}

export default function DayClosureForm({
  onSubmitted,
  onError,
  adminOfficerId,
}: {
  onSubmitted: () => void;
  onError?: (msg: string) => void;
  // When set, this form is being used from Admin's "Add Day Closure"
  // modal (filing a missed submission on behalf of another officer)
  // instead of an officer's own submission - same fields, same
  // validation, only the submit target changes: POST /admin/day-closures
  // (with ?officer_id=...) instead of POST /day-closure. Reuses this
  // exact component per the "don't build a second form" instruction.
  adminOfficerId?: string;
}) {
  // Master data
  const [cropCategories, setCropCategories] = useState<Option[]>([]);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [varieties, setVarieties] = useState<VarietyOption[]>([]);
  const [pests, setPests] = useState<Option[]>([]);
  const [diseases, setDiseases] = useState<Option[]>([]);
  const [micronutrients, setMicronutrients] = useState<Option[]>([]);
  const [farmOperations, setFarmOperations] = useState<Option[]>([]);
  const [organicSolutions, setOrganicSolutions] = useState<Option[]>([]);

  useEffect(() => {
    apiFetch<Option[]>("/master-data/crop-categories").then(setCropCategories).catch(() => {});
    apiFetch<Option[]>("/master-data/pests").then(setPests).catch(() => {});
    apiFetch<Option[]>("/master-data/diseases").then(setDiseases).catch(() => {});
    apiFetch<Option[]>("/master-data/micronutrients").then(setMicronutrients).catch(() => {});
    apiFetch<Option[]>("/master-data/farm-operations").then(setFarmOperations).catch(() => {});
    apiFetch<Option[]>("/master-data/organic-solutions").then(setOrganicSolutions).catch(() => {});
  }, []);

  // --- Admin Page Builder config (frontend/components/DayClosureFormBuilder.tsx) ---
  // GET /day-closure-config returns only the fields enabled and visible
  // to the CURRENT user's role, in the admin's configured order - so a
  // field simply absent from this list means "not enabled for me right
  // now" and every render check below is a lookup, not a filter of its
  // own. Falls back to the field always being shown with its original
  // hardcoded label/placeholder/required-ness if the config fetch fails
  // (network hiccup, or - for the adminOfficerId "create on behalf of"
  // flow - a role with no matching config rows) rather than the whole
  // form going blank over a config-layer problem.
  const [fieldConfig, setFieldConfig] = useState<Record<string, { label: string; placeholder: string | null; is_required: boolean }>>({});
  const [configFetchSucceeded, setConfigFetchSucceeded] = useState(false);

  useEffect(() => {
    apiFetch<any[]>("/day-closure-config")
      .then((rows) => {
        const map: Record<string, { label: string; placeholder: string | null; is_required: boolean }> = {};
        (rows || []).forEach((r) => { map[r.field_key] = { label: r.label, placeholder: r.placeholder, is_required: r.is_required }; });
        setFieldConfig(map);
        setConfigFetchSucceeded(true);
      })
      .catch(() => {
        // Fetch failed - configFetchSucceeded stays false, so
        // isFieldVisible below keeps every field shown rather than
        // treating an empty/never-loaded config as "nothing is enabled."
      });
  }, []);

  // A field is only hidden once we have CONFIRMED (successful fetch)
  // config data that omits it. Before that succeeds, or if it never
  // does, every field defaults to visible - a config-layer failure must
  // never look identical to "admin disabled every field."
  const isFieldVisible = (key: string) => !configFetchSucceeded || key in fieldConfig;
  const fieldLabel = (key: string, fallback: string) => fieldConfig[key]?.label ?? fallback;
  const fieldPlaceholder = (key: string, fallback?: string) => fieldConfig[key]?.placeholder ?? fallback;
  const isFieldRequired = (key: string, fallback: boolean) => {
    // A disabled (hidden) field can never be "required" - there's no
    // input for the user to fill in, so validation must never block on
    // it. Only a VISIBLE field's required-ness is meaningful, and only
    // then does the config's own is_required value (or the original
    // hardcoded default, if this field predates the config system)
    // apply.
    if (!isFieldVisible(key)) return false;
    return fieldConfig[key]?.is_required ?? fallback;
  };

  // Section labels (Part B) - admin-renameable, fetched the same way
  // as field config: a fetch failure or a section this build predates
  // falls back to the original hardcoded title, never a blank header.
  const [sectionLabels, setSectionLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    apiFetch<any[]>("/day-closure-sections")
      .then((rows) => {
        const map: Record<string, string> = {};
        (rows || []).forEach((r) => { map[r.section_key] = r.label; });
        setSectionLabels(map);
      })
      .catch(() => {});
  }, []);
  const sectionTitle = (key: string, fallback: string) => sectionLabels[key] ?? fallback;

  // Admin-manageable option lists (migration 202608260010) - fetched
  // live so an Admin's Manage Options changes (add/relabel/deactivate)
  // show up here without a code change. Falls back to the hardcoded
  // defaults above if the fetch fails, same reasoning as the field
  // config fallback: a fetch problem should never blank the form.
  const [cropStatuses, setCropStatuses] = useState(CROP_STATUSES_FALLBACK);
  const [farmingTypes, setFarmingTypes] = useState(FARMING_TYPES_FALLBACK);
  const [demoStages, setDemoStages] = useState(DEMO_STAGES_FALLBACK);

  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customFieldAnswers, setCustomFieldAnswers] = useState<Record<string, any>>({});
  const [configVersion, setConfigVersion] = useState<number>(1);

  useEffect(() => {
    apiFetch<any[]>("/enum-options/crop_status").then((rows) => { if (rows?.length) setCropStatuses(rows); }).catch(() => {});
    apiFetch<any[]>("/enum-options/farming_type").then((rows) => { if (rows?.length) setFarmingTypes(rows); }).catch(() => {});
    apiFetch<any[]>("/enum-options/demo_status").then((rows) => { if (rows?.length) setDemoStages(rows); }).catch(() => {});
    apiFetch<any>("/custom-fields/day_closure").then((res) => {
      setCustomFields(res?.fields || []);
      if (res?.version) setConfigVersion(res.version);
    }).catch(() => {});
  }, []);

  // --- Section 1: Farmer & farm ---
  const [isNewFarmer, setIsNewFarmer] = useState(true);
  const [farmerSearch, setFarmerSearch] = useState("");
  const [farmerResults, setFarmerResults] = useState<Farmer[]>([]);
  const [selectedFarmerId, setSelectedFarmerId] = useState("");
  const [district, setDistrict] = useState("");
  const [village, setVillage] = useState("");
  const [taluk, setTaluk] = useState("");
  const [farmerName, setFarmerName] = useState("");
  const [farmerPhone, setFarmerPhone] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [farmSize, setFarmSize] = useState("");

  const searchFarmers = async (q: string) => {
    setFarmerSearch(q);
    if (q.length < 2) { setFarmerResults([]); return; }
    try {
      const res = await apiFetch<Farmer[]>(`/farmers/search?village=${encodeURIComponent(q)}`);
      setFarmerResults(res || []);
    } catch { setFarmerResults([]); }
  };

  // --- Section 2: crop profile ---
  const [cropCategoryId, setCropCategoryId] = useState("");
  const [cropCategoryOtherText, setCropCategoryOtherText] = useState("");
  const [cropId, setCropId] = useState("");
  const [varietyId, setVarietyId] = useState("");
  const [varietyText, setVarietyText] = useState("");
  const [cropAgeValue, setCropAgeValue] = useState("");
  const [cropAgeUnit, setCropAgeUnit] = useState("days");
  const [sowingDate, setSowingDate] = useState("");
  const [previousCropText, setPreviousCropText] = useState("");
  const [farmingType, setFarmingType] = useState("conventional");

  useEffect(() => {
    if (!cropCategoryId) { setCrops([]); return; }
    apiFetch<CropOption[]>(`/master-data/crops?crop_category_id=${cropCategoryId}`).then(setCrops).catch(() => {});
  }, [cropCategoryId]);
  useEffect(() => {
    if (!cropId) { setVarieties([]); return; }
    apiFetch<VarietyOption[]>(`/master-data/crop-varieties?crop_id=${cropId}`).then(setVarieties).catch(() => {});
  }, [cropId]);

  // --- Section 3: practices & inputs ---
  const [npkN, setNpkN] = useState("");
  const [npkP, setNpkP] = useState("");
  const [npkK, setNpkK] = useState("");
  const [selectedMicronutrients, setSelectedMicronutrients] = useState<string[]>([]);
  const [selectedOperations, setSelectedOperations] = useState<string[]>([]);
  const [selectedOrganicSolutions, setSelectedOrganicSolutions] = useState<string[]>([]);
  const [usedAdvisory, setUsedAdvisory] = useState(false);
  const [advisorySource, setAdvisorySource] = useState("");

  // --- Section 4: health & diagnosis ---
  const [cropStatus, setCropStatus] = useState("healthy");
  const [statusOtherText, setStatusOtherText] = useState("");
  const [selectedPests, setSelectedPests] = useState<string[]>([]);
  const [selectedDiseases, setSelectedDiseases] = useState<string[]>([]);
  const [chemicalText, setChemicalText] = useState("");
  const [severity, setSeverity] = useState("5");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);

  // --- Section 5: business & demo ---
  const [visitPurpose, setVisitPurpose] = useState("routine_followup");
  const [isTrial, setIsTrial] = useState(false);
  const [trialPlotSize, setTrialPlotSize] = useState("");
  const [demoStatus, setDemoStatus] = useState("not_discussed");
  const [purchased, setPurchased] = useState(false);
  const [orderValue, setOrderValue] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  // Flag-driven, so an admin-created status like "Miscellaneous" also
  // gets a description box without a code change.
  const statusNeedsDesc = needsDescription(cropStatuses as any, cropStatus);
  // Crop categories are master-data rows, not enum_field_options, so
  // they carry no requires_description flag. Matching on the label is
  // the only signal available here - noted as a known limitation
  // rather than pretending the flag covers this field too.
  const cropCategoryNeedsDesc = (() => {
    const sel = cropCategories.find((c) => c.id === cropCategoryId);
    return !!sel && /^(other|others|miscellaneous)$/i.test(sel.name.trim());
  })();

  const uploadPhoto = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const token = tokenStorage.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${API_BASE_URL}/day-closure/upload`, { method: "POST", headers, body: formData });
    if (!response.ok) throw new Error("Failed to upload photo.");
    const data = await response.json();
    return data.url;
  };

  const getLocation = (): Promise<{ lat: number; lng: number }> =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error("Location is not available in this browser.")); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject(new Error("Could not get your location. Please allow location access and try again.")),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

  const handleSubmit = async () => {
    setFormError("");
    if (!isNewFarmer && !selectedFarmerId) {
      setFormError("Please select an existing farmer, or switch to \"New Farmer\".");
      return;
    }
    if (isNewFarmer) {
      const missing: string[] = [];
      if (isFieldRequired("farmer_name", true) && !farmerName) missing.push("Farmer name");
      if (isFieldRequired("farmer_phone", true) && !farmerPhone) missing.push("phone");
      if (isFieldRequired("village", true) && !village) missing.push("village");
      if (isFieldRequired("district", true) && !district) missing.push("district");
      if (isFieldRequired("farm_size", true) && !farmSize) missing.push("farm area");
      if (missing.length > 0) {
        setFormError(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`);
        return;
      }
    }
    if (!cropId && !varietyText) {
      setFormError("Please select a crop.");
      return;
    }
    if (descriptionMissing(statusNeedsDesc, statusOtherText)) {
      setFormError(OTHER_DESCRIPTION_MESSAGE);
      return;
    }
    if (descriptionMissing(cropCategoryNeedsDesc, cropCategoryOtherText)) {
      setFormError(OTHER_DESCRIPTION_MESSAGE);
      return;
    }

    setSubmitting(true);
    try {
      const { lat, lng } = await getLocation();

      const photoUrls: string[] = [];
      for (const file of photoFiles) {
        photoUrls.push(await uploadPhoto(file));
      }

      const payload: any = {
        latitude: lat,
        longitude: lng,
        farm_size_value: parseFloat(farmSize) || 0,
        farm_size_unit: "cents",
        crop_category_id: cropCategoryId || undefined,
        crop_category_other_text: clearIfNotRequired(cropCategoryNeedsDesc, cropCategoryOtherText),
        crop_id: cropId || undefined,
        variety_id: varietyId || undefined,
        variety_text: varietyText || undefined,
        crop_age_value: cropAgeValue ? parseFloat(cropAgeValue) : undefined,
        crop_age_unit: cropAgeValue ? cropAgeUnit : undefined,
        sowing_date: sowingDate || undefined,
        previous_crop_text: previousCropText || undefined,
        farming_type: farmingType,
        npk_n: npkN ? parseFloat(npkN) : undefined,
        npk_p: npkP ? parseFloat(npkP) : undefined,
        npk_k: npkK ? parseFloat(npkK) : undefined,
        npk_unit: npkN || npkP || npkK ? "kg" : undefined,
        micronutrients: selectedMicronutrients.map((id) => ({ micronutrient_id: id })),
        farm_operations: selectedOperations.map((id) => ({ farm_operation_id: id })),
        organic_solutions: selectedOrganicSolutions.map((id) => ({ organic_solution_id: id })),
        used_advisory: usedAdvisory,
        advisory_source: usedAdvisory ? advisorySource || undefined : undefined,
        crop_status: cropStatus,
        status_other_text: clearIfNotRequired(statusNeedsDesc, statusOtherText),
        pest_ids: cropStatus === "pest_disease_affected" ? selectedPests : [],
        disease_ids: cropStatus === "pest_disease_affected" ? selectedDiseases : [],
        chemicals: chemicalText ? [{ chemical_name_text: chemicalText }] : [],
        severity: parseInt(severity, 10),
        is_trial: isTrial,
        visit_purpose: visitPurpose,
        demo_status: demoStatus,
        trial_plot_size_cents: isTrial && trialPlotSize ? parseFloat(trialPlotSize) : undefined,
        purchased,
        order_value: purchased && orderValue ? parseFloat(orderValue) : undefined,
        conversion_status: purchased ? "converted" : demoStatus === "agreed_not_started" ? "interested" : undefined,
        photo_urls: photoUrls,
        config_version: configVersion,
        custom_field_answers: customFieldAnswers,
      };

      if (isNewFarmer) {
        payload.new_farmer = {
          name: farmerName, phone: farmerPhone, village, taluk: taluk || village,
          district, crop: crops.find((c) => c.id === cropId)?.name || varietyText || "Unspecified", cents: parseFloat(farmSize) || 0,
        };
      } else {
        payload.farmer_id = selectedFarmerId;
      }

      const endpoint = adminOfficerId
        ? `/admin/day-closures?officer_id=${encodeURIComponent(adminOfficerId)}`
        : "/day-closure";
      await apiFetch(endpoint, { method: "POST", body: JSON.stringify(payload) });
      onSubmitted();
    } catch (err: any) {
      const msg = err.message || "Failed to submit today's closure.";
      setFormError(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {formError && (
        <div className="p-4 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">{formError}</div>
      )}

      <Section title={sectionTitle("basic_visit_details", "1. Basic Visit Details")}>
        <div className="flex gap-2">
          <button type="button" onClick={() => setIsNewFarmer(true)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${isNewFarmer ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}>New Farmer</button>
          <button type="button" onClick={() => setIsNewFarmer(false)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${!isNewFarmer ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}>Existing Farmer</button>
        </div>

        {!isNewFarmer ? (
          <Field label="Search Farmer (by village)" required>
            <input className={inputCls} value={farmerSearch} onChange={(e) => searchFarmers(e.target.value)} placeholder="Type a village name..." />
            {farmerResults.length > 0 && (
              <div className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                {farmerResults.map((f) => (
                  <button type="button" key={f.id} onClick={() => { setSelectedFarmerId(f.id); setFarmerSearch(`${f.name} (${f.village})`); setFarmerResults([]); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                    {f.name} — {f.village}, {f.district} ({f.phone})
                  </button>
                ))}
              </div>
            )}
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              {isFieldVisible("farmer_name") && (
                <Field label={fieldLabel("farmer_name", "Farmer Name")} required={isFieldRequired("farmer_name", true)}>
                  <input className={inputCls} placeholder={fieldPlaceholder("farmer_name")} value={farmerName} onChange={(e) => setFarmerName(e.target.value)} />
                </Field>
              )}
              {isFieldVisible("farmer_phone") && (
                <Field label={fieldLabel("farmer_phone", "Contact Number")} required={isFieldRequired("farmer_phone", true)}>
                  <input className={inputCls} placeholder={fieldPlaceholder("farmer_phone")} value={farmerPhone} onChange={(e) => setFarmerPhone(e.target.value)} />
                </Field>
              )}
            </div>
            <div className="grid grid-cols-3 gap-4">
              {isFieldVisible("district") && (
                <Field label={fieldLabel("district", "District")} required={isFieldRequired("district", true)}>
                  <select className={inputCls} value={district} onChange={(e) => setDistrict(e.target.value)}>
                    <option value="">-- Select --</option>
                    {DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              )}
              {isFieldVisible("village") && (
                <Field label={fieldLabel("village", "Village/Block")} required={isFieldRequired("village", true)}>
                  <input className={inputCls} placeholder={fieldPlaceholder("village")} value={village} onChange={(e) => setVillage(e.target.value)} />
                </Field>
              )}
              {isFieldVisible("farm_size") && (
                <Field label={fieldLabel("farm_size", "Total Farm Area (cents)")} required={isFieldRequired("farm_size", true)}>
                  <input type="number" step="0.1" className={inputCls} placeholder={fieldPlaceholder("farm_size")} value={farmSize} onChange={(e) => setFarmSize(e.target.value)} />
                  <p className="text-[11px] text-slate-400 mt-1">1 acre = 100 cents</p>
                </Field>
              )}
            </div>
          </>
        )}
        {isFieldVisible("visit_date") && (
          <Field label={fieldLabel("visit_date", "Date of Visit")} required={isFieldRequired("visit_date", true)}>
            <input type="date" className={inputCls} value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
          </Field>
        )}
      </Section>

      <Section title={sectionTitle("crop_farming_profile", "2. Crop & Farming Profile")}>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Crop Category" required>
            <select className={inputCls} value={cropCategoryId} onChange={(e) => { setCropCategoryId(e.target.value); setCropId(""); setVarietyId(""); }}>
              <option value="">-- Select --</option>
              {cropCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <OtherDescriptionInput
              required={cropCategoryNeedsDesc}
              value={cropCategoryOtherText}
              onChange={setCropCategoryOtherText}
              showError={!!formError}
            />
          </Field>
          <Field label="Crop Name" required>
            <select className={inputCls} value={cropId} onChange={(e) => { setCropId(e.target.value); setVarietyId(""); }}>
              <option value="">-- Select --</option>
              {crops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Variety/Hybrid" required>
            {varieties.length > 0 ? (
              <select className={inputCls} value={varietyId} onChange={(e) => setVarietyId(e.target.value)}>
                <option value="">-- Select --</option>
                {varieties.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            ) : (
              <input className={inputCls} placeholder="Type variety name" value={varietyText} onChange={(e) => setVarietyText(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex gap-2">
            <Field label="Age of Crop"><input type="number" className={inputCls} value={cropAgeValue} onChange={(e) => setCropAgeValue(e.target.value)} /></Field>
            <Field label="Unit">
              <select className={inputCls} value={cropAgeUnit} onChange={(e) => setCropAgeUnit(e.target.value)}>
                <option value="days">Days</option><option value="weeks">Weeks</option><option value="months">Months</option><option value="years">Years</option>
              </select>
            </Field>
          </div>
          <Field label="Sowing/Planting Date"><input type="date" className={inputCls} value={sowingDate} onChange={(e) => setSowingDate(e.target.value)} /></Field>
        </div>
        <Field label="Previous Season Crop & Yield"><input className={inputCls} value={previousCropText} onChange={(e) => setPreviousCropText(e.target.value)} placeholder="e.g. Paddy, 25 bags/cent" /></Field>
        <Field label="Farming Type" required>
          <select className={inputCls} value={farmingType} onChange={(e) => setFarmingType(e.target.value)}>
            {farmingTypes.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </Field>
      </Section>

      <Section title={sectionTitle("farm_practices_inputs", "3. Farm Practices & Inputs")}>
        <Field label="NPK Dosage (N / P / K, kg)">
          <div className="grid grid-cols-3 gap-2">
            <input type="number" className={inputCls} placeholder="N" value={npkN} onChange={(e) => setNpkN(e.target.value)} />
            <input type="number" className={inputCls} placeholder="P" value={npkP} onChange={(e) => setNpkP(e.target.value)} />
            <input type="number" className={inputCls} placeholder="K" value={npkK} onChange={(e) => setNpkK(e.target.value)} />
          </div>
        </Field>
        <Field label="Micronutrients Applied"><MultiSelectChips options={micronutrients} selected={selectedMicronutrients} onToggle={(id) => toggle(selectedMicronutrients, setSelectedMicronutrients, id)} /></Field>
        <Field label="Intercultural Operations Done"><MultiSelectChips options={farmOperations} selected={selectedOperations} onToggle={(id) => toggle(selectedOperations, setSelectedOperations, id)} /></Field>
        <Field label="Organic / IPM Solutions Used"><MultiSelectChips options={organicSolutions} selected={selectedOrganicSolutions} onToggle={(id) => toggle(selectedOrganicSolutions, setSelectedOrganicSolutions, id)} /></Field>
        <Field label="Consulting Agri-Clinic / KVK?">
          <div className="flex gap-2 mb-2">
            <button type="button" onClick={() => setUsedAdvisory(true)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${usedAdvisory ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}>Yes</button>
            <button type="button" onClick={() => setUsedAdvisory(false)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${!usedAdvisory ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}>No</button>
          </div>
          {usedAdvisory && <input className={inputCls} placeholder="Name of agri-clinic / KVK / advisory" value={advisorySource} onChange={(e) => setAdvisorySource(e.target.value)} />}
        </Field>
      </Section>

      <Section title={sectionTitle("crop_health_diagnosis", "4. Crop Health & Pest Diagnosis")}>
        <Field label="Present Health Status" required>
          <select className={inputCls} value={cropStatus} onChange={(e) => setCropStatus(e.target.value)}>
            {cropStatuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <OtherDescriptionInput
            required={statusNeedsDesc}
            value={statusOtherText}
            onChange={setStatusOtherText}
            showError={!!formError}
          />
        </Field>
        {cropStatus === "pest_disease_affected" && (
          <>
            <Field label="Pests Observed"><MultiSelectChips options={pests} selected={selectedPests} onToggle={(id) => toggle(selectedPests, setSelectedPests, id)} /></Field>
            <Field label="Diseases Observed"><MultiSelectChips options={diseases} selected={selectedDiseases} onToggle={(id) => toggle(selectedDiseases, setSelectedDiseases, id)} /></Field>
            <Field label="Pesticide/Chemical Currently Used"><input className={inputCls} value={chemicalText} onChange={(e) => setChemicalText(e.target.value)} /></Field>
            <Field label={`Severity Level: ${severity}/10`}>
              <input type="range" min="1" max="10" value={severity} onChange={(e) => setSeverity(e.target.value)} className="w-full accent-green-700" />
            </Field>
          </>
        )}
        <Field label="Photo Upload (Crop Condition)">
          <input type="file" accept="image/*" multiple onChange={(e) => setPhotoFiles(Array.from(e.target.files || []).slice(0, 10))} className="text-sm" />
          {photoFiles.length > 0 && <p className="text-xs text-slate-500 mt-1">{photoFiles.length} photo(s) selected</p>}
        </Field>
      </Section>

      <Section title={sectionTitle("business_demo_tracking", "5. Business & Demo Tracking")}>
        <Field label="Visit Purpose" required>
          <select className={inputCls} value={visitPurpose} onChange={(e) => setVisitPurpose(e.target.value)}>
            {VISIT_PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Demo / Trial Stage at This Farm Today" required>
          <select className={inputCls} value={demoStatus} onChange={(e) => { setDemoStatus(e.target.value); setIsTrial(e.target.value === "started_today" || e.target.value === "followup_running"); }}>
            {demoStages.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </Field>
        {isTrial && (
          <Field label="Area Under Demo/Trial (cents)"><input type="number" step="0.01" className={inputCls} value={trialPlotSize} onChange={(e) => setTrialPlotSize(e.target.value)} placeholder="e.g. 0.5" /></Field>
        )}
        <Field label="Did Farmer Purchase?">
          <div className="flex gap-2">
            <button type="button" onClick={() => setPurchased(true)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${purchased ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}>Yes</button>
            <button type="button" onClick={() => setPurchased(false)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${!purchased ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}>No</button>
          </div>
        </Field>
        {purchased && (
          <Field label="Order Value (₹)"><input type="number" className={inputCls} value={orderValue} onChange={(e) => setOrderValue(e.target.value)} /></Field>
        )}
      </Section>

      {customFields.length > 0 && (
        <Section title="Additional Information">
          <DynamicFieldRenderer
            fields={customFields}
            answers={customFieldAnswers}
            onChange={(key, val) => setCustomFieldAnswers((prev) => ({ ...prev, [key]: val }))}
          />
        </Section>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold rounded-xl transition"
      >
        {submitting ? "Submitting..." : "Submit Day Closure"}
      </button>
    </div>
  );
}
