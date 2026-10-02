"use client";

import React from "react";

// Shared "Please specify" input for any option flagged
// requires_description in enum_field_options.
//
// Exists as one component because the audit that prompted this found
// each form had made its own decision - some had storage and no input,
// some had neither, and the validation wording differed. One component
// means one behaviour and one message everywhere.
//
// Driven by the FLAG, never by `value === "other"`: admins can create
// options like "Miscellaneous" at runtime, and a hardcoded check would
// silently skip them, losing the detail with no error shown.

// Must match VALIDATION_MESSAGE in
// backend/app/application/services/option_description_service.py so the
// client-side and server-side messages are identical.
export const OTHER_DESCRIPTION_MESSAGE = "Please describe the other option.";

export type EnumOption = {
  value: string;
  label: string;
  requires_description?: boolean;
};

/** True when the single selected value needs a description. */
export function needsDescription(options: EnumOption[], value: string | null): boolean {
  if (!value) return false;
  return !!options.find((o) => o.value === value)?.requires_description;
}

/** True when ANY selected value needs a description (multi-select). */
export function anyNeedsDescription(options: EnumOption[], values: string[]): boolean {
  if (!values?.length) return false;
  return options.some((o) => o.requires_description && values.includes(o.value));
}

/**
 * True when the description is required but not usefully filled in.
 * Whitespace-only counts as empty - a space is not an explanation.
 */
export function descriptionMissing(required: boolean, description: string | null | undefined): boolean {
  return required && !(description ?? "").trim();
}

export function OtherDescriptionInput({
  required,
  value,
  onChange,
  showError = false,
  label = "Please specify",
  placeholder = "Describe the other option",
}: {
  required: boolean;
  value: string;
  onChange: (v: string) => void;
  showError?: boolean;
  label?: string;
  placeholder?: string;
}) {
  // Rendering nothing when not required is what implements "hide the
  // input when the user changes to another option". Callers clear the
  // stored value alongside this (see clearIfNotRequired).
  if (!required) return null;

  const invalid = showError && descriptionMissing(required, value);

  return (
    <div className="mt-2">
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label} <span className="text-red-500">*</span>
      </label>
      <input
        className={`w-full px-3 py-2 text-sm bg-slate-50 border rounded-lg text-slate-900 focus:outline-none focus:ring-2 ${
          invalid ? "border-red-400 focus:ring-red-500" : "border-slate-200 focus:ring-green-600"
        }`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && <p className="text-xs font-semibold text-red-600 mt-1">{OTHER_DESCRIPTION_MESSAGE}</p>}
    </div>
  );
}

/**
 * What to send to the API. Returns null when the option no longer
 * requires a description, so a value typed and then abandoned is never
 * saved against an option it does not belong to - the client half of
 * the same rule the backend enforces in clear_if_not_required().
 */
export function clearIfNotRequired(required: boolean, description: string): string | null {
  if (!required) return null;
  const trimmed = description.trim();
  return trimmed ? trimmed : null;
}
