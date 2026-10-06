import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../services/api';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../theme';

// HR policy sections for every role (GET /hr-policies, already ordered by
// display_order on the server). Admins can edit a section with
// PATCH /hr-policies/{id}; the body takes any of title, content and
// display_order, and only the fields sent are changed, so this sends just
// what the admin actually edited.

type Policy = {
  id: string;
  section: string;
  title: string;
  content: string;
  display_order: number;
  updated_at: string;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  const d = new Date((hasZone ? iso : `${iso}Z`).replace(/(\.\d{3})\d+/, '$1'));
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export default function PoliciesScreen() {
  const isAdmin = apiClient.getCurrentUser()?.role === 'admin';
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<Policy[]>(
    () => apiClient.request('/hr-policies', 'GET', 'admin_action'),
    [],
  );

  const startEdit = (p: Policy) => {
    setEditing(p);
    setTitle(p.title);
    setContent(p.content);
    setFormError(null);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditing(null);
  };

  const save = async () => {
    if (!editing || saving) return;
    const newTitle = title.trim();
    const newContent = content.trim();
    if (!newTitle) {
      setFormError('Please enter a title.');
      return;
    }
    if (!newContent) {
      setFormError('Please enter the policy text.');
      return;
    }
    const body: { title?: string; content?: string } = {};
    if (newTitle !== editing.title) body.title = newTitle;
    if (newContent !== editing.content) body.content = newContent;
    if (Object.keys(body).length === 0) {
      setEditing(null);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const res = await apiClient.request(`/hr-policies/${editing.id}`, 'PATCH', 'admin_action', body);
      setEditing(null);
      if (res?.offline) {
        Alert.alert('Saved on Your Phone', "Will send when you're back online. The list updates after that.");
      } else {
        refresh();
      }
    } catch (err: any) {
      setFormError(err?.message ?? 'Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data || data.length === 0) {
    return <EmptyState message="No policies have been published yet." />;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listPad}
        refreshing={refreshing}
        onRefresh={refresh}
        ListHeaderComponent={isStale ? <StaleDataBanner onRetry={retry} /> : null}
        renderItem={({ item }) => {
          const open = openId === item.id;
          return (
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => setOpenId(open ? null : item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}. ${open ? 'Hide' : 'Show'} details`}
                accessibilityState={{ expanded: open }}
              >
                <View style={styles.headerText}>
                  <Text style={styles.section}>{item.section}</Text>
                  <Text style={styles.title}>{item.title}</Text>
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={22} color={color.textMuted} />
              </TouchableOpacity>

              {open && (
                <View style={styles.body}>
                  <Text style={styles.content}>{item.content}</Text>
                  {!!formatDate(item.updated_at) && (
                    <Text style={styles.meta}>Last updated {formatDate(item.updated_at)}</Text>
                  )}
                  {isAdmin && (
                    <TouchableOpacity
                      style={styles.editBtn}
                      onPress={() => startEdit(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${item.title}`}
                    >
                      <Ionicons name="create-outline" size={18} color={color.primary} />
                      <Text style={styles.editText}> Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />

      <Modal visible={editing !== null} transparent animationType="slide" onRequestClose={closeEdit}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Edit policy</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={closeEdit}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Close without saving"
                accessibilityState={{ disabled: saving }}
              >
                <Ionicons name="close" size={26} color={color.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                editable={!saving}
                maxLength={200}
                accessibilityLabel="Policy title"
              />
              <Text style={styles.label}>Policy text</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={content}
                onChangeText={setContent}
                editable={!saving}
                multiline
                textAlignVertical="top"
                accessibilityLabel="Policy text"
              />
              {formError && <Text style={styles.error}>{formError}</Text>}
              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.btnDisabled]}
                onPress={save}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="Save policy"
                accessibilityState={{ disabled: saving }}
              >
                {saving ? <ActivityIndicator color={color.white} /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  listPad: { padding: spacing.lg },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    padding: spacing.lg,
  },
  headerText: { flex: 1, marginRight: spacing.sm },
  section: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textMuted,
    textTransform: 'uppercase',
  },
  title: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginTop: 2 },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: color.borderLight,
  },
  content: { fontSize: font.body, color: color.textPrimary, lineHeight: 21, marginTop: spacing.md },
  meta: { fontSize: font.caption, color: color.textMuted, marginTop: spacing.md },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.primary,
  },
  editText: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.primary },
  overlay: { flex: 1, backgroundColor: color.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.cardBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '90%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  sheetTitle: { flex: 1, fontSize: font.title, fontWeight: fontWeight.bold, color: color.textPrimary },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetBody: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    minHeight: 48,
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.body,
    color: color.textPrimary,
  },
  multiline: { minHeight: 180 },
  error: { color: color.error, fontSize: font.body, marginTop: spacing.md },
  saveBtn: {
    minHeight: 48,
    marginTop: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  saveText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.subtitle },
});
