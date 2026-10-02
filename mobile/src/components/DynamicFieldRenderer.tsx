import React from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from "react-native";
import { CustomFieldType, CUSTOM_FIELD_TYPES } from "../lib/customFieldTypes";
import { theme } from "../theme";

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
    <View style={styles.container}>
      {fields.map((field) => {
        const type = field.field_type as CustomFieldType;
        if (!CUSTOM_FIELD_TYPES.includes(type)) {
          return (
            <View key={field.field_key} style={styles.errorContainer}>
              <Text style={styles.errorText}>
                Unknown field type: {field.field_type} for field {field.label}
              </Text>
            </View>
          );
        }

        const val = answers[field.field_key];

        return (
          <View key={field.field_key} style={styles.fieldContainer}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>{field.label}</Text>
              {field.is_required && <Text style={styles.requiredStar}> *</Text>}
            </View>
            {field.help_text ? <Text style={styles.helpText}>{field.help_text}</Text> : null}

            {type === "text" && (
              <TextInput
                style={styles.input}
                placeholder={field.placeholder || ""}
                value={val || ""}
                onChangeText={(text) => onChange(field.field_key, text)}
                placeholderTextColor="#9CA3AF"
              />
            )}
            {type === "number" && (
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder={field.placeholder || ""}
                value={val || ""}
                onChangeText={(text) => onChange(field.field_key, text)}
                placeholderTextColor="#9CA3AF"
              />
            )}
            {type === "date" && (
              <TextInput
                style={styles.input}
                placeholder={field.placeholder || "YYYY-MM-DD"}
                value={val || ""}
                onChangeText={(text) => onChange(field.field_key, text)}
                placeholderTextColor="#9CA3AF"
              />
            )}
            {type === "textarea" && (
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder={field.placeholder || ""}
                multiline
                numberOfLines={3}
                value={val || ""}
                onChangeText={(text) => onChange(field.field_key, text)}
                placeholderTextColor="#9CA3AF"
                textAlignVertical="top"
              />
            )}
            {type === "checkbox" && (
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => onChange(field.field_key, !val)}
                activeOpacity={0.7}
              >
                <View style={[styles.checkboxBox, val && styles.checkboxChecked]}>
                  {val && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <Text style={styles.checkboxLabel}>{field.label}</Text>
              </TouchableOpacity>
            )}
            {type === "select" && (
              <View style={styles.chipWrap}>
                {field.options?.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, val === opt.value && styles.chipActive]}
                    onPress={() => onChange(field.field_key, opt.value)}
                  >
                    <Text style={[styles.chipText, val === opt.value && styles.chipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
  },
  fieldContainer: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  requiredStar: {
    color: "#EF4444",
    fontSize: 14,
  },
  helpText: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#F9FAFB",
  },
  textArea: {
    height: 80,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    paddingVertical: 4,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: "#D1D5DB",
    borderRadius: 4,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  checkmark: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  checkboxLabel: {
    fontSize: 14,
    color: "#374151",
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#fff',
  },
  chipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  chipText: {
    fontSize: 13,
    color: '#4B5563',
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#fff',
  },
  errorContainer: {
    padding: 12,
    backgroundColor: "#FEE2E2",
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: "#991B1B",
    fontSize: 14,
  },
  photoContainer: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderStyle: "dashed",
    borderRadius: 8,
    padding: 16,
    alignItems: "center",
    backgroundColor: "#F9FAFB",
  },
  photoText: {
    color: "#6B7280",
    fontSize: 12,
  },
});
