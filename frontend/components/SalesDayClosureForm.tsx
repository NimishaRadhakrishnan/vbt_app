"use client";

import React, { useEffect, useState } from "react";
import { apiFetch, API_BASE_URL } from "@/lib/api/client";
import { tokenStorage } from "@/lib/api/token-storage";
import {
  OtherDescriptionInput, needsDescription, descriptionMissing, clearIfNotRequired,
  OTHER_DESCRIPTION_MESSAGE,
} from "@/components/OtherDescriptionInput";
import DynamicFieldRenderer from "@/components/DynamicFieldRenderer";

// Sales Officer's end-of-day record. Separate from DayClosureForm.tsx
// (the field-officer farm-visit closure) because the two capture
// genuinely different work - dealers/orders/collection vs. crop
// agronomy - but they share the same day_closures table, the same
// UNIQUE(officer_id, date) duplicate guard, and the same logout gate.
//
// Labels, placeholders and required-ness are ADMIN-CONFIGURABLE: they
// come from GET /day-closure-config (the same Form Builder backing the
// field-officer form), with the hardcoded values below used only as a
// fallback if that fetch fails. A config problem must never blank the
// form or block an officer from closing their day.

const inputCls =
  "w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-green-600";

type Option = { value: string; label: string };

const DISTRICTS_FALLBACK = ["Dindigul", "Tiruppur", "Coimbatore", "Erode", "Salem"];

const VISIT_PURPOSE_FALLBACK: Option[] = [
  { value: "dealer_visit", label: "Dealer Visit" },
  { value: "stock_audit", label: "Stock Audit" },
  { value: "order_booking", label: "Order Booking" },
  { value: "collection", label: "Collection" },
  { value: "fo_field_review", label: "FO Field Review" },
  { value: "new_dealer_onboarding", label: "New Dealer Onboarding" },
  { value: "competitor_intel", label: "Competitor Intel" },
  { value: "other", label: "Other" },
];

