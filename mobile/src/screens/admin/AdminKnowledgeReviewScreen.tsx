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
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Admin review of the knowledge base (the same queues as the web console):
//   GET /admin/knowledge/cases?verification_status=...   review queue
//   PUT /admin/knowledge/cases/{id}/verify   body {} (solution_id is optional)
//   PUT /admin/knowledge/cases/{id}/reject   body { reason }  (reason required)
//   GET /admin/knowledge/unanswered          searches that found nothing
//   PUT /admin/knowledge/unanswered/{id}/resolve   body {} (case_id optional)
// Synonyms and solution versions are managed on the web only.

type KnowledgeCase = {
  id: string;
  case_number: number;
  question: string;
  crop_name: string | null;
  disease_name: string | null;
  crop_text: string | null;
  disease_text: string | null;
  symptoms: string | null;
  solution_used: string | null;
  notes: string | null;
  district: string | null;
  verification_status: string;
  rejection_reason: string | null;
  created_at: string;
  officer_name: string | null;
  images: { id: string }[];
};

type Unanswered = {
  id: string;
  normalized_query: string;
  sample_query: string;
  search_count: number;
  last_searched_at: string;
};

type CaseFilter = 'pending_review' | 'verified' | 'rejected';

const FILTERS: { id: CaseFilter; label: string; empty: string }[] = [
  { id: 'pending_review', label: 'Pending', empty: 'No cases are waiting for review.' },
  { id: 'verified', label: 'Approved', empty: 'No approved cases yet.' },
  { id: 'rejected', label: 'Rejected', empty: 'No rejected cases.' },
];

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  // Python sends microseconds; trim to milliseconds so every JS engine parses it.
  const trimmed = iso.replace(/(\.\d{3})\d+/, '$1');
  const d = new Date(hasZone ? trimmed : `${trimmed}Z`);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function offlineNotice() {
  Alert.alert('Saved on Your Phone', "Will send when you're back online. The list updates after that.");
}

export default function AdminKnowledgeReviewScreen() {
  const [tab, setTab] = useState<'cases' | 'unanswered'>('cases');

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {([
          { id: 'cases', label: 'Cases' },
          { id: 'unanswered', label: 'Unanswered searches' },
        ] as const).map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.tab, tab === t.id && styles.tabActive]}
            onPress={() => setTab(t.id)}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: tab === t.id }}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'cases' ? <CasesTab /> : <UnansweredTab />}
    </View>
  );
}

