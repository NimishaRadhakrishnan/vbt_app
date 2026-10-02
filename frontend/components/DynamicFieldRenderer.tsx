import React from "react";
import { CustomFieldType, CUSTOM_FIELD_TYPES } from "../lib/customFieldTypes";

type CustomFieldDefinition = {
  field_key: string;
  label: string;
  field_type: string;
  is_required: boolean;
  options?: { label: string; value: string }[] | null;
  placeholder?: string | null;
  help_text?: string | null;
};

type Props = {
  fields: CustomFieldDefinition[];
  answers: Record<string, any>;
  onChange: (key: string, value: any) => void;
};

export default function DynamicFieldRenderer({ fields, answers, onChange }: Props) {
  if (!fields || fields.length === 0) return null;

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const type = field.field_type as CustomFieldType;
        if (!CUSTOM_FIELD_TYPES.includes(type)) {
          return (
            <div key={field.field_key} className="p-3 bg-red-100 text-red-800 rounded">
              Unknown field type: {field.field_type} for field {field.label}
            </div>
          );
        }

        const val = answers[field.field_key];

        return (
          <div key={field.field_key} className="flex flex-col space-y-1">
            <label className="text-sm font-medium text-gray-700 flex items-center">
              {field.label} {field.is_required && <span className="text-red-500 ml-1">*</span>}
            </label>
            {field.help_text && <p className="text-xs text-gray-500">{field.help_text}</p>}

            {type === "text" && (
              <input
                type="text"
                className="border border-gray-300 rounded p-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder={field.placeholder || ""}
                value={val || ""}
                onChange={(e) => onChange(field.field_key, e.target.value)}
              />
            )}
            {type === "number" && (
              <input
                type="number"
                className="border border-gray-300 rounded p-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder={field.placeholder || ""}
                value={val || ""}
                onChange={(e) => onChange(field.field_key, e.target.value)}
              />
            )}
            {type === "date" && (
              <input
                type="date"
                className="border border-gray-300 rounded p-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                value={val || ""}
                onChange={(e) => onChange(field.field_key, e.target.value)}
              />
            )}
            {type === "textarea" && (
              <textarea
                className="border border-gray-300 rounded p-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder={field.placeholder || ""}
                rows={3}
                value={val || ""}
                onChange={(e) => onChange(field.field_key, e.target.value)}
              />
            )}
            {type === "checkbox" && (
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  className="rounded text-blue-600 focus:ring-blue-500"
                  checked={!!val}
                  onChange={(e) => onChange(field.field_key, e.target.checked)}
                />
                <span className="text-sm text-gray-700">{field.label}</span>
              </label>
            )}
            {type === "select" && (
              <select
                className="border border-gray-300 rounded p-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                value={val || ""}
                onChange={(e) => onChange(field.field_key, e.target.value)}
              >
                <option value="">{field.placeholder || "Select an option..."}</option>
                {field.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
            {type === "photos" && (
              <div className="border border-dashed border-gray-300 p-4 rounded bg-gray-50 flex items-center justify-center text-sm text-gray-500">
                <p>Photo upload component will be rendered here.</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
