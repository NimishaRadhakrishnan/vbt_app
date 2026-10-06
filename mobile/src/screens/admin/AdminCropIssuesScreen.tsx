import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../../services/api';
import { showSubmitResult } from '../../utils/offlineAlert';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../../components/FetchStates';
import { asList } from '../../utils/lists';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Fields below match CropIssueResponse in
// backend/app/presentation/schemas/crop_issue_schemas.py exactly.
type CropIssue = {
  id: string;
  user_id: string;
  farmer_id: string;
  crop: string;
  district: string;
  symptoms: string;
  assigned_expert_whatsapp: string;
  image_url?: string | null;
  voice_notes_url?: string | null;
  status: string;
  expert_reply?: string | null;
  created_at: string;
  updated_at: string;
};

// Only the two FarmerResponse fields this screen reads.
type FarmerLite = { id: string; name: string };

type Filter = 'pending' | 'resolved';

// Same key the API client persists the login under. Uploaded photos are
// served by GET /files/{name}?token=... (file_router.py), which accepts
// only a query-string token, so the photo component has to read it.
const SESSION_STORAGE_KEY = 'ffm_session_v1';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Backend timestamps can arrive without a zone suffix; they are UTC.
function formatIst(iso?: string | null): string {
  if (!iso) return '';
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  const parsed = new Date(hasZone ? iso : `${iso}Z`);
  if (isNaN(parsed.getTime())) return '';
  const ist = new Date(parsed.getTime() + IST_OFFSET_MS);
  const hours24 = ist.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0');
  const suffix = hours24 >= 12 ? 'pm' : 'am';
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}, ${hours12}:${minutes} ${suffix} IST`;
}

function isResolved(issue: CropIssue): boolean {
  return issue.status === 'resolved';
}

function IssuePhoto({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    AsyncStorage.getItem(SESSION_STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        const token: string | undefined = raw ? JSON.parse(raw)?.token : undefined;
        if (!token) {
          setFailed(true);
          return;
        }
        const separator = url.includes('?') ? '&' : '?';
        setSrc(`${url}${separator}token=${encodeURIComponent(token)}`);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) {
    return (
      <View style={styles.photoFallback} accessible accessibilityLabel="The photo could not be loaded">
        <Ionicons name="image-outline" size={28} color={color.textMuted} />
        <Text style={styles.photoFallbackText}>The photo could not be loaded.</Text>
      </View>
    );
  }
  if (!src) {
    return (
      <View style={styles.photoFallback}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: src }}
      style={styles.photo}
      resizeMode="cover"
      accessibilityLabel="Photo of the affected crop"
      onError={() => setFailed(true)}
    />
  );
}

// GET /issues/ (admin and manager see every officer's reports server-side),
// POST /issues/{id}/resolve with { expert_reply } - the same calls the web
// dashboard makes. Only admin and manager may resolve (403 otherwise).
export default function AdminCropIssuesScreen() {
  const role = apiClient.getCurrentUser()?.role;
  const canReview = role === 'admin' || role === 'manager';

  const [filter, setFilter] = useState<Filter>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<CropIssue[]>(
    () => apiClient.request('/issues/?limit=200', 'GET', 'admin_action').then((d) => asList<CropIssue>(d)),
    []
  );

  // Farmer names are a convenience: a failure here must not block review.
  const { data: farmers } = useDataFetch<FarmerLite[]>(
    () =>
      apiClient
        .request('/farmers/search?limit=200', 'GET', 'admin_action')
        .then((d) => asList<FarmerLite>(d))
        .catch(() => [] as FarmerLite[]),
    []
  );

  const farmerNames = useMemo(() => {
    const map = new Map<string, string>();
    (farmers ?? []).forEach((f) => map.set(f.id, f.name));
    return map;
  }, [farmers]);

  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)),
    [data]
  );
  const pendingCount = sorted.filter((i) => !isResolved(i)).length;
  const resolvedCount = sorted.length - pendingCount;
  const visible = sorted.filter((i) => (filter === 'resolved' ? isResolved(i) : !isResolved(i)));
  const selected = selectedId ? sorted.find((i) => i.id === selectedId) ?? null : null;

  const closeDetail = useCallback(() => {
    setSelectedId(null);
    setReply('');
    setReplyError(null);
  }, []);

  // Android back button returns to the list instead of leaving the screen.
  useEffect(() => {
    if (!selectedId) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (submitting) return true;
      closeDetail();
      return true;
    });
    return () => sub.remove();
  }, [selectedId, submitting, closeDetail]);

  const farmerLabel = (issue: CropIssue) => farmerNames.get(issue.farmer_id) ?? 'Registered farmer';

  const openIssue = (issue: CropIssue) => {
    setReply('');
    setReplyError(null);
    setSelectedId(issue.id);
  };

  const submitSolution = async (issue: CropIssue) => {
    if (submittingRef.current) return;
    const text = reply.trim();
    if (!text) {
      setReplyError('Please write the solution before sending.');
      return;
    }
    setReplyError(null);
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await apiClient.request(`/issues/${issue.id}/resolve`, 'POST', 'admin_action', {
        expert_reply: text,
      });
      showSubmitResult(res, 'Solution Sent', 'The officer has been told. The issue is now resolved.');
      closeDetail();
      if (!res?.offline) refresh();
    } catch (err: any) {
      Alert.alert('Could Not Send Solution', err?.message ?? 'Please try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (!canReview) {
    return (
      <View style={styles.container}>
        <EmptyState message="Only administrators and managers can review crop issues." />
      </View>
    );
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  if (selected) {
    const resolved = isResolved(selected);
    const photoUrl = selected.image_url && /^https?:\/\//.test(selected.image_url) ? selected.image_url : null;
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity
          style={styles.backRow}
          onPress={closeDetail}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Back to crop issues list"
        >
          <Ionicons name="arrow-back" size={22} color={color.primary} />
          <Text style={styles.backText}>All crop issues</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cropTitle}>{selected.crop}</Text>
              <View style={[styles.badge, resolved ? styles.badgeResolved : styles.badgePending]}>
                <Text style={[styles.badgeText, resolved ? styles.badgeTextResolved : styles.badgeTextPending]}>
                  {resolved ? 'Resolved' : 'Pending'}
                </Text>
              </View>
            </View>
            <Text style={styles.meta}>Farmer: {farmerLabel(selected)}</Text>
            <Text style={styles.meta}>District: {selected.district}</Text>
            <Text style={styles.meta}>Reported: {formatIst(selected.created_at)}</Text>

            <Text style={styles.sectionLabel}>Problem</Text>
            <Text style={styles.bodyText}>{selected.symptoms}</Text>

            {photoUrl && (
              <>
                <Text style={styles.sectionLabel}>Photo</Text>
                <IssuePhoto url={photoUrl} />
              </>
            )}
          </View>

          {resolved ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabelFirst}>Solution given</Text>
              <Text style={styles.bodyText}>{selected.expert_reply || 'No solution text was recorded.'}</Text>
              <Text style={styles.meta}>Updated: {formatIst(selected.updated_at)}</Text>
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.sectionLabelFirst}>Your solution</Text>
              <TextInput
                style={[styles.input, replyError ? styles.inputError : null]}
                placeholder="Write what the farmer should do, for example the product and the amount to use"
                placeholderTextColor={color.textMuted}
                multiline
                value={reply}
                onChangeText={(t) => {
                  setReply(t);
                  if (replyError) setReplyError(null);
                }}
                editable={!submitting}
                accessibilityLabel="Solution for this crop issue"
              />
              {replyError && (
                <Text style={styles.errorText} accessibilityLiveRegion="polite">
                  {replyError}
                </Text>
              )}
              <TouchableOpacity
                style={[styles.primaryBtn, submitting && styles.btnDisabled]}
                onPress={() => submitSolution(selected)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Send solution and mark this issue resolved"
                accessibilityState={{ disabled: submitting, busy: submitting }}
              >
                {submitting ? (
                  <ActivityIndicator color={color.white} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={20} color={color.white} />
                    <Text style={styles.primaryBtnText}>Send solution</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['pending', 'resolved'] as const).map((f) => {
          const active = filter === f;
          const label = f === 'pending' ? `Pending (${pendingCount})` : `Resolved (${resolvedCount})`;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setFilter(f)}
              accessibilityRole="tab"
              accessibilityLabel={`Show ${f} crop issues`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isStale && <StaleDataBanner onRetry={refresh} />}

      {visible.length === 0 ? (
        <EmptyState
          message={filter === 'pending' ? 'No crop issues are waiting for a solution.' : 'No crop issues have been resolved yet.'}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={refresh}
          renderItem={({ item }) => {
            const resolved = isResolved(item);
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => openIssue(item)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.crop} issue for ${farmerLabel(item)}, ${resolved ? 'resolved' : 'pending'}`}
              >
                <View style={styles.rowBetween}>
                  <Text style={styles.cropTitle} numberOfLines={1}>
                    {item.crop}
                  </Text>
                  <View style={[styles.badge, resolved ? styles.badgeResolved : styles.badgePending]}>
                    <Text style={[styles.badgeText, resolved ? styles.badgeTextResolved : styles.badgeTextPending]}>
                      {resolved ? 'Resolved' : 'Pending'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {farmerLabel(item)} - {item.district}
                </Text>
                <Text style={styles.bodyText} numberOfLines={2}>
                  {item.symptoms}
                </Text>
                <View style={styles.rowBetween}>
                  <Text style={styles.meta}>{formatIst(item.created_at)}</Text>
                  <Ionicons name="chevron-forward" size={20} color={color.textMuted} />
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  tabs: {
    flexDirection: 'row',
    backgroundColor: color.cardBg,
    margin: spacing.lg,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
  },
  tab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary },
  tabTextActive: { color: color.white },
  listContent: { padding: spacing.lg, paddingTop: spacing.sm },
  detailContent: { padding: spacing.lg, paddingTop: spacing.sm },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  backText: { marginLeft: spacing.sm, fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.primary },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cropTitle: {
    flex: 1,
    marginRight: spacing.sm,
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  bodyText: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.sm, marginBottom: spacing.xs },
  sectionLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
  },
  sectionLabelFirst: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
    textTransform: 'uppercase',
  },
  badge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgePending: { backgroundColor: color.warningBg, borderColor: color.warningBorder },
  badgeResolved: { backgroundColor: color.cardBg, borderColor: color.success },
  badgeText: { fontSize: font.caption, fontWeight: fontWeight.bold },
  badgeTextPending: { color: color.warningText },
  badgeTextResolved: { color: color.success },
  photo: {
    width: '100%',
    height: 220,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    backgroundColor: color.borderLight,
  },
  photoFallback: {
    height: 120,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    backgroundColor: color.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFallbackText: { fontSize: font.caption, color: color.textMuted, marginTop: spacing.xs },
  input: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.subtitle,
    color: color.textPrimary,
    minHeight: 120,
    textAlignVertical: 'top',
    marginTop: spacing.sm,
  },
  inputError: { borderColor: color.error },
  errorText: { fontSize: font.caption, color: color.error, marginTop: spacing.xs },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: spacing.lg,
    backgroundColor: color.primary,
    borderRadius: radius.sm,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: {
    marginLeft: spacing.sm,
    color: color.white,
    fontWeight: fontWeight.bold,
    fontSize: font.subtitle,
  },
});
