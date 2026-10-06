import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../../components/FetchStates';
import DynamicFieldRenderer from '../../components/DynamicFieldRenderer';
import { CUSTOM_FIELD_TYPES } from '../../lib/customFieldTypes';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// ---------------------------------------------------------------------------
// Day Closure Form Builder (admin only) - the Android counterpart of the web
// dashboard's DayClosureFormBuilder. Same endpoints, same bodies:
//   GET    /admin/day-closure-config                       built-in fields
//   PUT    /admin/day-closure-config/{field_key}           edit one built-in field (partial)
//   PUT    /admin/day-closure-config/reorder               { items: [{ field_key, display_order }] }
//   POST   /admin/day-closure-config/restore-defaults
//   GET    /day-closure-sections                           sections
//   POST   /admin/day-closure-sections                     { label }
//   PUT    /admin/day-closure-sections/{section_key}       { label }
//   PUT    /admin/day-closure-sections/reorder             { items: [{ section_key, display_order }] }
//   DELETE /admin/day-closure-sections/{section_key}
//   GET    /admin/custom-fields/day_closure                { version, fields }
//   POST   /admin/custom-fields/day_closure                create a custom field
//   PUT    /admin/custom-fields/day_closure/{field_key}    edit (partial)
//   PUT    /admin/custom-fields/day_closure/reorder        { items: [{ field_key, display_order }] }
//   DELETE /admin/custom-fields/day_closure/{field_key}    soft delete
//   GET/POST/PUT/DELETE /admin/enum-options/{field_name}   choice lists (crop_status, farming_type, demo_status)
// Every change is saved immediately (there is no separate Save step), exactly
// like the web builder's section and custom-field actions.
// ---------------------------------------------------------------------------

const FORM_KEY = 'day_closure';

// Same three built-in fields the web builder lets an admin manage choices for.
const MANAGEABLE_ENUM_FIELDS = new Set(['crop_status', 'farming_type', 'demo_status']);

const TYPE_LABELS: Record<string, string> = {
  text: 'Short text',
  number: 'Number',
  date: 'Date',
  select: 'Choice list',
  textarea: 'Long text',
  checkbox: 'Tick box',
};

const typeLabel = (type: string): string => TYPE_LABELS[type] ?? type;

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

type CustomOption = { value: string; label: string };

type CustomField = {
  id: string;
  form_key: string;
  field_key: string;
  section: string;
  label: string;
  placeholder: string | null;
  help_text: string | null;
  field_type: string;
  options: CustomOption[] | null;
  is_required: boolean;
  is_enabled: boolean;
  display_order: number;
  visible_to_field_officer: boolean;
  visible_to_sales_officer: boolean;
  visible_to_manager: boolean;
  default_value: string | null;
  updated_at: string;
};

type Section = {
  id: string;
  section_key: string;
  label: string;
  display_order: number;
  is_original: boolean;
};

type EnumOption = {
  id: string;
  field_name: string;
  value: string;
  label: string;
  display_order: number;
  is_active: boolean;
  usage_count?: number | null;
};

type BuilderData = { fields: FieldConfig[]; custom: CustomField[]; sections: Section[] };

// A section on screen. `section` is null for the catch-all group that holds
// anything pointing at a section that no longer exists, so nothing is ever
// silently hidden from the admin.
type Group = { key: string; label: string; section: Section | null };

type Editor =
  | { kind: 'field'; field: FieldConfig }
  | { kind: 'custom'; field: CustomField | null; sectionKey: string; sectionLabel: string }
  | { kind: 'section'; section: Section | null }
  | { kind: 'options'; fieldKey: string; fieldLabel: string };

type SendFn = (endpoint: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown) => Promise<boolean>;

type PreviewRole = 'field_officer' | 'sales_officer';

const EMPTY_ANSWERS: Record<string, unknown> = {};
const noop = () => undefined;
const OTHER_GROUP_KEY = '__other__';
const ENUM_VALUE_PATTERN = /^[a-z0-9_]+$/;

const byOrder = <T extends { display_order: number }>(a: T, b: T) => a.display_order - b.display_order;

const slugify = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'option';

const visibilityText = (fieldOfficer: boolean, salesOfficer: boolean): string => {
  if (fieldOfficer && salesOfficer) return 'Field and sales officers';
  if (fieldOfficer) return 'Field officers only';
  if (salesOfficer) return 'Sales officers only';
  return 'Hidden from everyone';
};

const confirmAction = (title: string, message: string, confirmLabel: string, onConfirm: () => void) => {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
};

const errorMessage = (err: unknown): string => {
  const message = (err as { message?: string } | null)?.message;
  return message && message.length > 0 ? message : 'Please try again.';
};

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function IconButton({
  icon,
  label,
  onPress,
  disabled,
  tint,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tint?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.iconBtn, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons name={icon} size={22} color={tint ?? color.textPrimary} />
    </TouchableOpacity>
  );
}

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
}) {
  const isFilled = variant !== 'secondary';
  const textColor = isFilled ? color.white : color.textPrimary;
  return (
    <TouchableOpacity
      style={[
        styles.actionBtn,
        variant === 'primary' && styles.actionBtnPrimary,
        variant === 'danger' && styles.actionBtnDanger,
        variant === 'secondary' && styles.actionBtnSecondary,
        (disabled || loading) && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={textColor} style={styles.actionBtnIcon} /> : null}
          <Text style={[styles.actionBtnText, { color: textColor }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  maxLength,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  editable?: boolean;
}) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline, !editable && styles.disabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.textMuted}
        multiline={multiline}
        maxLength={maxLength}
        editable={editable}
        textAlignVertical={multiline ? 'top' : 'center'}
        accessibilityLabel={label}
      />
    </View>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.toggleRow, disabled && styles.disabled]}
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
    >
      <View style={styles.toggleTextWrap}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <View pointerEvents="none">
        <Switch
          value={value}
          trackColor={{ false: color.border, true: color.primaryLight }}
          thumbColor={value ? color.primary : color.white}
        />
      </View>
    </TouchableOpacity>
  );
}

