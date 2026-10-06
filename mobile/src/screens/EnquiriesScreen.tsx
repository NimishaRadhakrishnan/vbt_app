import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { useDataFetch } from '../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState, StaleDataBanner } from '../components/FetchStates';
import { asList } from '../utils/lists';
import { color, font, fontWeight, spacing, radius } from '../theme';

// Fields match EnquiryResponse in
// backend/app/presentation/schemas/enquiry_schemas.py exactly.
type Enquiry = {
  id: string;
  reported_by: string;
  reported_by_name: string;
  district?: string | null;
  description: string;
  image_url?: string | null;
  status: string;
  solution?: string | null;
  resolved_by?: string | null;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
};

type Filter = 'open' | 'resolved';

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

function EnquiryPhoto({ url }: { url: string }) {
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
      accessibilityLabel="Photo attached to this enquiry"
      onError={() => setFailed(true)}
    />
  );
}

// Farmer enquiries carry no farmer record on purpose (the farmer chose not
// to share name, phone or address): the request is only
// { district?, description, image_url? }. Any officer logs one with
// POST /enquiries and sees only their own through GET /enquiries; admin and
// manager see all and resolve with POST /enquiries/{id}/resolve
// { solution }. The photo goes up first through POST /enquiries/upload.
export default function EnquiriesScreen({
  embedded,
  onDone,
}: {
  embedded?: boolean;
  onDone?: () => void;
}) {
  const role = apiClient.getCurrentUser()?.role;
  const isReviewer = role === 'admin' || role === 'manager';
  // The web dashboard hides Farmer Enquiry from sales officers; match it.
  const canSee = isReviewer || role === 'field_officer';
  const canCreate = role === 'field_officer';

  const [filter, setFilter] = useState<Filter>('open');

  // Create form
  const [district, setDistrict] = useState('');
  const [description, setDescription] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Resolve form (one open at a time)
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [solution, setSolution] = useState('');
  const [solutionError, setSolutionError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Refs close the gap between a tap and the re-render that disables the button.
  const creatingRef = useRef(false);
  const resolvingRef = useRef(false);

  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<Enquiry[]>(
    () => apiClient.request('/enquiries', 'GET', 'admin_action').then((d) => asList<Enquiry>(d)),
    []
  );

  const sorted = useMemo(
    () => [...(data ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)),
    [data]
  );
  const openCount = sorted.filter((e) => e.status === 'open').length;
  const resolvedCount = sorted.filter((e) => e.status === 'resolved').length;
  const visible = sorted.filter((e) => e.status === filter);

  const pickPhoto = async (source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Camera Needed', 'Allow camera access in your phone settings to take a photo.');
          return;
        }
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.5 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.5,
            });
      if (result.canceled || !result.assets?.[0]) return;
      setPhotoUri(result.assets[0].uri);
      setFormError(null);
    } catch (err: any) {
      Alert.alert('Could Not Open Photos', err?.message ?? 'Please try again.');
    }
  };

  const submitEnquiry = async () => {
    if (creatingRef.current) return;
    const text = description.trim();
    if (!text) {
      setFormError('Please describe what the farmer is facing.');
      return;
    }
    if (photoUri && !apiClient.getOnlineStatus()) {
      setFormError('Photos can only be sent when you are online. Remove the photo to save this on your phone, or connect and try again.');
      return;
    }
    setFormError(null);
    creatingRef.current = true;
    setCreating(true);
    try {
      let imageUrl: string | undefined;
      if (photoUri) {
        imageUrl = await apiClient.uploadFile('/enquiries/upload', photoUri, `enquiry-${Date.now()}.jpg`, 'image/jpeg');
      }
      const body: { description: string; district?: string; image_url?: string } = { description: text };
      const trimmedDistrict = district.trim();
      if (trimmedDistrict) body.district = trimmedDistrict;
      if (imageUrl) body.image_url = imageUrl;

      const res = await apiClient.request('/enquiries', 'POST', 'crop_issue', body);
      showSubmitResult(res, 'Enquiry Saved', 'The enquiry was sent. An officer will follow up with a solution.');
      setDistrict('');
      setDescription('');
      setPhotoUri(null);
      if (!res?.offline) refresh();
      if (embedded) onDone?.();
    } catch (err: any) {
      Alert.alert('Could Not Save Enquiry', err?.message ?? 'Please try again.');
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  const startResolve = (id: string) => {
    setResolvingId(id);
    setSolution('');
    setSolutionError(null);
  };

  const cancelResolve = () => {
    setResolvingId(null);
    setSolution('');
    setSolutionError(null);
  };

  const submitResolve = async (item: Enquiry) => {
    if (resolvingRef.current) return;
    const text = solution.trim();
    if (!text) {
      setSolutionError('Please write a solution before resolving.');
      return;
    }
    setSolutionError(null);
    resolvingRef.current = true;
    setResolving(true);
    try {
      const res = await apiClient.request(`/enquiries/${item.id}/resolve`, 'POST', 'admin_action', { solution: text });
      showSubmitResult(res, 'Enquiry Resolved', 'The solution has been recorded.');
      cancelResolve();
      if (!res?.offline) refresh();
    } catch (err: any) {
      Alert.alert('Could Not Resolve', err?.message ?? 'Please try again.');
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  };

  if (!canSee) {
    return (
      <View style={styles.container}>
        <EmptyState message="Farmer enquiries are not available for your role." />
      </View>
    );
  }

  const busy = creating || resolving;

  const header = (
    <View>
      {canCreate && (
        <View style={styles.card}>
          <Text style={styles.formTitle}>Log a farmer enquiry</Text>
          <Text style={styles.meta}>
            For farmers who prefer not to share their name, phone or address. Describe the problem and add a photo if you can.
          </Text>

          <Text style={styles.fieldLabel}>District (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="For example Salem"
            placeholderTextColor={color.textMuted}
            value={district}
            onChangeText={setDistrict}
            editable={!creating}
            accessibilityLabel="District, optional"
          />

          <Text style={styles.fieldLabel}>What is the problem</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline, formError ? styles.inputError : null]}
            placeholder="Crop, what the farmer is seeing, anything they mentioned"
            placeholderTextColor={color.textMuted}
            multiline
            value={description}
            onChangeText={(t) => {
              setDescription(t);
              if (formError) setFormError(null);
            }}
            editable={!creating}
            accessibilityLabel="Describe the problem"
          />

          <Text style={styles.fieldLabel}>Photo (optional)</Text>
          {photoUri && <Image source={{ uri: photoUri }} style={styles.photoPreview} accessibilityLabel="Photo chosen for this enquiry" />}
          <View style={styles.photoButtons}>
            <TouchableOpacity
              style={[styles.secondaryBtn, styles.photoBtnLeft, creating && styles.btnDisabled]}
              onPress={() => pickPhoto('camera')}
              disabled={creating}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
              accessibilityState={{ disabled: creating }}
            >
              <Ionicons name="camera-outline" size={20} color={color.primary} />
              <Text style={styles.secondaryBtnText}>Take photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, creating && styles.btnDisabled]}
              onPress={() => pickPhoto('library')}
              disabled={creating}
              accessibilityRole="button"
              accessibilityLabel="Choose a photo from the gallery"
              accessibilityState={{ disabled: creating }}
            >
              <Ionicons name="images-outline" size={20} color={color.primary} />
              <Text style={styles.secondaryBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>
          {photoUri && (
            <TouchableOpacity
              style={[styles.linkBtn, creating && styles.btnDisabled]}
              onPress={() => setPhotoUri(null)}
              disabled={creating}
              accessibilityRole="button"
              accessibilityLabel="Remove the chosen photo"
            >
              <Ionicons name="close-circle-outline" size={18} color={color.error} />
              <Text style={styles.removeText}>Remove photo</Text>
            </TouchableOpacity>
          )}

          {formError && (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            onPress={submitEnquiry}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Log this enquiry"
            accessibilityState={{ disabled: busy, busy: creating }}
          >
            {creating ? (
              <ActivityIndicator color={color.white} />
            ) : (
              <>
                <Ionicons name="send-outline" size={18} color={color.white} />
                <Text style={styles.primaryBtnText}>Log enquiry</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.listTitle}>{isReviewer ? 'All enquiries' : 'My enquiries'}</Text>
      <View style={styles.tabs}>
        {(['open', 'resolved'] as const).map((f) => {
          const active = filter === f;
          const label = f === 'open' ? `Open (${openCount})` : `Resolved (${resolvedCount})`;
          return (
            <TouchableOpacity
              key={f}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setFilter(f)}
              accessibilityRole="tab"
              accessibilityLabel={`Show ${f} enquiries`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {isStale && <StaleDataBanner onRetry={refresh} />}
    </View>
  );

  let emptyView: React.ReactElement | null = null;
  if (loading) emptyView = <LoadingState />;
  else if (error) emptyView = <ErrorState message={error} onRetry={retry} />;
  else if (visible.length === 0) {
    emptyView = (
      <EmptyState
        message={filter === 'open' ? 'No open enquiries.' : 'No resolved enquiries yet.'}
        actionHint={canCreate && filter === 'open' ? 'Use the form above to log one.' : undefined}
      />
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={loading || error ? [] : visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        refreshing={refreshing}
        onRefresh={refresh}
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={styles.emptyWrap}>{emptyView}</View>}
        extraData={[resolvingId, solution, solutionError, resolving, creating]}
        renderItem={({ item }) => {
          const resolved = item.status === 'resolved';
          const photoUrl = item.image_url && /^https?:\/\//.test(item.image_url) ? item.image_url : null;
          const isResolvingThis = resolvingId === item.id;
          return (
            <View style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={[styles.badge, resolved ? styles.badgeResolved : styles.badgePending]}>
                  <Text style={[styles.badgeText, resolved ? styles.badgeTextResolved : styles.badgeTextPending]}>
                    {resolved ? 'Resolved' : 'Open'}
                  </Text>
                </View>
                <Text style={styles.meta}>{formatIst(item.created_at)}</Text>
              </View>
              {!!item.district && <Text style={styles.meta}>District: {item.district}</Text>}
              <Text style={styles.bodyText}>{item.description}</Text>
              {photoUrl && <EnquiryPhoto url={photoUrl} />}
              <Text style={styles.meta}>Logged by {item.reported_by_name}</Text>

              {resolved ? (
                <View style={styles.solutionBox}>
                  <Text style={styles.solutionLabel}>Solution</Text>
                  <Text style={styles.bodyText}>{item.solution || 'No solution text was recorded.'}</Text>
                  {(!!item.resolved_by_name || !!item.resolved_at) && (
                    <Text style={styles.meta}>
                      {item.resolved_by_name ? `By ${item.resolved_by_name}` : ''}
                      {item.resolved_by_name && item.resolved_at ? ', ' : ''}
                      {formatIst(item.resolved_at)}
                    </Text>
                  )}
                </View>
              ) : (
                isReviewer &&
                (isResolvingThis ? (
                  <View style={styles.resolveBox}>
                    <TextInput
                      style={[styles.input, styles.inputMultiline, solutionError ? styles.inputError : null]}
                      placeholder="Write the solution for this enquiry"
                      placeholderTextColor={color.textMuted}
                      multiline
                      value={solution}
                      onChangeText={(t) => {
                        setSolution(t);
                        if (solutionError) setSolutionError(null);
                      }}
                      editable={!resolving}
                      accessibilityLabel="Solution for this enquiry"
                    />
                    {solutionError && (
                      <Text style={styles.errorText} accessibilityLiveRegion="polite">
                        {solutionError}
                      </Text>
                    )}
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.secondaryBtn, styles.photoBtnLeft, resolving && styles.btnDisabled]}
                        onPress={cancelResolve}
                        disabled={resolving}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel writing a solution"
                      >
                        <Text style={styles.secondaryBtnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.primaryBtnFlex, resolving && styles.btnDisabled]}
                        onPress={() => submitResolve(item)}
                        disabled={resolving}
                        accessibilityRole="button"
                        accessibilityLabel="Send solution and resolve this enquiry"
                        accessibilityState={{ disabled: resolving, busy: resolving }}
                      >
                        {resolving ? (
                          <ActivityIndicator color={color.white} />
                        ) : (
                          <Text style={styles.primaryBtnText}>Resolve</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.primaryBtn, resolving && styles.btnDisabled]}
                    onPress={() => startResolve(item.id)}
                    disabled={resolving}
                    accessibilityRole="button"
                    accessibilityLabel="Write a solution for this enquiry"
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color={color.white} />
                    <Text style={styles.primaryBtnText}>Resolve</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          );
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  listContent: { padding: spacing.lg },
  emptyWrap: { minHeight: 200 },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  formTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginBottom: spacing.xs },
  listTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
    fontSize: font.subtitle,
    color: color.textPrimary,
  },
  inputMultiline: { minHeight: 100, textAlignVertical: 'top' },
  inputError: { borderColor: color.error },
  errorText: { fontSize: font.caption, color: color.error, marginTop: spacing.sm },
  photoPreview: {
    width: 120,
    height: 120,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
    backgroundColor: color.borderLight,
  },
  photoButtons: { flexDirection: 'row' },
  photoBtnLeft: { marginRight: spacing.sm },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.primary,
    backgroundColor: color.cardBg,
  },
  secondaryBtnText: { marginLeft: spacing.sm, color: color.primary, fontWeight: fontWeight.bold, fontSize: font.body },
  linkBtn: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  removeText: { marginLeft: spacing.xs, color: color.error, fontWeight: fontWeight.semibold, fontSize: font.body },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: spacing.lg,
    backgroundColor: color.primary,
    borderRadius: radius.sm,
  },
  primaryBtnFlex: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    backgroundColor: color.primary,
    borderRadius: radius.sm,
  },
  primaryBtnText: { marginLeft: spacing.sm, color: color.white, fontWeight: fontWeight.bold, fontSize: font.subtitle },
  btnDisabled: { opacity: 0.6 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: color.cardBg,
    marginBottom: spacing.md,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
  },
  tab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary },
  tabTextActive: { color: color.white },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  bodyText: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.sm, marginBottom: spacing.xs },
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
    height: 200,
    borderRadius: radius.sm,
    marginVertical: spacing.sm,
    backgroundColor: color.borderLight,
  },
  photoFallback: {
    height: 100,
    borderRadius: radius.sm,
    marginVertical: spacing.sm,
    backgroundColor: color.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFallbackText: { fontSize: font.caption, color: color.textMuted, marginTop: spacing.xs },
  solutionBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.success,
    backgroundColor: color.screenBg,
  },
  solutionLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.success,
    textTransform: 'uppercase',
  },
  resolveBox: { marginTop: spacing.md },
  actions: { flexDirection: 'row', marginTop: spacing.md },
});
