export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "textarea", "checkbox"] as const;
export type CustomFieldType = typeof CUSTOM_FIELD_TYPES[number];
