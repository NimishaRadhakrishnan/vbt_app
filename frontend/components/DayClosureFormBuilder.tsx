"use client";

import React, { useEffect, useState } from "react";
import { X, ChevronUp, ChevronDown, Save, RotateCcw, Eye, Lock, History } from "lucide-react";
import { apiFetch } from "@/lib/api/client";

type FieldConfig = {
  id: string;
  field_key: string;
  section: string;
  label: string;
  placeholder: string | null;
  help_text: string | null;
  field_type: string;
  is_required: boolean;
  is_enabled: boolean;
  display_order: number;
  visible_to_field_officer: boolean;
  visible_to_sales_officer: boolean;
  default_value: string | null;
  backend_required: boolean;
  updated_at: string;
};

type CustomField = {
  id: string;
  form_key: string;
  field_key: string;
  section: string;
  label: string;
  placeholder: string | null;
  field_type: string;
  is_required: boolean;
  is_enabled: boolean;
  visible_to_field_officer: boolean;
  visible_to_sales_officer: boolean;
  visible_to_manager: boolean;
};

import { CUSTOM_FIELD_TYPES } from "../lib/customFieldTypes";

// These 3 fields were converted (migration 202608260010) from database
// CHECK constraints to rows in enum_field_options specifically so their
// value sets could be safely admin-managed - see that migration's
// docstring for the full reasoning (a literal "generate and run a new
// migration from this button" design was requested but not built, since
// it would mean the running app server writes and executes its own
// schema-migration code from a web request).
const MANAGEABLE_ENUM_FIELDS = new Set(["crop_status", "farming_type", "demo_status"]);

type EnumOption = {
  id: string;
  field_name: string;
  value: string;
  label: string;
  display_order: number;
  is_active: boolean;
  usage_count?: number;
};

type Section = {
  id: string;
  section_key: string;
  label: string;
  display_order: number;
  is_original: boolean;
};