function Sheet({
  title,
  onClose,
  closeDisabled,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!closeDisabled) onClose();
      }}
    >
      <KeyboardAvoidingView
        style={styles.sheetOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={2}>
              {title}
            </Text>
            <IconButton icon="close" label="Close" onPress={onClose} disabled={closeDisabled} />
          </View>
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetBodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Ionicons name="alert-circle-outline" size={18} color={color.error} />
      <Text style={styles.errorBoxText}>{message}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Edit a built-in field (PUT /admin/day-closure-config/{field_key}, partial)
// ---------------------------------------------------------------------------

function FieldEditorModal({
  field,
  send,
  onClose,
  onSaved,
}: {
  field: FieldConfig;
  send: SendFn;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [placeholder, setPlaceholder] = useState(field.placeholder ?? '');
  const [helpText, setHelpText] = useState(field.help_text ?? '');
  const [isRequired, setIsRequired] = useState(field.is_required);
  const [isEnabled, setIsEnabled] = useState(field.is_enabled);
  const [forFieldOfficer, setForFieldOfficer] = useState(field.visible_to_field_officer);
  const [forSalesOfficer, setForSalesOfficer] = useState(field.visible_to_sales_officer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError('Please enter a label for this field.');
      return;
    }
    if (isEnabled && isRequired && !forFieldOfficer && !forSalesOfficer) {
      setError('This field is required but hidden from every role, so nobody could fill it in. Show it to at least one role or make it optional.');
      return;
    }
    const changes: Record<string, string | boolean | null> = {};
    if (trimmedLabel !== field.label) changes.label = trimmedLabel;
    if (placeholder.trim() !== (field.placeholder ?? '')) changes.placeholder = placeholder.trim() || null;
    if (helpText.trim() !== (field.help_text ?? '')) changes.help_text = helpText.trim() || null;
    if (!field.backend_required) {
      if (isRequired !== field.is_required) changes.is_required = isRequired;
      if (isEnabled !== field.is_enabled) changes.is_enabled = isEnabled;
    }
    if (forFieldOfficer !== field.visible_to_field_officer) changes.visible_to_field_officer = forFieldOfficer;
    if (forSalesOfficer !== field.visible_to_sales_officer) changes.visible_to_sales_officer = forSalesOfficer;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ok = await send(`/admin/day-closure-config/${encodeURIComponent(field.field_key)}`, 'PUT', changes);
      if (ok) onSaved();
      else onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={`Edit ${field.label}`}
      onClose={onClose}
      closeDisabled={saving}
      footer={
        <>
          <ActionButton label="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <ActionButton label="Save" onPress={save} loading={saving} />
        </>
      }
    >
      <InlineError message={error} />
      {field.backend_required ? (
        <View style={styles.noticeBox}>
          <Ionicons name="lock-closed-outline" size={18} color={color.warningText} />
          <Text style={styles.noticeText}>
            Every day closure needs this field, so it cannot be turned off or made optional.
          </Text>
        </View>
      ) : null}
      <TextField label="Label" value={label} onChangeText={setLabel} maxLength={200} editable={!saving} />
      <TextField label="Placeholder" value={placeholder} onChangeText={setPlaceholder} editable={!saving} />
      <TextField label="Help text" value={helpText} onChangeText={setHelpText} multiline editable={!saving} />
      <ToggleRow label="Required" value={isRequired} onChange={setIsRequired} disabled={saving || field.backend_required} />
      <ToggleRow label="Shown on the form" value={isEnabled} onChange={setIsEnabled} disabled={saving || field.backend_required} />
      <ToggleRow label="Visible to field officers" value={forFieldOfficer} onChange={setForFieldOfficer} disabled={saving} />
      <ToggleRow label="Visible to sales officers" value={forSalesOfficer} onChange={setForSalesOfficer} disabled={saving} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Add / edit a custom field
// ---------------------------------------------------------------------------

type OptionDraft = { key: string; value: string | null; label: string };

function CustomFieldEditorModal({
  field,
  sectionKey,
  sectionLabel,
  send,
  onClose,
  onSaved,
}: {
  field: CustomField | null;
  sectionKey: string;
  sectionLabel: string;
  send: SendFn;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = field === null;
  const nextKey = useRef(0);
  const [label, setLabel] = useState(field?.label ?? '');
  const [fieldType, setFieldType] = useState(field?.field_type ?? 'text');
  const [placeholder, setPlaceholder] = useState(field?.placeholder ?? '');
  const [helpText, setHelpText] = useState(field?.help_text ?? '');
  const [isRequired, setIsRequired] = useState(field?.is_required ?? false);
  const [isEnabled, setIsEnabled] = useState(field?.is_enabled ?? true);
  const [forFieldOfficer, setForFieldOfficer] = useState(field?.visible_to_field_officer ?? true);
  const [forSalesOfficer, setForSalesOfficer] = useState(field?.visible_to_sales_officer ?? true);
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    (Array.isArray(field?.options) ? field.options : []).map((o) => ({ key: `existing-${o.value}`, value: o.value, label: o.label }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSupportedType = (CUSTOM_FIELD_TYPES as readonly string[]).includes(fieldType);

  const addOption = () => {
    nextKey.current += 1;
    setOptions((prev) => [...prev, { key: `new-${nextKey.current}`, value: null, label: '' }]);
  };

  const updateOption = (key: string, text: string) => {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, label: text } : o)));
  };

  const removeOption = (key: string) => {
    setOptions((prev) => prev.filter((o) => o.key !== key));
  };

  // Existing options keep their stored value (past answers refer to it); new
  // ones get a value made from their label, made unique within the list.
  const buildOptions = (): CustomOption[] | string => {
    const labels = options.map((o) => o.label.trim());
    if (labels.some((l) => !l)) return 'Every choice needs a name. Fill in or remove the empty ones.';
    const lowered = labels.map((l) => l.toLowerCase());
    if (new Set(lowered).size !== lowered.length) return 'Two choices have the same name. Please make each one different.';
    const used = new Set<string>(options.filter((o) => o.value !== null).map((o) => o.value as string));
    return options.map((o, i) => {
      const optionLabel = labels[i] as string;
      if (o.value !== null) return { value: o.value, label: optionLabel };
      const base = slugify(optionLabel);
      let candidate = base;
      let suffix = 1;
      while (used.has(candidate)) {
        suffix += 1;
        candidate = `${base}_${suffix}`;
      }
      used.add(candidate);
      return { value: candidate, label: optionLabel };
    });
  };

  const save = async () => {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError('Please enter a label for this field.');
      return;
    }
    if (!fieldType) {
      setError('Please pick a field type.');
      return;
    }
    let builtOptions: CustomOption[] | null = null;
    if (fieldType === 'select') {
      if (options.length === 0) {
        setError('A choice list needs at least one choice. Add one below.');
        return;
      }
      const result = buildOptions();
      if (typeof result === 'string') {
        setError(result);
        return;
      }
      builtOptions = result;
    }

    setSaving(true);
    setError(null);
    try {
      let ok: boolean;
      if (field === null) {
        ok = await send(`/admin/custom-fields/${FORM_KEY}`, 'POST', {
          section: sectionKey,
          label: trimmedLabel,
          placeholder: placeholder.trim() || null,
          help_text: helpText.trim() || null,
          field_type: fieldType,
          options: builtOptions,
          is_required: isRequired,
          visible_to_field_officer: forFieldOfficer,
          visible_to_sales_officer: forSalesOfficer,
        });
      } else {
        const changes: Record<string, unknown> = {};
        if (trimmedLabel !== field.label) changes.label = trimmedLabel;
        if (fieldType !== field.field_type) changes.field_type = fieldType;
        if (placeholder.trim() !== (field.placeholder ?? '')) changes.placeholder = placeholder.trim() || null;
        if (helpText.trim() !== (field.help_text ?? '')) changes.help_text = helpText.trim() || null;
        if (isRequired !== field.is_required) changes.is_required = isRequired;
        if (isEnabled !== field.is_enabled) changes.is_enabled = isEnabled;
        if (forFieldOfficer !== field.visible_to_field_officer) changes.visible_to_field_officer = forFieldOfficer;
        if (forSalesOfficer !== field.visible_to_sales_officer) changes.visible_to_sales_officer = forSalesOfficer;
        if (builtOptions !== null && JSON.stringify(builtOptions) !== JSON.stringify(Array.isArray(field.options) ? field.options : [])) {
          changes.options = builtOptions;
        }
        // The server rejects an empty update, so skip the call when nothing changed.
        if (Object.keys(changes).length === 0) {
          onClose();
          return;
        }
        ok = await send(`/admin/custom-fields/${FORM_KEY}/${encodeURIComponent(field.field_key)}`, 'PUT', changes);
      }
      if (ok) onSaved();
      else onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={isNew ? `Add a field to ${sectionLabel}` : `Edit ${field.label}`}
      onClose={onClose}
      closeDisabled={saving}
      footer={
        <>
          <ActionButton label="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <ActionButton label={isNew ? 'Add Field' : 'Save'} onPress={save} loading={saving} />
        </>
      }
    >
      <InlineError message={error} />
      <TextField label="Label" value={label} onChangeText={setLabel} maxLength={200} editable={!saving} />

      <Text style={styles.fieldLabel}>Field type</Text>
      {!isNew && !isSupportedType ? (
        <Text style={styles.helperText}>
          This field uses the type "{fieldType}", which the Android app cannot show to officers. Pick a type below to change it.
        </Text>
      ) : null}
      <View style={styles.chipWrap} accessibilityRole="radiogroup">
        {CUSTOM_FIELD_TYPES.map((t) => {
          const selected = fieldType === t;
          return (
            <TouchableOpacity
              key={t}
              style={[styles.chip, selected && styles.chipActive, saving && styles.disabled]}
              onPress={() => setFieldType(t)}
              disabled={saving}
              accessibilityRole="radio"
              accessibilityLabel={typeLabel(t)}
              accessibilityState={{ selected, disabled: saving }}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{typeLabel(t)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {fieldType === 'select' ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Choices</Text>
          {options.length === 0 ? <Text style={styles.helperText}>No choices yet.</Text> : null}
          {options.map((o, index) => (
            <View key={o.key} style={styles.optionEditRow}>
              <TextInput
                style={[styles.input, styles.optionEditInput]}
                value={o.label}
                onChangeText={(text) => updateOption(o.key, text)}
                placeholder={`Choice ${index + 1}`}
                placeholderTextColor={color.textMuted}
                maxLength={200}
                editable={!saving}
                accessibilityLabel={`Choice ${index + 1} name`}
              />
              <IconButton
                icon="trash-outline"
                label={`Remove choice ${index + 1}`}
                onPress={() => removeOption(o.key)}
                disabled={saving}
                tint={color.error}
              />
            </View>
          ))}
          <ActionButton label="Add Choice" variant="secondary" icon="add" onPress={addOption} disabled={saving} />
        </View>
      ) : null}

      <TextField label="Placeholder (optional)" value={placeholder} onChangeText={setPlaceholder} editable={!saving} />
      <TextField label="Help text (optional)" value={helpText} onChangeText={setHelpText} multiline editable={!saving} />
      <ToggleRow label="Required" value={isRequired} onChange={setIsRequired} disabled={saving} />
      {!isNew ? <ToggleRow label="Shown on the form" value={isEnabled} onChange={setIsEnabled} disabled={saving} /> : null}
      <ToggleRow label="Visible to field officers" value={forFieldOfficer} onChange={setForFieldOfficer} disabled={saving} />
      <ToggleRow label="Visible to sales officers" value={forSalesOfficer} onChange={setForSalesOfficer} disabled={saving} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Add / rename a section
// ---------------------------------------------------------------------------

function SectionNameModal({
  section,
  send,
  onClose,
  onSaved,
}: {
  section: Section | null;
  send: SendFn;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(section?.label ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Section name is required.');
      return;
    }
    if (section !== null && trimmed === section.label) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ok =
        section === null
          ? await send('/admin/day-closure-sections', 'POST', { label: trimmed })
          : await send(`/admin/day-closure-sections/${encodeURIComponent(section.section_key)}`, 'PUT', { label: trimmed });
      if (ok) onSaved();
      else onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={section === null ? 'Add Section' : 'Rename Section'}
      onClose={onClose}
      closeDisabled={saving}
      footer={
        <>
          <ActionButton label="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <ActionButton label={section === null ? 'Add Section' : 'Save'} onPress={save} loading={saving} />
        </>
      }
    >
      <InlineError message={error} />
      <TextField label="Section name" value={label} onChangeText={setLabel} maxLength={100} editable={!saving} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Manage the choices of crop_status / farming_type / demo_status
// ---------------------------------------------------------------------------

function OptionsManagerModal({
  fieldKey,
  fieldLabel,
  send,
  onClose,
}: {
  fieldKey: string;
  fieldLabel: string;
  send: SendFn;
  onClose: () => void;
}) {
  const base = `/admin/enum-options/${encodeURIComponent(fieldKey)}`;
  const { data, loading, error, retry, refresh } = useDataFetch<EnumOption[]>(
    () => apiClient.request(base, 'GET', 'admin_action'),
    [fieldKey],
    { refetchOnFocus: false }
  );
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const options = useMemo(() => [...(Array.isArray(data) ? data : [])].sort(byOrder), [data]);

  const act = async (fn: () => Promise<boolean>): Promise<boolean> => {
    setWorking(true);
    setMessage(null);
    try {
      const ok = await fn();
      if (ok) refresh();
      return ok;
    } catch (err) {
      setMessage(errorMessage(err));
      return false;
    } finally {
      setWorking(false);
    }
  };

  const saveLabel = (opt: EnumOption) => {
    const draft = (labelDrafts[opt.id] ?? opt.label).trim();
    if (!draft) {
      setMessage('A choice needs a display name.');
      return;
    }
    act(async () => {
      const ok = await send(`${base}/${encodeURIComponent(opt.id)}`, 'PUT', { label: draft });
      if (ok) {
        setLabelDrafts((prev) => {
          const next = { ...prev };
          delete next[opt.id];
          return next;
        });
      }
      return ok;
    });
  };

  const move = (index: number, direction: -1 | 1) => {
    const a = options[index];
    const b = options[index + direction];
    if (!a || !b) return;
    act(() =>
      send(`${base}/reorder`, 'PUT', {
        items: [
          { id: a.id, display_order: b.display_order },
          { id: b.id, display_order: a.display_order },
        ],
      })
    );
  };

  const deactivate = (opt: EnumOption) => {
    confirmAction(
      'Hide Choice',
      'Hide this choice from future forms? Records that already used it are not affected.',
      'Hide',
      () => {
        act(() => send(`${base}/${encodeURIComponent(opt.id)}/deactivate`, 'PUT'));
      }
    );
  };

  const remove = (opt: EnumOption) => {
    confirmAction(
      'Delete Choice',
      'Delete this choice permanently? This only works if no existing record uses it. Otherwise hide it instead.',
      'Delete',
      () => {
        act(() => send(`${base}/${encodeURIComponent(opt.id)}`, 'DELETE'));
      }
    );
  };

  const addOption = () => {
    const value = newValue.trim();
    const label = newLabel.trim();
    if (!value || !label) {
      setMessage('Please enter both an internal value and a display name.');
      return;
    }
    if (value.length > 50 || !ENUM_VALUE_PATTERN.test(value)) {
      setMessage('The internal value can only use lowercase letters, numbers and underscores, up to 50 characters (for example: very_severe).');
      return;
    }
    act(async () => {
      const ok = await send(base, 'POST', { value, label });
      if (ok) {
        setNewValue('');
        setNewLabel('');
      }
      return ok;
    });
  };

  let body: React.ReactNode;
  if (loading) {
    body = <ActivityIndicator style={styles.sheetLoader} size="large" color={color.primary} />;
  } else if (error) {
    body = (
      <View>
        <InlineError message={error} />
        <ActionButton label="Try Again" onPress={retry} />
      </View>
    );
  } else {
    body = (
      <View>
        <InlineError message={message} />
        {options.length === 0 ? <Text style={styles.helperText}>No choices yet.</Text> : null}
        {options.map((opt, index) => {
          const draft = labelDrafts[opt.id];
          const edited = draft !== undefined && draft !== opt.label;
          return (
            <View key={opt.id} style={[styles.optionCard, !opt.is_active && styles.rowOff]}>
              <TextInput
                style={styles.input}
                value={draft ?? opt.label}
                onChangeText={(text) => setLabelDrafts((prev) => ({ ...prev, [opt.id]: text }))}
                maxLength={200}
                editable={!working}
                accessibilityLabel={`Display name for ${opt.value}`}
              />
              <Text style={styles.rowMeta}>
                Value: {opt.value}
                {typeof opt.usage_count === 'number'
                  ? ` · used by ${opt.usage_count} record${opt.usage_count === 1 ? '' : 's'}`
                  : ''}
                {opt.is_active ? '' : ' · hidden'}
              </Text>
              <View style={styles.rowActions}>
                {edited ? (
                  <IconButton icon="checkmark" label={`Save name for ${opt.value}`} onPress={() => saveLabel(opt)} disabled={working} tint={color.success} />
                ) : null}
                <IconButton icon="chevron-up" label={`Move ${opt.label} up`} onPress={() => move(index, -1)} disabled={working || index === 0} />
                <IconButton icon="chevron-down" label={`Move ${opt.label} down`} onPress={() => move(index, 1)} disabled={working || index === options.length - 1} />
                {opt.is_active ? (
                  <IconButton icon="eye-off-outline" label={`Hide ${opt.label}`} onPress={() => deactivate(opt)} disabled={working} tint={color.warningText} />
                ) : null}
                <IconButton icon="trash-outline" label={`Delete ${opt.label}`} onPress={() => remove(opt)} disabled={working} tint={color.error} />
              </View>
            </View>
          );
        })}

        <View style={styles.addBox}>
          <Text style={styles.fieldLabel}>Add a choice</Text>
          <TextInput
            style={styles.input}
            value={newValue}
            onChangeText={setNewValue}
            placeholder="internal_value"
            placeholderTextColor={color.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={50}
            editable={!working}
            accessibilityLabel="Internal value for the new choice"
          />
          <TextInput
            style={[styles.input, styles.inputSpaced]}
            value={newLabel}
            onChangeText={setNewLabel}
            placeholder="Display name"
            placeholderTextColor={color.textMuted}
            maxLength={200}
            editable={!working}
            accessibilityLabel="Display name for the new choice"
          />
          <ActionButton label="Add Choice" icon="add" onPress={addOption} loading={working} />
        </View>
      </View>
    );
  }

  return (
    <Sheet
      title={`Choices for ${fieldLabel}`}
      onClose={onClose}
      closeDisabled={working}
      footer={<ActionButton label="Done" variant="secondary" onPress={onClose} disabled={working} />}
    >
      <Text style={styles.helperText}>Changes here are saved straight away.</Text>
      {body}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------

export default function AdminFormBuilderScreen() {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [previewRole, setPreviewRole] = useState<PreviewRole>('field_officer');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<BuilderData>(async () => {
    const [fields, customRes, sections] = await Promise.all([
      apiClient.request('/admin/day-closure-config', 'GET', 'admin_action'),
      apiClient.request(`/admin/custom-fields/${FORM_KEY}`, 'GET', 'admin_action'),
      apiClient.request('/day-closure-sections', 'GET', 'admin_action'),
    ]);
    return {
      fields: Array.isArray(fields) ? (fields as FieldConfig[]) : [],
      custom: Array.isArray(customRes?.fields) ? (customRes.fields as CustomField[]) : [],
      sections: Array.isArray(sections) ? (sections as Section[]) : [],
    };
  });

  const sections = useMemo(() => [...(data?.sections ?? [])].sort(byOrder), [data]);
  const fields = useMemo(() => [...(data?.fields ?? [])].sort(byOrder), [data]);
  const custom = useMemo(() => [...(data?.custom ?? [])].sort(byOrder), [data]);

  const knownSectionKeys = useMemo(() => new Set(sections.map((s) => s.section_key)), [sections]);

  const groups = useMemo<Group[]>(() => {
    const list: Group[] = sections.map((s) => ({ key: s.section_key, label: s.label, section: s }));
    const hasOrphans =
      fields.some((f) => !knownSectionKeys.has(f.section)) || custom.some((f) => !knownSectionKeys.has(f.section));
    if (hasOrphans) list.push({ key: OTHER_GROUP_KEY, label: 'Other fields', section: null });
    return list;
  }, [sections, fields, custom, knownSectionKeys]);

  const inGroup = useCallback(
    <T extends { section: string }>(group: Group, items: T[]): T[] =>
      items.filter((i) => (group.section ? i.section === group.key : !knownSectionKeys.has(i.section))),
    [knownSectionKeys]
  );

  const hiddenRequiredWarnings = useMemo(
    () =>
      fields
        .filter((f) => f.is_enabled && f.is_required && !f.visible_to_field_officer && !f.visible_to_sales_officer)
        .map((f) => `"${f.label}" is required but hidden from every role, so nobody can fill it in.`),
    [fields]
  );

  // Sends one change. Resolves false when the phone is offline (the change is
  // only queued on the phone, so the user is told plainly); rejects with the
  // server's message when the server refuses it.
  const send = useCallback<SendFn>(async (endpoint, method, body) => {
    const result = await apiClient.request(endpoint, method, 'admin_action', body);
    if (result && result.offline) {
      Alert.alert(
        'You Are Offline',
        'This change was saved on your phone and will be sent when you are back online. The form will not show it until then.'
      );
      return false;
    }
    return true;
  }, []);

  const runAction = async (title: string, fn: () => Promise<boolean>) => {
    setBusy(true);
    try {
      const ok = await fn();
      if (ok) refresh();
    } catch (err) {
      Alert.alert(title, errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const closeEditor = () => setEditor(null);
  const handleSaved = () => {
    setEditor(null);
    refresh();
  };

  const toggleCollapsed = (key: string) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  const moveSection = (index: number, direction: -1 | 1) => {
    const a = sections[index];
    const b = sections[index + direction];
    if (!a || !b) return;
    runAction('Could Not Reorder', () =>
      send('/admin/day-closure-sections/reorder', 'PUT', {
        items: [
          { section_key: a.section_key, display_order: b.display_order },
          { section_key: b.section_key, display_order: a.display_order },
        ],
      })
    );
  };

  const deleteSection = (section: Section) => {
    const realCount = fields.filter((f) => f.section === section.section_key).length;
    const customCount = custom.filter((f) => f.section === section.section_key).length;
    if (realCount > 0) {
      Alert.alert(
        'Cannot Delete Section',
        `"${section.label}" has ${realCount} built-in field${realCount === 1 ? '' : 's'} that every day closure needs, so it cannot be deleted. Only empty sections, or sections made up entirely of custom fields, can be removed.`
      );
      return;
    }
    const message =
      customCount > 0
        ? `Delete "${section.label}"? This also removes its ${customCount} custom field${customCount === 1 ? '' : 's'}. Answers already submitted for them are kept.`
        : `Delete "${section.label}"? It is empty.`;
    confirmAction('Delete Section', message, 'Delete', () => {
      runAction('Could Not Delete', () =>
        send(`/admin/day-closure-sections/${encodeURIComponent(section.section_key)}`, 'DELETE')
      );
    });
  };

  const moveField = (group: Group, index: number, direction: -1 | 1) => {
    const list = inGroup(group, fields);
    const a = list[index];
    const b = list[index + direction];
    if (!a || !b) return;
    runAction('Could Not Reorder', () =>
      send('/admin/day-closure-config/reorder', 'PUT', {
        items: [
          { field_key: a.field_key, display_order: b.display_order },
          { field_key: b.field_key, display_order: a.display_order },
        ],
      })
    );
  };

  const moveCustomField = (group: Group, index: number, direction: -1 | 1) => {
    const list = inGroup(group, custom);
    const a = list[index];
    const b = list[index + direction];
    if (!a || !b) return;
    runAction('Could Not Reorder', () =>
      send(`/admin/custom-fields/${FORM_KEY}/reorder`, 'PUT', {
        items: [
          { field_key: a.field_key, display_order: b.display_order },
          { field_key: b.field_key, display_order: a.display_order },
        ],
      })
    );
  };

  const deleteCustomField = (field: CustomField) => {
    confirmAction(
      'Remove Custom Field',
      `Remove "${field.label}"? Answers already submitted for it are kept, but it will no longer be collected.`,
      'Remove',
      () => {
        runAction('Could Not Remove', () =>
          send(`/admin/custom-fields/${FORM_KEY}/${encodeURIComponent(field.field_key)}`, 'DELETE')
        );
      }
    );
  };

  const restoreDefaults = () => {
    confirmAction(
      'Restore Defaults',
      'Reset the Day Closure form to its original setup? Every label, order, requirement and visibility change is discarded, and all custom fields are removed (answers already submitted are kept). Section names and order are not changed.',
      'Restore',
      () => {
        runAction('Could Not Restore', () => send('/admin/day-closure-config/restore-defaults', 'POST'));
      }
    );
  };

  // ---- Edit view ----------------------------------------------------------

  const renderEditGroup = (group: Group, groupIndex: number) => {
    const isCollapsed = !!collapsed[group.key];
    const groupFields = inGroup(group, fields);
    const groupCustom = inGroup(group, custom);
    const count = groupFields.length + groupCustom.length;
    return (
      <View key={group.key} style={styles.card}>
        <View style={styles.cardHeader}>
          <TouchableOpacity
            style={styles.cardHeaderTitle}
            onPress={() => toggleCollapsed(group.key)}
            accessibilityRole="button"
            accessibilityLabel={`${group.label}, ${count} field${count === 1 ? '' : 's'}`}
            accessibilityHint={isCollapsed ? 'Tap to show the fields' : 'Tap to hide the fields'}
            accessibilityState={{ expanded: !isCollapsed }}
          >
            <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={20} color={color.textSecondary} />
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {group.label}
              </Text>
              <Text style={styles.rowMeta}>
                {count} field{count === 1 ? '' : 's'}
              </Text>
            </View>
          </TouchableOpacity>
          {group.section ? (
            <View style={styles.rowActions}>
              <IconButton icon="chevron-up" label={`Move section ${group.label} up`} onPress={() => moveSection(groupIndex, -1)} disabled={busy || groupIndex === 0} />
              <IconButton icon="chevron-down" label={`Move section ${group.label} down`} onPress={() => moveSection(groupIndex, 1)} disabled={busy || groupIndex === sections.length - 1} />
              <IconButton icon="create-outline" label={`Rename section ${group.label}`} onPress={() => setEditor({ kind: 'section', section: group.section })} disabled={busy} />
              <IconButton icon="trash-outline" label={`Delete section ${group.label}`} onPress={() => group.section && deleteSection(group.section)} disabled={busy} tint={color.error} />
            </View>
          ) : null}
        </View>

        {isCollapsed ? null : (
          <View>
            {count === 0 ? <Text style={styles.helperText}>This section has no fields yet.</Text> : null}

            {groupFields.map((field, index) => (
              <View key={field.field_key} style={[styles.row, !field.is_enabled && styles.rowOff]}>
                <View style={styles.rowTitleLine}>
                  {field.backend_required ? (
                    <Ionicons name="lock-closed-outline" size={16} color={color.warningText} style={styles.rowTitleIcon} />
                  ) : null}
                  <Text style={styles.rowTitle}>{field.label}</Text>
                </View>
                <Text style={styles.rowMeta}>
                  {typeLabel(field.field_type)} · {field.is_required ? 'Required' : 'Optional'} ·{' '}
                  {field.is_enabled ? 'Shown' : 'Turned off'} ·{' '}
                  {visibilityText(field.visible_to_field_officer, field.visible_to_sales_officer)}
                </Text>
                <View style={styles.rowActions}>
                  {MANAGEABLE_ENUM_FIELDS.has(field.field_key) ? (
                    <IconButton
                      icon="list-outline"
                      label={`Manage choices for ${field.label}`}
                      onPress={() => setEditor({ kind: 'options', fieldKey: field.field_key, fieldLabel: field.label })}
                      disabled={busy}
                      tint={color.info}
                    />
                  ) : null}
                  <IconButton icon="chevron-up" label={`Move ${field.label} up`} onPress={() => moveField(group, index, -1)} disabled={busy || index === 0} />
                  <IconButton icon="chevron-down" label={`Move ${field.label} down`} onPress={() => moveField(group, index, 1)} disabled={busy || index === groupFields.length - 1} />
                  <IconButton icon="create-outline" label={`Edit ${field.label}`} onPress={() => setEditor({ kind: 'field', field })} disabled={busy} />
                </View>
              </View>
            ))}

            {groupCustom.map((field, index) => (
              <View key={field.field_key} style={[styles.row, styles.rowCustom, !field.is_enabled && styles.rowOff]}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle}>{field.label}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Custom</Text>
                  </View>
                </View>
                <Text style={styles.rowMeta}>
                  {typeLabel(field.field_type)} · {field.is_required ? 'Required' : 'Optional'} ·{' '}
                  {field.is_enabled ? 'Shown' : 'Turned off'} ·{' '}
                  {visibilityText(field.visible_to_field_officer, field.visible_to_sales_officer)}
                </Text>
                <View style={styles.rowActions}>
                  <IconButton icon="chevron-up" label={`Move ${field.label} up`} onPress={() => moveCustomField(group, index, -1)} disabled={busy || index === 0} />
                  <IconButton icon="chevron-down" label={`Move ${field.label} down`} onPress={() => moveCustomField(group, index, 1)} disabled={busy || index === groupCustom.length - 1} />
                  <IconButton
                    icon="create-outline"
                    label={`Edit ${field.label}`}
                    onPress={() => setEditor({ kind: 'custom', field, sectionKey: group.key, sectionLabel: group.label })}
                    disabled={busy}
                  />
                  <IconButton icon="trash-outline" label={`Remove ${field.label}`} onPress={() => deleteCustomField(field)} disabled={busy} tint={color.error} />
                </View>
              </View>
            ))}

            {group.section ? (
              <ActionButton
                label="Add Custom Field"
                variant="secondary"
                icon="add"
                disabled={busy}
                onPress={() => setEditor({ kind: 'custom', field: null, sectionKey: group.key, sectionLabel: group.label })}
              />
            ) : null}
          </View>
        )}
      </View>
    );
  };

  // ---- Preview ------------------------------------------------------------

  const renderPreview = () => {
    const sees = (f: { is_enabled: boolean; visible_to_field_officer: boolean; visible_to_sales_officer: boolean }) =>
      f.is_enabled && (previewRole === 'field_officer' ? f.visible_to_field_officer : f.visible_to_sales_officer);

    const blocks = groups
      .map((group) => {
        const builtIn = inGroup(group, fields).filter(sees);
        const customFields = inGroup(group, custom).filter(sees);
        const supported = customFields.filter((f) => (CUSTOM_FIELD_TYPES as readonly string[]).includes(f.field_type));
        const unsupported = customFields.filter((f) => !(CUSTOM_FIELD_TYPES as readonly string[]).includes(f.field_type));
        return { group, builtIn, supported, unsupported };
      })
      .filter((b) => b.builtIn.length + b.supported.length + b.unsupported.length > 0);

    return (
      <View>
        <View style={styles.tabs} accessibilityRole="tablist">
          {(['field_officer', 'sales_officer'] as const).map((role) => {
            const selected = previewRole === role;
            const text = role === 'field_officer' ? 'Field Officer' : 'Sales Officer';
            return (
              <TouchableOpacity
                key={role}
                style={[styles.tab, selected && styles.tabActive]}
                onPress={() => setPreviewRole(role)}
                accessibilityRole="tab"
                accessibilityLabel={`Preview as ${text}`}
                accessibilityState={{ selected }}
              >
                <Text style={[styles.tabText, selected && styles.tabTextActive]}>{text}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.helperText}>
          This is how the saved form looks to this role, in order. It is read-only; nothing here can be filled in.
        </Text>
        {blocks.length === 0 ? (
          <EmptyState message="No fields are visible to this role." />
        ) : (
          blocks.map(({ group, builtIn, supported, unsupported }) => (
            <View key={group.key} style={styles.card}>
              <Text style={styles.cardTitle}>{group.label}</Text>
              {builtIn.map((f) => (
                <View key={f.field_key} style={styles.previewField}>
                  <Text style={styles.previewLabel}>
                    {f.label}
                    {f.is_required ? <Text style={styles.requiredStar}> *</Text> : null}
                  </Text>
                  {f.help_text ? <Text style={styles.rowMeta}>{f.help_text}</Text> : null}
                  <View style={styles.previewBox}>
                    <Text style={styles.previewBoxText}>{f.placeholder || typeLabel(f.field_type)}</Text>
                  </View>
                </View>
              ))}
              {supported.length > 0 ? (
                <View pointerEvents="none">
                  <DynamicFieldRenderer fields={supported} answers={EMPTY_ANSWERS} onChange={noop} />
                </View>
              ) : null}
              {unsupported.map((f) => (
                <View key={f.field_key} style={styles.noticeBox}>
                  <Ionicons name="information-circle-outline" size={18} color={color.warningText} />
                  <Text style={styles.noticeText}>
                    "{f.label}" uses the type "{f.field_type}", which the Android app cannot show to officers.
                  </Text>
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    );
  };

  // ---- Screen body --------------------------------------------------------

  if (loading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message={error ?? "Couldn't load the form. Tap to try again."} onRetry={retry} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(['edit', 'preview'] as const).map((m) => {
          const selected = mode === m;
          const text = m === 'edit' ? 'Edit Form' : 'Preview';
          return (
            <TouchableOpacity
              key={m}
              style={[styles.tab, selected && styles.tabActive]}
              onPress={() => setMode(m)}
              accessibilityRole="tab"
              accessibilityLabel={text}
              accessibilityState={{ selected }}
            >
              <Ionicons name={m === 'edit' ? 'construct-outline' : 'eye-outline'} size={18} color={selected ? color.white : color.textPrimary} />
              <Text style={[styles.tabText, selected && styles.tabTextActive]}>{text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isStale ? <StaleDataBanner onRetry={refresh} /> : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        keyboardShouldPersistTaps="handled"
      >
        {mode === 'preview' ? (
          renderPreview()
        ) : (
          <View>
            <Text style={styles.helperText}>
              Changes are saved as soon as you confirm them and apply to officers straight away. Pull down to reload.
            </Text>

            {hiddenRequiredWarnings.map((w) => (
              <View key={w} style={styles.noticeBox}>
                <Ionicons name="warning-outline" size={18} color={color.warningText} />
                <Text style={styles.noticeText}>{w}</Text>
              </View>
            ))}

            {groups.length === 0 ? (
              <EmptyState message="No form sections found." actionHint="Add a section below, or pull down to reload." />
            ) : (
              groups.map((g, i) => renderEditGroup(g, i))
            )}

            <ActionButton
              label="Add Section"
              variant="secondary"
              icon="add"
              disabled={busy}
              onPress={() => setEditor({ kind: 'section', section: null })}
            />
            <View style={styles.spacer} />
            <ActionButton
              label="Restore Defaults"
              variant="danger"
              icon="refresh"
              loading={busy}
              onPress={restoreDefaults}
            />
          </View>
        )}
      </ScrollView>

      {editor?.kind === 'field' ? (
        <FieldEditorModal field={editor.field} send={send} onClose={closeEditor} onSaved={handleSaved} />
      ) : null}
      {editor?.kind === 'custom' ? (
        <CustomFieldEditorModal
          field={editor.field}
          sectionKey={editor.sectionKey}
          sectionLabel={editor.sectionLabel}
          send={send}
          onClose={closeEditor}
          onSaved={handleSaved}
        />
      ) : null}
      {editor?.kind === 'section' ? (
        <SectionNameModal section={editor.section} send={send} onClose={closeEditor} onSaved={handleSaved} />
      ) : null}
      {editor?.kind === 'options' ? (
        <OptionsManagerModal fieldKey={editor.fieldKey} fieldLabel={editor.fieldLabel} send={send} onClose={closeEditor} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  spacer: { height: spacing.md },
  disabled: { opacity: 0.45 },

  tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  tab: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
  },
  tabActive: { backgroundColor: color.primary, borderColor: color.primary },
  tabText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  tabTextActive: { color: color.white },

  helperText: { fontSize: font.caption, color: color.textSecondary, marginBottom: spacing.md },

  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: { marginBottom: spacing.sm },
  cardHeaderTitle: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: spacing.sm },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },

  row: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.borderLight,
    backgroundColor: color.screenBg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowCustom: { borderStyle: 'dashed', borderColor: color.primaryLight, backgroundColor: color.cardBg },
  rowOff: { opacity: 0.6 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  rowTitleIcon: { marginRight: spacing.xs },
  rowTitle: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  rowMeta: { fontSize: font.caption, color: color.textMuted, marginTop: spacing.xs },
  rowActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap' },

  badge: { backgroundColor: color.primaryPale, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.primary },

  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  actionBtn: {
    flexGrow: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  actionBtnPrimary: { backgroundColor: color.primary },
  actionBtnDanger: { backgroundColor: color.error },
  actionBtnSecondary: { backgroundColor: color.cardBg, borderWidth: 1, borderColor: color.border },
  actionBtnIcon: { marginRight: spacing.xs },
  actionBtnText: { fontSize: font.body, fontWeight: fontWeight.bold },

  fieldBlock: { marginBottom: spacing.md },
  fieldLabel: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginBottom: spacing.xs },
  input: {
    minHeight: 44,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.body,
    color: color.textPrimary,
  },
  inputMultiline: { minHeight: 80 },
  inputSpaced: { marginTop: spacing.sm },

  toggleRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  toggleTextWrap: { flex: 1, paddingRight: spacing.md },
  toggleLabel: { fontSize: font.body, color: color.textPrimary },
  toggleHint: { fontSize: font.caption, color: color.textMuted },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
  },
  chipActive: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: font.body, color: color.textPrimary },
  chipTextActive: { color: color.white, fontWeight: fontWeight.semibold },

  optionEditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  optionEditInput: { flex: 1 },
  optionCard: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: color.cardBg,
  },
  addBox: {
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.primaryLight,
    padding: spacing.md,
    marginTop: spacing.sm,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.error,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorBoxText: { flex: 1, fontSize: font.body, color: color.error },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: color.warningBg,
    borderWidth: 1,
    borderColor: color.warningBorder,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontSize: font.caption + 1, color: color.warningText },

  previewField: { marginTop: spacing.md },
  previewLabel: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  requiredStar: { color: color.error },
  previewBox: {
    marginTop: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    backgroundColor: color.screenBg,
    paddingHorizontal: spacing.md,
  },
  previewBoxText: { fontSize: font.body, color: color.textMuted },

  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.overlay },
  sheet: {
    maxHeight: '90%',
    backgroundColor: color.screenBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingTop: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  sheetTitle: { flex: 1, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  sheetBody: { flexGrow: 0 },
  sheetBodyContent: { padding: spacing.lg },
  sheetLoader: { marginVertical: spacing.xxl },
  sheetFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.cardBg,
  },
});