const STOCK_STATUS_FALLBACK: Option[] = [
  { value: "adequate", label: "Adequate Stock" },
  { value: "low_reorder", label: "Low Stock - Reorder Needed" },
  { value: "out_of_stock", label: "Out of Stock" },
  { value: "not_applicable", label: "Not Applicable" },
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

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${value === true ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${value === false ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`}
      >
        No
      </button>
    </div>
  );
}

export default function SalesDayClosureForm({
  onSubmitted,
  onError,
}: {
  onSubmitted: () => void;
  onError?: (msg: string) => void;
}) {
  const [district, setDistrict] = useState("");
  const [visitDate, setVisitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dealerName, setDealerName] = useState("");
  const [village, setVillage] = useState("");
  const [dealerContact, setDealerContact] = useState("");
  const [visitPurpose, setVisitPurpose] = useState("");
  const [visitPurposeOther, setVisitPurposeOther] = useState("");
  const [orderBooked, setOrderBooked] = useState<boolean | null>(null);
  const [orderValue, setOrderValue] = useState("");
  const [amountCollected, setAmountCollected] = useState("");
  const [newDealerDetails, setNewDealerDetails] = useState("");
  const [reviewedFoVisit, setReviewedFoVisit] = useState<boolean | null>(null);
  const [competitorActivity, setCompetitorActivity] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [dayRating, setDayRating] = useState<number | null>(null);
  const [remarks, setRemarks] = useState("");
  const [dealerPhotos, setDealerPhotos] = useState<File[]>([]);
  const [competitorPhotos, setCompetitorPhotos] = useState<File[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Admin-configurable field metadata + option lists.
  const [cfg, setCfg] = useState<Record<string, { label: string; is_required: boolean }>>({});
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [purposes, setPurposes] = useState<Option[]>(VISIT_PURPOSE_FALLBACK);
  const [stockOptions, setStockOptions] = useState<Option[]>(STOCK_STATUS_FALLBACK);

  const [customFields, setCustomFields] = useState<any[]>([]);
  const [customFieldAnswers, setCustomFieldAnswers] = useState<Record<string, any>>({});
  const [configVersion, setConfigVersion] = useState<number>(1);

  useEffect(() => {
    apiFetch<any[]>("/day-closure-config")
      .then((rows) => {
        const map: Record<string, { label: string; is_required: boolean }> = {};
        (rows || []).forEach((r) => { map[r.field_key] = { label: r.label, is_required: r.is_required }; });
        setCfg(map);
        setCfgLoaded(true);
      })
      .catch(() => {});
    apiFetch<any[]>("/enum-options/sales_visit_purpose")
      .then((r) => { if (r?.length) setPurposes(r); }).catch(() => {});
    apiFetch<any[]>("/enum-options/sales_stock_status")
      .then((r) => { if (r?.length) setStockOptions(r); }).catch(() => {});
    apiFetch<any>("/custom-fields/day_closure").then((res) => {
      setCustomFields(res?.fields || []);
      if (res?.version) setConfigVersion(res.version);
    }).catch(() => {});
  }, []);

  // A field is only hidden once we have CONFIRMED config that omits it -
  // never because the fetch failed or hasn't returned yet.
  const visible = (key: string) => !cfgLoaded || key in cfg;
  const label = (key: string, fallback: string) => cfg[key]?.label ?? fallback;
  const required = (key: string, fallback: boolean) => {
    if (!visible(key)) return false;
    return cfg[key]?.is_required ?? fallback;
  };

  // Driven by the option's requires_description flag, never by
  // value === "other" - admin-created options are covered too.
  const purposeNeedsDesc = needsDescription(purposes as any, visitPurpose);

  const uploadOne = async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append("file", file);
    const token = tokenStorage.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE_URL}/day-closure/upload`, { method: "POST", headers, body: fd });
    if (!res.ok) throw new Error("Failed to upload photo.");
    return (await res.json()).url;
  };

  const handleSubmit = async () => {
    setFormError("");
    const missing: string[] = [];
    if (required("sales_district", true) && !district) missing.push("District");
    if (required("sales_dealer_name", true) && !dealerName.trim()) missing.push("Dealer name");
    if (required("sales_visit_purpose", true) && !visitPurpose) missing.push("Visit purpose");
    if (required("sales_amount_collected", true) && amountCollected === "") missing.push("Amount collected");
    if (required("sales_remarks", true) && !remarks.trim()) missing.push("Remarks");
    // An option flagged requires_description must carry one. Reported
    // with its own message rather than folded into the generic
    // "X is required" list, so the officer knows what to type.
    if (descriptionMissing(purposeNeedsDesc, visitPurposeOther)) {
      setFormError(OTHER_DESCRIPTION_MESSAGE);
      return;
    }
    if (missing.length) {
      setFormError(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`);
      return;
    }

    setSubmitting(true);
    try {
      const images: { image_url: string; image_type: string }[] = [];
      for (const f of dealerPhotos) images.push({ image_url: await uploadOne(f), image_type: "dealer_shop" });
      for (const f of competitorPhotos) images.push({ image_url: await uploadOne(f), image_type: "competitor" });

      await apiFetch("/day-closure/sales", {
        method: "POST",
        body: JSON.stringify({
          district,
          visit_date: visitDate || null,
          dealer_name: dealerName.trim(),
          village: village.trim() || null,
          dealer_contact: dealerContact.trim() || null,
          visit_purpose: visitPurpose,
          visit_purpose_other_text: clearIfNotRequired(purposeNeedsDesc, visitPurposeOther),
          order_booked: orderBooked,
          order_value: orderValue !== "" ? parseFloat(orderValue) : null,
          amount_collected: amountCollected !== "" ? parseFloat(amountCollected) : null,
          new_dealer_details: newDealerDetails.trim() || null,
          reviewed_fo_visit: reviewedFoVisit,
          competitor_activity: competitorActivity.trim() || null,
          stock_status: stockStatus || null,
          day_rating: dayRating,
          remarks: remarks.trim() || null,
          images,
          config_version: configVersion,
          custom_field_answers: customFieldAnswers,
        }),
      });
      onSubmitted();
    } catch (err: any) {
      const msg = err.message || "Couldn't submit today's closure.";
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

      <Section title={label("__s1", "1. Visit & Dealer Details")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visible("sales_district") && (
            <Field label={label("sales_district", "District")} required={required("sales_district", true)}>
              <select className={inputCls} value={district} onChange={(e) => setDistrict(e.target.value)}>
                <option value="">-- Select --</option>
                {DISTRICTS_FALLBACK.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          )}
          {visible("sales_visit_date") && (
            <Field label={label("sales_visit_date", "Date of Update")} required={required("sales_visit_date", true)}>
              <input type="date" className={inputCls} value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
            </Field>
          )}
          {visible("sales_dealer_name") && (
            <Field label={label("sales_dealer_name", "Dealer / Distributor Name")} required={required("sales_dealer_name", true)}>
              <input className={inputCls} placeholder="One dealer per closure" value={dealerName} onChange={(e) => setDealerName(e.target.value)} />
            </Field>
          )}
          {visible("sales_village") && (
            <Field label={label("sales_village", "Village / Location")} required={required("sales_village", true)}>
              <input className={inputCls} value={village} onChange={(e) => setVillage(e.target.value)} />
            </Field>
          )}
          {visible("sales_dealer_contact") && (
            <Field label={label("sales_dealer_contact", "Contact Number")} required={required("sales_dealer_contact", true)}>
              <input className={inputCls} value={dealerContact} onChange={(e) => setDealerContact(e.target.value)} />
            </Field>
          )}
          {visible("sales_visit_purpose") && (
            <Field label={label("sales_visit_purpose", "Visit Purpose")} required={required("sales_visit_purpose", true)}>
              <select className={inputCls} value={visitPurpose} onChange={(e) => setVisitPurpose(e.target.value)}>
                <option value="">-- Select --</option>
                {purposes.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <OtherDescriptionInput
                required={purposeNeedsDesc}
                value={visitPurposeOther}
                onChange={setVisitPurposeOther}
                showError={!!formError}
              />
            </Field>
          )}
        </div>
      </Section>

      <Section title="2. Orders & Collection">
        {visible("sales_order_booked") && (
          <Field label={label("sales_order_booked", "Was an Order Booked?")} required={required("sales_order_booked", true)}>
            <YesNo value={orderBooked} onChange={setOrderBooked} />
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Only asked when an order was actually booked - the source
              form leaves it optional, and showing it after "No" invites
              a meaningless zero. */}
          {orderBooked === true && visible("sales_order_value") && (
            <Field label={label("sales_order_value", "Order Value (Rs)")} required={required("sales_order_value", false)}>
              <input type="number" min="0" className={inputCls} value={orderValue} onChange={(e) => setOrderValue(e.target.value)} />
            </Field>
          )}
          {visible("sales_amount_collected") && (
            <Field label={label("sales_amount_collected", "Amount Collected from Dealer (Rs)")} required={required("sales_amount_collected", true)}>
              <input type="number" min="0" className={inputCls} value={amountCollected} onChange={(e) => setAmountCollected(e.target.value)} />
            </Field>
          )}
        </div>
        {visible("sales_new_dealer") && (
          <Field label={label("sales_new_dealer", "Is This a New Dealer Onboarded Today?")} required={required("sales_new_dealer", true)}>
            <textarea className={inputCls} rows={2} placeholder="If yes, name and contact details. Otherwise write No." value={newDealerDetails} onChange={(e) => setNewDealerDetails(e.target.value)} />
          </Field>
        )}
      </Section>

      <Section title="3. Field & Market Intelligence">
        {visible("sales_fo_review") && (
          <Field label={label("sales_fo_review", "Did You Review/Accompany an FO Field Visit Today?")} required={required("sales_fo_review", true)}>
            <YesNo value={reviewedFoVisit} onChange={setReviewedFoVisit} />
          </Field>
        )}
        {visible("sales_competitor_activity") && (
          <Field label={label("sales_competitor_activity", "Any Competitor Activity Observed?")} required={required("sales_competitor_activity", true)}>
            <textarea className={inputCls} rows={2} placeholder="Pricing, promotions, new products" value={competitorActivity} onChange={(e) => setCompetitorActivity(e.target.value)} />
          </Field>
        )}
        {visible("sales_competitor_photos") && (
          <Field label={label("sales_competitor_photos", "Competitor Activity Photos")}>
            <input type="file" accept="image/*" multiple className="text-sm" onChange={(e) => setCompetitorPhotos(Array.from(e.target.files || []).slice(0, 10))} />
            {competitorPhotos.length > 0 && <p className="text-xs text-slate-500 mt-1">{competitorPhotos.length} selected</p>}
          </Field>
        )}
        {visible("sales_stock_status") && (
          <Field label={label("sales_stock_status", "Dealer Stock Status")} required={required("sales_stock_status", true)}>
            <select className={inputCls} value={stockStatus} onChange={(e) => setStockStatus(e.target.value)}>
              <option value="">-- Select --</option>
              {stockOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
        )}
      </Section>

      <Section title="4. Rating & Follow-up">
        {visible("sales_day_rating") && (
          <Field label={label("sales_day_rating", "Rating of Visit / Day (1-5)")}>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">Poor</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDayRating(n)}
                  className={`w-9 h-9 rounded-full border-2 text-sm font-semibold transition ${
                    dayRating === n ? "border-green-700 bg-green-700 text-white" : "border-slate-200 text-slate-500 hover:border-green-400"
                  }`}
                >
                  {n}
                </button>
              ))}
              <span className="text-xs text-slate-400">Excellent</span>
            </div>
          </Field>
        )}
        {visible("sales_remarks") && (
          <Field label={label("sales_remarks", "Remarks / Next Follow-up Plan")} required={required("sales_remarks", true)}>
            <textarea className={inputCls} rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        )}
        {visible("sales_dealer_photos") && (
          <Field label={label("sales_dealer_photos", "Dealer Shop Photo")} required={required("sales_dealer_photos", true)}>
            <input type="file" accept="image/*" multiple className="text-sm" onChange={(e) => setDealerPhotos(Array.from(e.target.files || []).slice(0, 10))} />
            {dealerPhotos.length > 0 && <p className="text-xs text-slate-500 mt-1">{dealerPhotos.length} selected</p>}
          </Field>
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