// Admin's Page Builder for the Day Closure / Daily Visit Tracker form.
// Deliberately scoped to configuring the ~27 fields that already exist
// and already save correctly through DailyVisitTrackerSubmitRequest -
// label, placeholder, required/optional, enabled/disabled, order, and
// per-role (Field Officer / Sales Officer) visibility. NOT arbitrary
// admin-invented fields with nowhere in the backend schema to be stored
// - see the 202608260008 migration's docstring for the full reasoning.
//
// backend_required fields (farming_type, crop_status) have their
// Required/Enabled toggles disabled here, matching the backend's own
// refusal to let them be turned off - communicated proactively rather
// than letting the admin hit an error after the fact.
export default function DayClosureFormBuilder({ onClose }: { onClose: () => void }) {
  const [savedConfig, setSavedConfig] = useState<FieldConfig[]>([]);
  const [draft, setDraft] = useState<FieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [previewMode, setPreviewMode] = useState<"field_officer" | "sales_officer" | null>(null);

  // --- Custom fields (form_key="day_closure") - reuses the generic
  // custom_field_definitions/answers system built for this exact
  // purpose. These are genuinely admin-invented fields with no backend
  // column - they save as JSON (see custom_field_router.py's own
  // docstring) rather than into DailyVisitTrackerSubmitRequest, which is
  // the explicit, accepted trade-off for anything beyond the ~27 real
  // fields above. ---
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  // Baseline copy of what the server last confirmed. Custom fields now
  // follow the same draft/Save cycle as the built-in fields above, so we
  // need something to diff against — exactly what savedConfig does for
  // `draft`.
  const [savedCustomFields, setSavedCustomFields] = useState<CustomField[]>([]);
  const [addingFieldToSection, setAddingFieldToSection] = useState<string | null>(null);
  const [newFieldDraft, setNewFieldDraft] = useState<Partial<CustomField>>({});
  const [customFieldError, setCustomFieldError] = useState("");

  const fetchCustomFields = async () => {
    try {
      const data: any = await apiFetch("/admin/custom-fields/day_closure");
      setCustomFields(data?.fields || []);
      setSavedCustomFields(data?.fields || []);
    } catch (err) {
      // Custom fields are additive - if this fetch fails, the real
      // fields above still load and work fine, so fail silently here
      // rather than blocking the whole Builder over it.
    }
  };

  // --- Sections (Part B) - previously a hardcoded SECTION_LABELS
  // constant, now real rows so Admin can rename/reorder/add one. Every
  // section action here is immediate (same reasoning as custom fields
  // above: each is its own safe, atomic operation with its own
  // server-side checks), not part of the field draft/Save Changes
  // cycle. Collapse/expand is genuinely local-only per the request -
  // no backend call, no persistence, just a per-session UI convenience. ---
  const [sections, setSections] = useState<Section[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [renamingSection, setRenamingSection] = useState<string | null>(null);
  const [sectionRenameDraft, setSectionRenameDraft] = useState("");
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionLabel, setNewSectionLabel] = useState("");
  const [sectionError, setSectionError] = useState("");

  const fetchSections = async () => {
    try {
      const data: any = await apiFetch("/day-closure-sections");
      setSections((data || []).slice().sort((a: Section, b: Section) => a.display_order - b.display_order));
    } catch (err: any) {
      setSectionError(err.message || "Failed to load sections.");
    }
  };

  const handleAddSection = async () => {
    if (!newSectionLabel.trim()) {
      setSectionError("Section name is required.");
      return;
    }
    setSectionError("");
    try {
      await apiFetch("/admin/day-closure-sections", { method: "POST", body: JSON.stringify({ label: newSectionLabel.trim() }) });
      setNewSectionLabel("");
      setAddingSection(false);
      await fetchSections();
    } catch (err: any) {
      setSectionError(err.message || "Failed to add section.");
    }
  };

  const handleRenameSection = async (sectionKey: string) => {
    if (!sectionRenameDraft.trim()) return;
    try {
      await apiFetch(`/admin/day-closure-sections/${sectionKey}`, { method: "PUT", body: JSON.stringify({ label: sectionRenameDraft.trim() }) });
      setRenamingSection(null);
      await fetchSections();
    } catch (err: any) {
      setSectionError(err.message || "Failed to rename section.");
    }
  };

  const handleMoveSection = async (sectionKey: string, direction: -1 | 1) => {
    const sorted = [...sections].sort((a, b) => a.display_order - b.display_order);
    const idx = sorted.findIndex((s) => s.section_key === sectionKey);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[swapIdx];
    if (!a || !b) return;
    const items = [
      { section_key: a.section_key, display_order: b.display_order },
      { section_key: b.section_key, display_order: a.display_order },
    ];
    setSections((prev) => prev.map((s) => {
      const match = items.find((i) => i.section_key === s.section_key);
      return match ? { ...s, display_order: match.display_order } : s;
    }));
    try {
      await apiFetch("/admin/day-closure-sections/reorder", { method: "PUT", body: JSON.stringify({ items }) });
    } catch (err: any) {
      setSectionError(err.message || "Failed to reorder sections.");
      await fetchSections();
    }
  };

  const handleDeleteSection = async (section: Section) => {
    const realFieldCount = draft.filter((f) => f.section === section.section_key).length;
    const customFieldCount = customFields.filter((f) => f.section === section.section_key).length;
    if (realFieldCount > 0) {
      window.alert(`"${section.label}" contains ${realFieldCount} real form field${realFieldCount === 1 ? "" : "s"} tied to the backend and can't be deleted — only sections made entirely of custom fields (or empty ones) can be removed.`);
      return;
    }
    const confirmMsg = customFieldCount > 0
      ? `Delete "${section.label}"? This also removes its ${customFieldCount} custom field${customFieldCount === 1 ? "" : "s"}. Past answers already submitted for them are kept.`
      : `Delete "${section.label}"? It's currently empty.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await apiFetch(`/admin/day-closure-sections/${section.section_key}`, { method: "DELETE" });
      await fetchSections();
      await fetchCustomFields();
    } catch (err: any) {
      setSectionError(err.message || "Failed to delete section.");
    }
  };

  const handleAddCustomField = async (section: string) => {
    if (!newFieldDraft.label || !newFieldDraft.field_type) {
      setCustomFieldError("Label and type are required.");
      return;
    }
    setCustomFieldError("");
    try {
      await apiFetch(`/admin/custom-fields/day_closure`, {
        method: "POST",
        body: JSON.stringify({
          section,
          label: newFieldDraft.label,
          placeholder: newFieldDraft.placeholder || null,
          field_type: newFieldDraft.field_type,
          is_required: !!newFieldDraft.is_required,
          visible_to_field_officer: newFieldDraft.visible_to_field_officer ?? true,
          visible_to_sales_officer: newFieldDraft.visible_to_sales_officer ?? true,
        }),
      });
      setAddingFieldToSection(null);
      setNewFieldDraft({});
      await fetchCustomFields();
      setSaveMessage("Custom field saved.");
    } catch (err: any) {
      setCustomFieldError(err.message || "Failed to add field.");
    }
  };

  const handleDeleteCustomField = async (fieldKey: string) => {
    if (!window.confirm("Remove this custom field? Past answers already submitted for it are kept, just no longer collected going forward.")) return;
    try {
      await apiFetch(`/admin/custom-fields/day_closure/${fieldKey}`, { method: "DELETE" });
      await fetchCustomFields();
    } catch (err: any) {
      setCustomFieldError(err.message || "Failed to remove field.");
    }
  };

  // Was: one HTTP PUT per keystroke. Typing "Dealer Shop Photo" sent 17
  // unawaited PUTs that raced; whichever response landed last won, which
  // is frequently not the one sent last — so labels persisted as
  // truncated prefixes, differently on each attempt.
  //
  // Now a purely local edit. Nothing reaches the network until Save,
  // which also makes Cancel able to undo custom-field edits for the
  // first time.
  const updateCustomField = (fieldKey: string, changes: Partial<CustomField>) => {
    setCustomFields((prev) =>
      prev.map((f) => (f.field_key === fieldKey ? { ...f, ...changes } : f))
    );
    setSaveMessage("");
  };

  // --- Manage Options (Part A) - crop_status/farming_type/demo_status'
  // value sets, now rows in enum_field_options (migration 202608260010)
  // instead of database CHECK constraints. Every action here is a real,
  // immediate, transactional backend call - no local draft/Save Changes
  // step, since each action (add/deactivate/delete/reorder) is already
  // its own safe, atomic operation with its own server-side safety
  // checks (usage count, last-option protection, dedup), unlike the
  // real-field label/order edits above which batch into one PUT. ---
  const [managingOptionsFor, setManagingOptionsFor] = useState<string | null>(null);
  const [enumOptions, setEnumOptions] = useState<EnumOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [newOptionValue, setNewOptionValue] = useState("");
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [optionsHasUnsaved, setOptionsHasUnsaved] = useState(false);

  const fetchEnumOptions = async (fieldName: string) => {
    setOptionsLoading(true);
    setOptionsError("");
    try {
      const data: any = await apiFetch(`/admin/enum-options/${fieldName}`);
      setEnumOptions(data || []);
    } catch (err: any) {
      setOptionsError(err.message || "Failed to load options.");
    } finally {
      setOptionsLoading(false);
    }
  };

  const openOptionsManager = (fieldName: string) => {
    setManagingOptionsFor(fieldName);
    setNewOptionValue("");
    setNewOptionLabel("");
    setOptionsHasUnsaved(false);
    fetchEnumOptions(fieldName);
  };

  const closeOptionsManager = () => {
    if (optionsHasUnsaved) {
      const confirmed = window.confirm("You have unsaved label/order changes in the options editor. Close anyway?");
      if (!confirmed) return;
    }
    setManagingOptionsFor(null);
  };

  const handleAddOption = async () => {
    if (!managingOptionsFor) return;
    if (!newOptionValue.trim() || !newOptionLabel.trim()) {
      setOptionsError("Both an internal value and a display label are required.");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(newOptionValue.trim())) {
      setOptionsError("Internal value must be lowercase letters, numbers, and underscores only (e.g. \"very_severe\").");
      return;
    }
    setOptionsError("");
    try {
      await apiFetch(`/admin/enum-options/${managingOptionsFor}`, {
        method: "POST",
        body: JSON.stringify({ value: newOptionValue.trim(), label: newOptionLabel.trim() }),
      });
      setNewOptionValue("");
      setNewOptionLabel("");
      await fetchEnumOptions(managingOptionsFor);
    } catch (err: any) {
      setOptionsError(err.message || "Failed to add option.");
    }
  };

  const handleUpdateOptionLabel = (id: string, label: string) => {
    setEnumOptions((prev) => prev.map((o) => (o.id === id ? { ...o, label } : o)));
    setOptionsHasUnsaved(true);
  };

  const handleSaveOptionLabel = async (id: string, label: string) => {
    if (!managingOptionsFor) return;
    try {
      await apiFetch(`/admin/enum-options/${managingOptionsFor}/${id}`, { method: "PUT", body: JSON.stringify({ label }) });
      setOptionsHasUnsaved(false);
    } catch (err: any) {
      setOptionsError(err.message || "Failed to save label.");
      await fetchEnumOptions(managingOptionsFor);
    }
  };

  const handleMoveOption = async (id: string, direction: -1 | 1) => {
    if (!managingOptionsFor) return;
    const sorted = [...enumOptions].sort((a, b) => a.display_order - b.display_order);
    const idx = sorted.findIndex((o) => o.id === id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[swapIdx];
    if (!a || !b) return;
    const items = [
      { id: a.id, display_order: b.display_order },
      { id: b.id, display_order: a.display_order },
    ];
    setEnumOptions((prev) => prev.map((o) => {
      const match = items.find((i) => i.id === o.id);
      return match ? { ...o, display_order: match.display_order } : o;
    }));
    try {
      await apiFetch(`/admin/enum-options/${managingOptionsFor}/reorder`, { method: "PUT", body: JSON.stringify({ items }) });
    } catch (err: any) {
      setOptionsError(err.message || "Failed to reorder.");
      await fetchEnumOptions(managingOptionsFor);
    }
  };

  const handleDeactivateOption = async (id: string) => {
    if (!managingOptionsFor) return;
    if (!window.confirm("Hide this option from future forms? Existing records that already used it are unaffected.")) return;
    try {
      await apiFetch(`/admin/enum-options/${managingOptionsFor}/${id}/deactivate`, { method: "PUT" });
      await fetchEnumOptions(managingOptionsFor);
    } catch (err: any) {
      setOptionsError(err.message || "Failed to deactivate option.");
    }
  };

  const handleDeleteOption = async (option: EnumOption) => {
    if (!managingOptionsFor) return;
    if (!window.confirm(`Permanently delete "${option.label}"? This can't be undone.`)) return;
    try {
      await apiFetch(`/admin/enum-options/${managingOptionsFor}/${option.id}`, { method: "DELETE" });
      await fetchEnumOptions(managingOptionsFor);
    } catch (err: any) {
      // The backend's own message already says exactly how many
      // records use it and suggests deactivating instead - shown
      // verbatim rather than replaced with a generic error.
      setOptionsError(err.message || "Failed to delete option.");
    }
  };

  const fetchConfig = async () => {
    setLoading(true);
    setError("");
    try {
      const data: any = await apiFetch("/admin/day-closure-config");
      const sorted = (data || []).slice().sort((a: FieldConfig, b: FieldConfig) => a.display_order - b.display_order);
      // savedConfig and draft must be genuinely independent copies, not
      // the same array/object references - moveField below swaps
      // display_order by creating new objects (not mutating in place),
      // but if the two states start out sharing object instances, any
      // future code that DOES mutate one would silently corrupt the
      // other too. Deep-copying each row here removes that whole class
      // of bug at the source rather than relying on every future edit
      // to remember not to mutate.
      setSavedConfig(sorted.map((f: FieldConfig) => ({ ...f })));
      setDraft(sorted.map((f: FieldConfig) => ({ ...f })));
    } catch (err: any) {
      const msg = err?.message || "";
      // An expired token is the single most common cause of the builder
      // opening blank. Say so plainly and tell the admin what to do -
      // "Token is invalid or expired" in a footer next to an empty panel
      // reads as a broken feature, not as "sign in again".
      if (/token|expired|401|unauthor/i.test(msg)) {
        setError("Your session has expired. Please sign out and sign in again, then reopen the Form Builder.");
      } else {
        setError(msg || "Failed to load form configuration.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchCustomFields();
    fetchSections();
  }, []);

  const updateField = (fieldKey: string, changes: Partial<FieldConfig>) => {
    setDraft((prev) => prev.map((f) => (f.field_key === fieldKey ? { ...f, ...changes } : f)));
  };

  const moveField = (fieldKey: string, direction: -1 | 1) => {
    setDraft((prev) => {
      const sorted = [...prev].sort((a, b) => a.display_order - b.display_order);
      const idx = sorted.findIndex((f) => f.field_key === fieldKey);
      const swapIdx = idx + direction;
      if (swapIdx < 0 || swapIdx >= sorted.length) return prev;
      if (!sorted[idx] || !sorted[swapIdx]) return prev;
      // Only allow reordering within the same section - a cross-section
      // move would need to also reassign `section`, which isn't
      // something this UI exposes (sections mirror the real form's own
      // 5 fixed groups, not something an admin renames here).
      if (sorted[idx].section !== sorted[swapIdx].section) return prev;
      // Build NEW objects for the two swapped rows rather than mutating
      // sorted[idx]/sorted[swapIdx] in place - those are the same object
      // references as in `prev` (spread only shallow-copies the array),
      // so a direct mutation here would corrupt prev's own entries too,
      // and by extension anything else still holding those references.
      const a = sorted[idx];
      const b = sorted[swapIdx];
      sorted[idx] = { ...a, display_order: b.display_order } as FieldConfig;
      sorted[swapIdx] = { ...b, display_order: a.display_order } as FieldConfig;
      return sorted;
    });
  };

  const hasChanges =
    JSON.stringify(draft) !== JSON.stringify(savedConfig) ||
    JSON.stringify(customFields) !== JSON.stringify(savedCustomFields);

  const handleRequestClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm("You have unsaved changes. Close without saving?");
      if (!confirmed) return;
    }
    onClose();
  };

  // Real-fields-required-but-disabled-for-a-submitting-role conflicts:
  // a field can't be required for someone who never even sees it. Only
  // Field Officer and Sales Officer actually submit this form (Admin/
  // Manager only view it), so those are the two roles checked here.
  // A required field that NO role can see is genuinely broken: it can
  // never be filled, so submission is impossible.
  //
  // BUG FIXED: this previously warned whenever a required field was
  // hidden from EITHER role. That is normal and intended - the sales_*
  // fields are deliberately Sales-Officer-only, and field officers have
  // their own farm-visit fields. The result was 15 permanent warnings
  // that could never be cleared, and because they also disabled Save,
  // the Form Builder could not be saved at all.
  //
  // Role-scoping a field is a legitimate configuration, not an error.
  // Only "required but visible to nobody" is actually unsatisfiable.
  const requiredButHiddenWarnings = draft
    .filter((f) => f.is_enabled && f.is_required)
    .filter((f) => !f.visible_to_field_officer && !f.visible_to_sales_officer)
    .map(
      (f) =>
        `"${f.label}" is required but hidden from every role - no one can fill it in.`
    );

  const handleCancel = () => {
    setDraft(savedConfig);
    setCustomFields(savedCustomFields);
    setSaveMessage("");
  };

  const [restoring, setRestoring] = useState(false);
  const handleRestoreDefaults = async () => {
    const confirmed = window.confirm(
      "Reset the Day Closure form to its default configuration? This discards every label, order, requirement, and visibility change ever made — officers will see the original form again."
    );
    if (!confirmed) return;
    setRestoring(true);
    setSaveMessage("");
    try {
      await apiFetch("/admin/day-closure-config/restore-defaults", { method: "POST" });
      // Restore also removes admin-created custom fields, so both lists
      // must be refetched - previously only the real-field config was,
      // leaving deleted custom fields still visible on screen under a
      // "Restored to default configuration" message.
      await Promise.all([fetchConfig(), fetchCustomFields(), fetchSections()]);
      setSaveMessage("Restored to default configuration.");
    } catch (err: any) {
      setSaveMessage(err.message || "Failed to restore defaults.");
    } finally {
      setRestoring(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage("");
    try {
      // Only send fields that actually changed - matches the backend's
      // partial-update contract (PUT only touches provided keys) and
      // avoids re-writing every row's updated_at/updated_by for fields
      // nobody actually edited.
      const changedFields = draft.filter((d) => {
        const original = savedConfig.find((s) => s.field_key === d.field_key);
        return original && JSON.stringify(original) !== JSON.stringify(d);
      });

      for (const field of changedFields) {
        await apiFetch(`/admin/day-closure-config/${field.field_key}`, {
          method: "PUT",
          body: JSON.stringify({
            label: field.label,
            placeholder: field.placeholder,
            help_text: field.help_text,
            is_required: field.is_required,
            is_enabled: field.is_enabled,
            visible_to_field_officer: field.visible_to_field_officer,
            visible_to_sales_officer: field.visible_to_sales_officer,
            default_value: field.default_value,
          }),
        });
      }

      const orderChanged = draft.some((d) => {
        const original = savedConfig.find((s) => s.field_key === d.field_key);
        return original && original.display_order !== d.display_order;
      });
      if (orderChanged) {
        await apiFetch("/admin/day-closure-config/reorder", {
          method: "PUT",
          body: JSON.stringify({
            items: draft.map((d) => ({ field_key: d.field_key, display_order: d.display_order })),
          }),
        });
      }

      // Custom fields, batched — one PUT per genuinely changed field
      // instead of one per keystroke.
      const changedCustomFields = customFields.filter((cf) => {
        const original = savedCustomFields.find((s) => s.field_key === cf.field_key);
        return original && JSON.stringify(original) !== JSON.stringify(cf);
      });

      for (const cf of changedCustomFields) {
        await apiFetch(`/admin/custom-fields/day_closure/${cf.field_key}`, {
          method: "PUT",
          body: JSON.stringify({
            label: cf.label,
            placeholder: cf.placeholder,
            field_type: cf.field_type,
            is_required: cf.is_required,
            is_enabled: cf.is_enabled,
            visible_to_field_officer: cf.visible_to_field_officer,
            visible_to_sales_officer: cf.visible_to_sales_officer,
          }),
        });
      }

      setSaveMessage("Saved. Changes are now live for officers.");
      await Promise.all([fetchConfig(), fetchCustomFields()]);
    } catch (err: any) {
      setSaveMessage(err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const grouped = sections.reduce((acc, section) => {
    acc[section.section_key] = draft.filter((f) => f.section === section.section_key).sort((a, b) => a.display_order - b.display_order);
    return acc;
  }, {} as Record<string, FieldConfig[]>);

  const previewFields = previewMode
    ? draft
        .filter((f) => f.is_enabled && (previewMode === "field_officer" ? f.visible_to_field_officer : f.visible_to_sales_officer))
        .sort((a, b) => a.display_order - b.display_order)
    : [];

  const previewCustomFields = previewMode
    ? customFields.filter((f) => f.is_enabled && (previewMode === "field_officer" ? f.visible_to_field_officer : f.visible_to_sales_officer))
    : [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full my-8 max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Day Closure Form Builder</h2>
            <p className="text-xs text-slate-400 mt-0.5">Configure labels, requirements, order, and per-role visibility. Changes apply the moment you save.</p>
          </div>
          <button onClick={handleRequestClose} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold text-slate-500 mr-1">Preview as:</span>
          <button
            onClick={() => setPreviewMode(previewMode === "field_officer" ? null : "field_officer")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${previewMode === "field_officer" ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            <Eye className="w-3.5 h-3.5" /> Field Officer
          </button>
          <button
            onClick={() => setPreviewMode(previewMode === "sales_officer" ? null : "sales_officer")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${previewMode === "sales_officer" ? "bg-green-700 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            <Eye className="w-3.5 h-3.5" /> Sales Officer
          </button>

          {/* Explicit way out of preview. Clicking the active role button
              again also exits, but nothing said so - an admin who entered
              preview had no visible route back to editing. */}
          {previewMode && (
            <button
              onClick={() => setPreviewMode(null)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-white hover:bg-slate-900"
            >
              ← Back to editing
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading form configuration...</p>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-600">{error}</p>
              <button
                onClick={() => { fetchConfig(); fetchCustomFields(); fetchSections(); }}
                className="mt-3 text-xs font-semibold text-green-700 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : sections.length === 0 ? (
            // Distinct from the error state: the fetch worked but there
            // is nothing to show, which otherwise renders as a blank
            // panel that looks broken.
            <div className="text-center py-8">
              <p className="text-sm text-slate-400">No form sections found.</p>
              <button
                onClick={() => { fetchConfig(); fetchCustomFields(); fetchSections(); }}
                className="mt-3 text-xs font-semibold text-green-700 hover:underline"
              >
                Reload
              </button>
            </div>
          ) : previewMode ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-400 italic">Preview of unsaved changes — fields a {previewMode === "field_officer" ? "Field" : "Sales"} Officer would see, in order.</p>
              {previewFields.length === 0 && previewCustomFields.length === 0 ? (
                <p className="text-sm text-slate-400">No fields visible to this role.</p>
              ) : (
                <>
                  {previewFields.map((f) => (
                    <div key={f.field_key} className="border border-slate-200 rounded-lg p-3">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        {f.label} {f.is_required && <span className="text-red-500">*</span>}
                      </label>
                      <div className="text-xs text-slate-400 italic">[{f.field_type}] {f.placeholder || "no placeholder"}</div>
                      {f.help_text && <p className="text-[11px] text-slate-400 mt-1">{f.help_text}</p>}
                    </div>
                  ))}
                  {previewCustomFields.map((f) => (
                    <div key={f.field_key} className="border border-dashed border-green-300 bg-green-50/40 rounded-lg p-3">
                      <label className="block text-xs font-semibold text-slate-600 mb-1">
                        {f.label} {f.is_required && <span className="text-red-500">*</span>}
                        <span className="ml-2 text-[10px] font-normal text-green-700">(custom)</span>
                      </label>
                      <div className="text-xs text-slate-400 italic">[{f.field_type}] {f.placeholder || "no placeholder"}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {sectionError && <p className="text-xs font-bold text-red-600 mb-3">{sectionError}</p>}
              {sections.map((section, sIdx) => {
                const sectionKey = section.section_key;
                const isCollapsed = !!collapsedSections[sectionKey];
                return (
                <div key={sectionKey}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <button onClick={() => setCollapsedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))} className="text-slate-400 hover:text-slate-700 flex-shrink-0">
                        {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                      </button>
                      {renamingSection === sectionKey ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input
                            autoFocus
                            className="px-2 py-1 text-xs font-bold text-slate-700 border border-green-400 rounded-lg flex-1"
                            value={sectionRenameDraft}
                            onChange={(e) => setSectionRenameDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleRenameSection(sectionKey); if (e.key === "Escape") setRenamingSection(null); }}
                          />
                          <button onClick={() => handleRenameSection(sectionKey)} className="text-xs font-semibold text-green-700">Save</button>
                          <button onClick={() => setRenamingSection(null)} className="text-xs font-semibold text-slate-400">Cancel</button>
                        </div>
                      ) : (
                        <h3
                          onClick={() => { setRenamingSection(sectionKey); setSectionRenameDraft(section.label); }}
                          className="text-xs font-bold text-slate-500 uppercase tracking-wide cursor-pointer hover:text-slate-800 truncate"
                          title="Click to rename"
                        >
                          {section.label}
                        </h3>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => handleMoveSection(sectionKey, -1)} disabled={sIdx === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30">
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleMoveSection(sectionKey, 1)} disabled={sIdx === sections.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30">
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteSection(section)} className="text-red-400 hover:text-red-600 text-xs font-bold px-2" title="Delete section">
                        Delete
                      </button>
                    </div>
                  </div>
                  {!isCollapsed && (
                  <div className="space-y-2">
                    {(grouped[sectionKey] || []).map((field, idx) => (
                      <div key={field.field_key} className={`border rounded-lg p-3 ${field.is_enabled ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col gap-0.5 pt-1">
                            <button
                              onClick={() => moveField(field.field_key, -1)}
                              disabled={idx === 0}
                              className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => moveField(field.field_key, 1)}
                              disabled={idx === (grouped[sectionKey] || []).length - 1}
                              className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex-1 space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Label</label>
                                <input
                                  className="w-full px-2 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                                  value={field.label}
                                  onChange={(e) => updateField(field.field_key, { label: e.target.value })}
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-0.5">Placeholder</label>
                                <input
                                  className="w-full px-2 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
                                  value={field.placeholder || ""}
                                  onChange={(e) => updateField(field.field_key, { placeholder: e.target.value || null })}
                                />
                              </div>
                            </div>

                            {MANAGEABLE_ENUM_FIELDS.has(field.field_key) && (
                              <button
                                onClick={() => openOptionsManager(field.field_key)}
                                className="text-xs font-semibold text-green-700 hover:underline"
                              >
                                Manage Options →
                              </button>
                            )}

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                              <label className={`flex items-center gap-1.5 text-xs ${field.backend_required ? "text-slate-400" : "text-slate-600"}`}>
                                <input
                                  type="checkbox"
                                  checked={field.is_required}
                                  disabled={field.backend_required}
                                  onChange={(e) => updateField(field.field_key, { is_required: e.target.checked })}
                                />
                                Required
                                {field.backend_required && <Lock className="w-3 h-3" />}
                              </label>
                              <label className={`flex items-center gap-1.5 text-xs ${field.backend_required ? "text-slate-400" : "text-slate-600"}`}>
                                <input
                                  type="checkbox"
                                  checked={field.is_enabled}
                                  disabled={field.backend_required}
                                  onChange={(e) => updateField(field.field_key, { is_enabled: e.target.checked })}
                                />
                                Enabled
                                {field.backend_required && <Lock className="w-3 h-3" />}
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={field.visible_to_field_officer}
                                  onChange={(e) => updateField(field.field_key, { visible_to_field_officer: e.target.checked })}
                                />
                                Field Officer
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                <input
                                  type="checkbox"
                                  checked={field.visible_to_sales_officer}
                                  onChange={(e) => updateField(field.field_key, { visible_to_sales_officer: e.target.checked })}
                                />
                                Sales Officer
                              </label>
                            </div>
                            {field.backend_required && (
                              <p className="text-[11px] text-amber-700 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Required by the backend — every submission needs this field, so it can&apos;t be disabled or made optional.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Custom fields (form_key="day_closure") for this
                        section - genuinely admin-created, no backend
                        column, saved as JSON at submit time. */}
                    {customFields.filter((f) => f.section === sectionKey).map((cf) => (
                      <div key={cf.field_key} className="border border-dashed border-green-300 bg-green-50/40 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                className="flex-1 px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                                value={cf.label}
                                onChange={(e) => updateCustomField(cf.field_key, { label: e.target.value })}
                              />
                              {/* The field type was previously STATIC TEXT
                                  ("Custom · number") - it looked like a
                                  setting but could not be changed, so an
                                  admin who picked the wrong type had to
                                  delete the field and start again. It is
                                  a real control now. */}
                              <select
                                className="px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 flex-shrink-0"
                                value={cf.field_type}
                                onChange={(e) => updateCustomField(cf.field_key, { field_type: e.target.value })}
                              >
                                {CUSTOM_FIELD_TYPES.map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            {/* Placeholder was only settable at creation
                                time and could never be edited afterwards. */}
                            <input
                              className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                              placeholder="Placeholder (optional)"
                              value={cf.placeholder ?? ""}
                              onChange={(e) => updateCustomField(cf.field_key, { placeholder: e.target.value || null })}
                            />
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                <input type="checkbox" checked={cf.is_required} onChange={(e) => updateCustomField(cf.field_key, { is_required: e.target.checked })} /> Required
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                <input type="checkbox" checked={cf.is_enabled} onChange={(e) => updateCustomField(cf.field_key, { is_enabled: e.target.checked })} /> Enabled
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                <input type="checkbox" checked={cf.visible_to_field_officer} onChange={(e) => updateCustomField(cf.field_key, { visible_to_field_officer: e.target.checked })} /> Field Officer
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                <input type="checkbox" checked={cf.visible_to_sales_officer} onChange={(e) => updateCustomField(cf.field_key, { visible_to_sales_officer: e.target.checked })} /> Sales Officer
                              </label>
                            </div>
                          </div>
                          <button onClick={() => handleDeleteCustomField(cf.field_key)} className="text-red-400 hover:text-red-600 text-xs font-bold px-1 flex-shrink-0">Remove</button>
                        </div>
                      </div>
                    ))}

                    {/* Add Custom Field - saves as JSON via
                        custom_field_answers, not into any real
                        DailyVisitTrackerSubmitRequest column. Edits above
                        save immediately (a custom field is its own CRUD
                        record), unlike the real fields' draft/Save
                        Changes cycle above. */}
                    {addingFieldToSection === sectionKey ? (
                      <div className="border border-green-300 bg-green-50/60 rounded-lg p-3 space-y-2">
                        {customFieldError && <p className="text-xs font-bold text-red-600">{customFieldError}</p>}
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                            placeholder="Field label"
                            value={newFieldDraft.label || ""}
                            onChange={(e) => setNewFieldDraft({ ...newFieldDraft, label: e.target.value })}
                          />
                          <select
                            className="px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                            value={newFieldDraft.field_type || ""}
                            onChange={(e) => setNewFieldDraft({ ...newFieldDraft, field_type: e.target.value })}
                          >
                            <option value="">-- Type --</option>
                            {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <input
                          className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                          placeholder="Placeholder (optional)"
                          value={newFieldDraft.placeholder || ""}
                          onChange={(e) => setNewFieldDraft({ ...newFieldDraft, placeholder: e.target.value })}
                        />
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                          <label className="flex items-center gap-1.5 text-xs text-slate-600">
                            <input type="checkbox" checked={!!newFieldDraft.is_required} onChange={(e) => setNewFieldDraft({ ...newFieldDraft, is_required: e.target.checked })} /> Required
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-slate-600">
                            <input type="checkbox" checked={newFieldDraft.visible_to_field_officer ?? true} onChange={(e) => setNewFieldDraft({ ...newFieldDraft, visible_to_field_officer: e.target.checked })} /> Field Officer
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-slate-600">
                            <input type="checkbox" checked={newFieldDraft.visible_to_sales_officer ?? true} onChange={(e) => setNewFieldDraft({ ...newFieldDraft, visible_to_sales_officer: e.target.checked })} /> Sales Officer
                          </label>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={() => { setAddingFieldToSection(null); setNewFieldDraft({}); setCustomFieldError(""); }} className="px-3 py-1.5 text-xs font-semibold text-slate-500">Cancel</button>
                          <button onClick={() => handleAddCustomField(sectionKey)} className="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-lg">Add Field</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setAddingFieldToSection(sectionKey); setNewFieldDraft({}); setCustomFieldError(""); }}
                        className="w-full py-2 text-xs font-semibold text-green-700 border border-dashed border-green-300 rounded-lg hover:bg-green-50"
                      >
                        + Add Custom Field to This Section
                      </button>
                    )}
                  </div>
                  )}
                </div>
                );
              })}

              {addingSection ? (
                <div className="border border-green-300 bg-green-50/60 rounded-lg p-3 space-y-2">
                  <input
                    autoFocus
                    className="w-full px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                    placeholder="Section name"
                    value={newSectionLabel}
                    onChange={(e) => setNewSectionLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddSection(); }}
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setAddingSection(false); setNewSectionLabel(""); setSectionError(""); }} className="px-3 py-1.5 text-xs font-semibold text-slate-500">Cancel</button>
                    <button onClick={handleAddSection} className="px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-lg">Add Section</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setAddingSection(true); setNewSectionLabel(""); setSectionError(""); }}
                  className="w-full py-2.5 text-xs font-semibold text-slate-500 border border-dashed border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  + Add Section
                </button>
              )}
            </div>
          )}
        </div>

        {requiredButHiddenWarnings.length > 0 && (
          <div className="px-6 py-2 bg-amber-50 border-t border-amber-200 flex-shrink-0">
            {requiredButHiddenWarnings.map((w, i) => (
              <p key={i} className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
                <Lock className="w-3 h-3 flex-shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <p className="text-xs font-medium text-slate-500">
              {saveMessage ||
                (hasChanges
                  ? "You have unsaved changes."
                  : "All changes saved.")}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRestoreDefaults}
              disabled={restoring || saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 rounded-lg"
              title="Reset every field to its original configuration"
            >
              <History className="w-4 h-4" /> {restoring ? "Restoring…" : "Restore Defaults"}
            </button>
            <button
              onClick={handleCancel}
              disabled={!hasChanges || saving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 rounded-lg"
            >
              <RotateCcw className="w-4 h-4" /> Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || requiredButHiddenWarnings.length > 0}
              title={requiredButHiddenWarnings.length > 0 ? "Fix the required/visibility conflicts above before saving" : undefined}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-slate-300 text-white text-sm font-bold rounded-lg"
            >
              <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      {managingOptionsFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-800">Manage Options — {managingOptionsFor.replace(/_/g, " ")}</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Changes here apply immediately, not on &quot;Save Changes.&quot;</p>
              </div>
              <button onClick={closeOptionsManager} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              {optionsError && <p className="text-xs font-bold text-red-600 mb-2">{optionsError}</p>}
              {optionsLoading ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading options...</p>
              ) : (
                enumOptions
                  .slice()
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((opt, idx, arr) => (
                    <div key={opt.id} className={`flex items-center gap-2 border rounded-lg p-2 ${opt.is_active ? "border-slate-200" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                      <div className="flex flex-col gap-0.5">
                        <button onClick={() => handleMoveOption(opt.id, -1)} disabled={idx === 0} className="text-slate-400 hover:text-slate-700 disabled:opacity-30">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleMoveOption(opt.id, 1)} disabled={idx === arr.length - 1} className="text-slate-400 hover:text-slate-700 disabled:opacity-30">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex-1">
                        <input
                          className="w-full px-2 py-1 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                          value={opt.label}
                          onChange={(e) => handleUpdateOptionLabel(opt.id, e.target.value)}
                          onBlur={(e) => handleSaveOptionLabel(opt.id, e.target.value)}
                        />
                        <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                          value: {opt.value} {typeof opt.usage_count === "number" && `· used by ${opt.usage_count} record${opt.usage_count === 1 ? "" : "s"}`}
                          {!opt.is_active && " · inactive"}
                        </p>
                      </div>
                      {opt.is_active && (
                        <button onClick={() => handleDeactivateOption(opt.id)} className="text-[11px] font-semibold text-amber-700 hover:underline flex-shrink-0">
                          Deactivate
                        </button>
                      )}
                      <button onClick={() => handleDeleteOption(opt)} className="text-red-400 hover:text-red-600 text-xs font-bold px-1 flex-shrink-0">
                        Delete
                      </button>
                    </div>
                  ))
              )}

              <div className="border border-dashed border-green-300 bg-green-50/50 rounded-lg p-3 space-y-2 mt-3">
                <p className="text-xs font-semibold text-slate-600">Add Option</p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 font-mono"
                    placeholder="internal_value"
                    value={newOptionValue}
                    onChange={(e) => setNewOptionValue(e.target.value)}
                  />
                  <input
                    className="px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-900"
                    placeholder="Display Label"
                    value={newOptionLabel}
                    onChange={(e) => setNewOptionLabel(e.target.value)}
                  />
                </div>
                <button onClick={handleAddOption} className="w-full py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-lg">
                  Add Option
                </button>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-100 flex justify-end flex-shrink-0">
              <button onClick={closeOptionsManager} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