function CasesTab() {
  const [filter, setFilter] = useState<CaseFilter>('pending_review');
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<KnowledgeCase | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<KnowledgeCase[]>(
    () => apiClient.request(`/admin/knowledge/cases?verification_status=${filter}`, 'GET', 'admin_action'),
    [filter],
  );

  const approve = (item: KnowledgeCase) => {
    if (actingId) return;
    Alert.alert(
      'Approve this case?',
      `Case #${String(item.case_number).padStart(5, '0')} will be marked approved and can appear in search results for all officers.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setActingId(item.id);
            try {
              const res = await apiClient.request(`/admin/knowledge/cases/${item.id}/verify`, 'PUT', 'admin_action', {});
              if (res?.offline) offlineNotice();
              else refresh();
            } catch (err: any) {
              Alert.alert('Could Not Approve', err?.message ?? 'Please try again.');
            } finally {
              setActingId(null);
            }
          },
        },
      ],
    );
  };

  const openReject = (item: KnowledgeCase) => {
    if (actingId) return;
    setRejecting(item);
    setReason('');
    setReasonError(null);
  };

  const submitReject = async () => {
    if (!rejecting || actingId) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError('Please say why this case is being rejected.');
      return;
    }
    setActingId(rejecting.id);
    setReasonError(null);
    try {
      const res = await apiClient.request(
        `/admin/knowledge/cases/${rejecting.id}/reject`,
        'PUT',
        'admin_action',
        { reason: trimmed },
      );
      setRejecting(null);
      if (res?.offline) offlineNotice();
      else refresh();
    } catch (err: any) {
      setReasonError(err?.message ?? 'Could not reject. Please try again.');
    } finally {
      setActingId(null);
    }
  };

  const closeReject = () => {
    if (actingId) return;
    setRejecting(null);
  };

  const current = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;

  return (
    <View style={styles.flex}>
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.id}
            style={[styles.chip, filter === f.id && styles.chipOn]}
            onPress={() => setFilter(f.id)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${f.label} cases`}
            accessibilityState={{ selected: filter === f.id }}
          >
            <Text style={[styles.chipText, filter === f.id && styles.chipTextOn]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !Array.isArray(data) || data.length === 0 ? (
        <EmptyState message={current.empty} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listPad}
          refreshing={refreshing}
          onRefresh={refresh}
          ListHeaderComponent={isStale ? <StaleDataBanner onRetry={retry} /> : null}
          renderItem={({ item }) => {
            const crop = item.crop_name || item.crop_text;
            const disease = item.disease_name || item.disease_text;
            const busy = actingId === item.id;
            const photos = item.images?.length ?? 0;
            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  {`Case #${String(item.case_number).padStart(5, '0')}`}
                  {crop ? ` · ${crop}` : ''}
                </Text>
                <Text style={styles.meta}>
                  {item.officer_name ? `${item.officer_name} · ` : ''}
                  {formatDateTime(item.created_at)}
                  {item.district ? ` · ${item.district}` : ''}
                </Text>
                <Text style={styles.question}>{item.question}</Text>
                {!!disease && <Field label="Disease" value={disease} />}
                {!!item.symptoms && <Field label="Symptoms" value={item.symptoms} />}
                {!!item.solution_used && <Field label="Solution used" value={item.solution_used} />}
                {!!item.notes && <Field label="Notes" value={item.notes} />}
                {photos > 0 && (
                  <Text style={styles.meta}>
                    {photos} {photos === 1 ? 'photo' : 'photos'} attached (view on the web console)
                  </Text>
                )}
                {item.verification_status === 'rejected' && !!item.rejection_reason && (
                  <Text style={styles.rejectNote}>
                    <Text style={styles.bold}>Rejected: </Text>
                    {item.rejection_reason}
                  </Text>
                )}

                {item.verification_status === 'pending_review' && (
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.rejectBtn, !!actingId && styles.btnDisabled]}
                      onPress={() => openReject(item)}
                      disabled={!!actingId}
                      accessibilityRole="button"
                      accessibilityLabel={`Reject case ${item.case_number}`}
                      accessibilityState={{ disabled: !!actingId }}
                    >
                      <Text style={styles.actionText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.approveBtn, !!actingId && styles.btnDisabled]}
                      onPress={() => approve(item)}
                      disabled={!!actingId}
                      accessibilityRole="button"
                      accessibilityLabel={`Approve case ${item.case_number}`}
                      accessibilityState={{ disabled: !!actingId, busy }}
                    >
                      {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Approve</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal visible={rejecting !== null} transparent animationType="slide" onRequestClose={closeReject}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Reject case</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={closeReject}
                disabled={!!actingId}
                accessibilityRole="button"
                accessibilityLabel="Close without rejecting"
                accessibilityState={{ disabled: !!actingId }}
              >
                <Ionicons name="close" size={26} color={color.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Reason (the officer will see this)</Text>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={(v) => {
                  setReason(v);
                  if (reasonError) setReasonError(null);
                }}
                editable={!actingId}
                multiline
                textAlignVertical="top"
                placeholder="For example: photo is unclear, or the advice is not safe"
                placeholderTextColor={color.textMuted}
                accessibilityLabel="Reason for rejecting"
              />
              {reasonError && <Text style={styles.error}>{reasonError}</Text>}
              <TouchableOpacity
                style={[styles.submitBtn, !!actingId && styles.btnDisabled]}
                onPress={submitReject}
                disabled={!!actingId}
                accessibilityRole="button"
                accessibilityLabel="Confirm rejection"
                accessibilityState={{ disabled: !!actingId }}
              >
                {actingId ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Reject case</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function UnansweredTab() {
  const [actingId, setActingId] = useState<string | null>(null);
  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<Unanswered[]>(
    () => apiClient.request('/admin/knowledge/unanswered', 'GET', 'admin_action'),
    [],
  );

  const resolve = (item: Unanswered) => {
    if (actingId) return;
    Alert.alert(
      'Mark as answered?',
      `Remove "${item.sample_query}" from this list. Do this once a case that answers it has been added.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark answered',
          onPress: async () => {
            setActingId(item.id);
            try {
              const res = await apiClient.request(
                `/admin/knowledge/unanswered/${item.id}/resolve`,
                'PUT',
                'admin_action',
                {},
              );
              if (res?.offline) offlineNotice();
              else refresh();
            } catch (err: any) {
              Alert.alert('Could Not Update', err?.message ?? 'Please try again.');
            } finally {
              setActingId(null);
            }
          },
        },
      ],
    );
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!Array.isArray(data) || data.length === 0) {
    return <EmptyState message="No unanswered searches. Officers are finding what they look for." />;
  }

  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listPad}
      refreshing={refreshing}
      onRefresh={refresh}
      ListHeaderComponent={isStale ? <StaleDataBanner onRetry={retry} /> : null}
      renderItem={({ item }) => {
        const busy = actingId === item.id;
        return (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.sample_query}</Text>
            <Text style={styles.meta}>
              Searched {item.search_count} {item.search_count === 1 ? 'time' : 'times'} · last {formatDateTime(item.last_searched_at)}
            </Text>
            <TouchableOpacity
              style={[styles.resolveBtn, !!actingId && styles.btnDisabled]}
              onPress={() => resolve(item)}
              disabled={!!actingId}
              accessibilityRole="button"
              accessibilityLabel={`Mark ${item.sample_query} as answered`}
              accessibilityState={{ disabled: !!actingId, busy }}
            >
              {busy ? (
                <ActivityIndicator color={color.primary} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={color.primary} />
                  <Text style={styles.resolveText}> Mark answered</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        );
      }}
    />
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Text style={styles.field}>
      <Text style={styles.bold}>{label}: </Text>
      {value}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  flex: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: color.cardBg,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
  },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary, textAlign: 'center' },
  tabTextActive: { color: color.white },
  filterRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
    marginRight: spacing.sm,
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: font.body, color: color.textPrimary },
  chipTextOn: { color: color.white, fontWeight: fontWeight.semibold },
  listPad: { padding: spacing.lg, paddingTop: spacing.sm },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textMuted, marginTop: 2 },
  question: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.sm },
  field: { fontSize: font.body, color: color.textSecondary, marginTop: spacing.xs },
  bold: { fontWeight: fontWeight.bold },
  rejectNote: { fontSize: font.body, color: color.errorText, marginTop: spacing.sm },
  actions: { flexDirection: 'row', marginTop: spacing.lg },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  rejectBtn: { backgroundColor: color.error },
  approveBtn: { backgroundColor: color.success, marginRight: 0 },
  actionText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
  btnDisabled: { opacity: 0.5 },
  resolveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.primary,
  },
  resolveText: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.primary },
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
  label: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary, marginBottom: spacing.sm },
  input: {
    minHeight: 120,
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.body,
    color: color.textPrimary,
  },
  error: { color: color.error, fontSize: font.body, marginTop: spacing.md },
  submitBtn: {
    minHeight: 48,
    marginTop: spacing.lg,
    borderRadius: radius.sm,
    backgroundColor: color.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
