// Shared types + fixed option lists across the Daily Visit Tracker's
// step components. Kept separate from each step file so Step N doesn't
// need to import from Step M just to reuse a type.

export type Farmer = {
  id: string;
  name: string;
  phone: string;
  village: string;
  taluk: string;
  district: string;
  crop: string;
  cents: number;
};

export type MasterItem = { id: string; name: string };

// "Other" in any pick-list: the officer taps it and types their own answer.
// Lists that already hold an "Other" row keep it (moved to the end); lists
// without one (crop category, crop, variety, chemicals) get a built-in
// "Other" whose id is OTHER_ID, which is never sent to the server as an id.
export const OTHER_ID = '__other__';
export const isOtherName = (name?: string | null): boolean => !!name && /^others?$/i.test(name.trim());
export function otherLast<T extends { id: string; name: string }>(list: T[]): T[] {
  return [...list.filter((i) => !isOtherName(i.name)), ...list.filter((i) => isOtherName(i.name))];
}
export function withOther<T extends { id: string; name: string }>(list: T[]): T[] {
  if (list.some((i) => isOtherName(i.name))) return otherLast(list);
  return [...list, { id: OTHER_ID, name: 'Other' } as T];
}
export const OTHER_PLACEHOLDER = 'Type your answer';
export type CropOption = { id: string; name: string; crop_category_id: string };
export type VarietyOption = { id: string; name: string; crop_id: string };

export const FARMING_TYPES: { value: string; label: string }[] = [
  { value: 'certified_organic', label: 'Certified Organic' },
  { value: 'natural_farming', label: 'Natural Farming' },
  { value: 'transitioning', label: 'Transitioning' },
  { value: 'conventional', label: 'Conventional / Chemical' },
];

export const CROP_AGE_UNITS = ['days', 'weeks', 'months'] as const;

export const STEP_TITLES = [
  'Visit Details',
  'Farmer & Farm',
  'Crop Profile',
  'Farm Practices & Inputs',
  'Crop Health & Diagnosis',
  'Trial / Demo',
  'Sales Conversion',
  'Photos & Remarks',
  'Review & Submit',
];

// Mirrors backend/app/presentation/schemas/daily_visit_tracker_schemas.py's
// DailyVisitTrackerSubmitRequest field-for-field. Keep these two in sync
// by hand - there's no shared schema-generation step between the mobile
// app and the FastAPI backend in this project.
export type DailyVisitSubmitPayload = {
  latitude: number;
  longitude: number;
  farmer_id?: string;
  new_farmer?: {
    name: string;
    phone: string;
    village: string;
    taluk: string;
    district: string;
    crop: string;
    cents: number;
  };
  farm_size_value: number;
  farm_size_unit: string;
  crop_category_id?: string;
  crop_id?: string;
  crop_other_text?: string;
  crop_category_other_text?: string;
  variety_id?: string;
  variety_text?: string;
  crop_age_value?: number;
  crop_age_unit?: string;
  sowing_date?: string;
  previous_crop_text?: string;
  previous_yield_value?: number;
  previous_yield_unit?: string;
  farming_type: string;
  npk_n?: number;
  npk_p?: number;
  npk_k?: number;
  npk_unit?: string;
  npk_frequency?: string;
  micronutrients: { micronutrient_id: string; quantity?: number; unit?: string; other_text?: string }[];
  farm_operations: { farm_operation_id: string; performed_date?: string; remarks?: string; other_text?: string }[];
  organic_solutions: { organic_solution_id: string; quantity?: number; unit?: string; application_date?: string; remarks?: string; other_text?: string }[];
  used_advisory: boolean;
  advisory_source?: string;
  advisory_remarks?: string;
  crop_status: string;
  status_other_text?: string;
  pest_ids: string[];
  pest_other_text?: string;
  disease_ids: string[];
  disease_other_text?: string;
  chemicals: { chemical_id?: string; chemical_name_text?: string; quantity?: string; frequency?: string }[];
  severity?: number;
  is_trial: boolean;
  visit_purpose?: string;
  demo_status?: string;
  trial_plot_size_cents?: number;
  trial_products: { product_id: string; quantity_given: number }[];
  purchased: boolean;
  sale_items: { product_id: string; quantity: number; unit?: string }[];
  order_value?: number;
  conversion_status?: string;
  photo_urls: string[];
  officer_remarks?: string;
  next_follow_up_date?: string;
  follow_up_remarks?: string;
  // Both exist on the backend's DailyVisitTrackerSubmitRequest
  // (config_version: int = 1, custom_field_answers: dict) but were
  // missing here, which silently defeated this type's whole purpose -
  // a real build (tsc) caught the mismatch even though the fields were
  // already being sent correctly.
  config_version?: number;
  custom_field_answers?: Record<string, any>;
};
