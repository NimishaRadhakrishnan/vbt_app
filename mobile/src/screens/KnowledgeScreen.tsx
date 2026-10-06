import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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

// Knowledge base search for every role. Same endpoints as the web page
// (frontend/app/dashboard/knowledge/page.tsx):
//   POST /knowledge/search            { query, limit }
//   POST /knowledge/search/select     { case_id }   (logs which result was opened)
//   GET  /knowledge/search/history
//   POST /knowledge/cases/{id}/feedback { was_useful, reason }
//   GET  /knowledge/cases/my          (officers: their own submitted cases)
// Search results come back already ranked, with the verified solution
// attached, so opening a result needs no extra request.

type Solution = {
  id: string;
  title: string;
  solution_text: string | null;
  instructions: string | null;
  precautions: string | null;
  version_number: number | null;
};

type SearchResult = {
  case_id: string;
  case_number: number;
  question: string;
  symptoms: string | null;
  crop_name: string | null;
  disease_name: string | null;
  usage_count: number;
  has_verified_solution: boolean;
  relevance_band: string;
  solution?: Solution;
};

type SearchResponse = {
  query: string;
  results: SearchResult[];
  result_count: number;
  low_relevance_only: boolean;
  message: string | null;
};

type HistoryItem = {
  query: string;
  result_count: number;
  top_relevance_band: string | null;
  created_at: string;
};

type MyCase = {
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
};

type Feedback = { useful: boolean; reason: string | null };

// Reasons the backend accepts (knowledge_router.py _FEEDBACK_REASONS).
const FEEDBACK_REASONS: { value: string; label: string }[] = [
  { value: 'not_relevant', label: 'Not relevant' },
  { value: 'incorrect', label: 'Incorrect' },
  { value: 'outdated', label: 'Outdated' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'other', label: 'Other' },
];

// The server sends UTC; a value without a zone marker is still UTC, and
// JavaScript would otherwise read it as phone-local time.
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

// Search and "opened result" are POSTs, but they must never be saved for
// later replay: a replayed search would be logged again and inflate the
// unanswered-search counts, and a replayed "select" would be credited to the
// wrong search. apiClient.request() queues on offline or server errors, so
// these two are sent with queue:false.
function postLive(endpoint: string, body: object): Promise<any> {
  return apiClient.request(endpoint, 'POST', 'admin_action', body, { queue: false });
}

function caseNumber(n: number): string {
  return `Case #${String(n).padStart(5, '0')}`;
}

function statusInfo(status: string): { label: string; icon: 'time-outline' | 'checkmark-circle' | 'close-circle'; tint: string } {
  if (status === 'verified') return { label: 'Approved', icon: 'checkmark-circle', tint: color.success };
  if (status === 'rejected') return { label: 'Not accepted', icon: 'close-circle', tint: color.error };
  return { label: 'Waiting for review', icon: 'time-outline', tint: color.warningText };
}

export default function KnowledgeScreen() {
  const isAdmin = apiClient.getCurrentUser()?.role === 'admin';
  const [tab, setTab] = useState<'search' | 'mine'>('search');

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const searchSeq = useRef(0);
  const openedRef = useRef<Set<string>>(new Set());

  const history = useDataFetch<HistoryItem[]>(
    () => apiClient.request('/knowledge/search/history', 'GET', 'admin_action'),
    [],
    { refetchOnFocus: false },
  );

  const runSearch = async (raw: string) => {
    if (searching) return;
    const q = raw.trim();
    if (!q) {
      setSearchError('Type a crop, disease or symptom to search.');
      return;
    }
    // Search is a POST, which the app would otherwise save for later while
    // offline - useless here, so say so up front instead.
    if (!apiClient.getOnlineStatus()) {
      setSearchError('You are offline. Connect to the internet to search.');
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    setSearchError(null);
    try {
      const res: SearchResponse = await postLive('/knowledge/search', {
        query: q,
        limit: 20,
      });
      if (seq !== searchSeq.current) return;
      openedRef.current = new Set();
      setResponse({ ...res, results: Array.isArray(res?.results) ? res.results : [] });
      history.refresh();
    } catch (err: any) {
      if (seq !== searchSeq.current) return;
      setSearchError(err?.message ?? 'Search did not work. Please try again.');
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  const openResult = (r: SearchResult) => {
    setSelected(r);
    // Records which result was opened (the web does the same). Never
    // blocks reading the answer, so failures are ignored.
    if (apiClient.getOnlineStatus() && !openedRef.current.has(r.case_id)) {
      openedRef.current.add(r.case_id);
      postLive('/knowledge/search/select', { case_id: r.case_id }).catch(() => {});
    }
  };

  const sendFeedback = async (caseId: string, useful: boolean, reason: string | null) => {
    if (sendingFeedback) return;
    setSendingFeedback(true);
    try {
      const res = await apiClient.request(`/knowledge/cases/${caseId}/feedback`, 'POST', 'admin_action', {
        was_useful: useful,
        reason: useful ? null : reason,
      });
      setFeedback((prev) => ({ ...prev, [caseId]: { useful, reason: useful ? null : reason } }));
      if (res?.offline) {
        Alert.alert('Saved on Your Phone', "Will send when you're back online.");
      }
    } catch (err: any) {
      Alert.alert('Could Not Send', err?.message ?? 'Please try again.');
    } finally {
      setSendingFeedback(false);
    }
  };

  const historyItems = Array.isArray(history.data) ? history.data : [];

  return (
    <View style={styles.container}>
      {!isAdmin && (
        <View style={styles.tabs}>
          {([
            { id: 'search', label: 'Search' },
            { id: 'mine', label: 'My Cases' },
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
      )}

      {tab === 'mine' && !isAdmin ? (
        <MyCasesTab />
      ) : (
        <View style={styles.flex}>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={(v) => {
                setQuery(v);
                if (searchError) setSearchError(null);
              }}
              placeholder="Crop, disease or symptom"
              placeholderTextColor={color.textMuted}
              returnKeyType="search"
              onSubmitEditing={() => runSearch(query)}
              editable={!searching}
              maxLength={200}
              accessibilityLabel="Search the knowledge base"
            />
            <TouchableOpacity
              style={[styles.searchBtn, searching && styles.btnDisabled]}
              onPress={() => runSearch(query)}
              disabled={searching}
              accessibilityRole="button"
              accessibilityLabel="Search"
              accessibilityState={{ disabled: searching }}
            >
              {searching ? (
                <ActivityIndicator color={color.white} />
              ) : (
                <Ionicons name="search" size={22} color={color.white} />
              )}
            </TouchableOpacity>
          </View>

          {searchError && <Text style={styles.inlineError}>{searchError}</Text>}

          {response ? (
            response.results.length === 0 ? (
              <EmptyState
                message={response.message ?? 'No verified solution was found.'}
                actionHint="Try a different word, such as the crop name."
              />
            ) : (
              <FlatList
                data={response.results}
                keyExtractor={(item) => item.case_id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.listPad}
                ListHeaderComponent={
                  response.message ? (
                    <View style={styles.noticeBox}>
                      <Text style={styles.noticeText}>{response.message}</Text>
                    </View>
                  ) : null
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.card}
                    onPress={() => openResult(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.disease_name || item.crop_name || 'Previous case'}, ${item.relevance_band} match. Open details`}
                  >
                    <View style={styles.cardTop}>
                      <Text style={[styles.cardTitle, styles.flex]}>
                        {item.disease_name || item.crop_name || 'Previous case'}
                      </Text>
                      <Ionicons name="chevron-forward" size={20} color={color.textMuted} />
                    </View>
                    <Text style={styles.question} numberOfLines={3}>{item.question}</Text>
                    <View style={styles.badgeRow}>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.relevance_band} match</Text>
                      </View>
                      {item.has_verified_solution && (
                        <View style={[styles.badge, styles.badgeGood]}>
                          <Ionicons name="checkmark-circle" size={14} color={color.success} />
                          <Text style={[styles.badgeText, { color: color.success }]}> Verified solution</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                )}
              />
            )
          ) : (
            <ScrollView contentContainerStyle={styles.listPad} keyboardShouldPersistTaps="handled">
              <Text style={styles.intro}>
                Search verified crop problems and their solutions. Results show the best match first.
              </Text>
              {history.isStale && <StaleDataBanner onRetry={history.retry} />}
              {historyItems.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>Recent searches</Text>
                  {historyItems.map((h, i) => (
                    <TouchableOpacity
                      key={`${h.created_at}-${i}`}
                      style={styles.historyRow}
                      onPress={() => {
                        setQuery(h.query);
                        runSearch(h.query);
                      }}
                      disabled={searching}
                      accessibilityRole="button"
                      accessibilityLabel={`Search again for ${h.query}`}
                      accessibilityState={{ disabled: searching }}
                    >
                      <Ionicons name="time-outline" size={20} color={color.textMuted} />
                      <View style={styles.historyText}>
                        <Text style={styles.historyQuery} numberOfLines={1}>{h.query}</Text>
                        <Text style={styles.meta}>
                          {h.result_count} {h.result_count === 1 ? 'result' : 'results'} · {formatDateTime(h.created_at)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </ScrollView>
          )}
        </View>
      )}

      <CaseDetailModal
        item={selected}
        feedback={selected ? feedback[selected.case_id] : undefined}
        sending={sendingFeedback}
        onSend={sendFeedback}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

function CaseDetailModal({
  item,
  feedback,
  sending,
  onSend,
  onClose,
}: {
  item: SearchResult | null;
  feedback: Feedback | undefined;
  sending: boolean;
  onSend: (caseId: string, useful: boolean, reason: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={item !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {item && (
            <>
              <View style={styles.sheetHeader}>
                <View style={styles.flex}>
                  <Text style={styles.sheetTitle}>{item.disease_name || item.crop_name || 'Previous case'}</Text>
                  <Text style={styles.meta}>
                    {caseNumber(item.case_number)}
                    {item.usage_count > 0
                      ? ` · used ${item.usage_count} ${item.usage_count === 1 ? 'time' : 'times'}`
                      : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close details"
                >
                  <Ionicons name="close" size={26} color={color.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.sheetBody}>
                <Text style={styles.fieldLabel}>Crop</Text>
                <Text style={styles.fieldValue}>{item.crop_name || 'Not recorded'}</Text>

                <Text style={styles.fieldLabel}>Problem</Text>
                <Text style={styles.fieldValue}>{item.question}</Text>
                {!!item.symptoms && (
                  <>
                    <Text style={styles.fieldLabel}>Symptoms</Text>
                    <Text style={styles.fieldValue}>{item.symptoms}</Text>
                  </>
                )}

                <Text style={styles.fieldLabel}>
                  Solution{item.solution?.version_number ? ` (version ${item.solution.version_number})` : ''}
                </Text>
                {item.solution && item.solution.solution_text ? (
                  <View style={styles.solutionBox}>
                    {!!item.solution.title && <Text style={styles.solutionTitle}>{item.solution.title}</Text>}
                    <Text style={styles.fieldValue}>{item.solution.solution_text}</Text>
                    {!!item.solution.instructions && (
                      <Text style={[styles.fieldValue, styles.solutionExtra]}>
                        <Text style={styles.bold}>How to apply: </Text>
                        {item.solution.instructions}
                      </Text>
                    )}
                    {!!item.solution.precautions && (
                      <Text style={[styles.fieldValue, styles.solutionExtra, { color: color.warningText }]}>
                        <Text style={styles.bold}>Precautions: </Text>
                        {item.solution.precautions}
                      </Text>
                    )}
                  </View>
                ) : (
                  <Text style={styles.fieldValue}>
                    This case has no verified solution yet. Treat it as a related case, not an answer.
                  </Text>
                )}

                {item.solution && (
                  <View style={styles.feedbackBox}>
                    <Text style={styles.fieldLabel}>Was this useful?</Text>
                    <View style={styles.feedbackRow}>
                      <TouchableOpacity
                        style={[
                          styles.feedbackBtn,
                          feedback?.useful === true && styles.feedbackBtnYes,
                          sending && styles.btnDisabled,
                        ]}
                        onPress={() => onSend(item.case_id, true, null)}
                        disabled={sending}
                        accessibilityRole="button"
                        accessibilityLabel="Helpful"
                        accessibilityState={{ selected: feedback?.useful === true, disabled: sending }}
                      >
                        <Ionicons
                          name="thumbs-up-outline"
                          size={20}
                          color={feedback?.useful === true ? color.white : color.success}
                        />
                        <Text style={[styles.feedbackText, feedback?.useful === true && styles.feedbackTextOn]}> Helpful</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.feedbackBtn,
                          feedback?.useful === false && styles.feedbackBtnNo,
                          sending && styles.btnDisabled,
                        ]}
                        onPress={() => onSend(item.case_id, false, null)}
                        disabled={sending}
                        accessibilityRole="button"
                        accessibilityLabel="Not helpful"
                        accessibilityState={{ selected: feedback?.useful === false, disabled: sending }}
                      >
                        <Ionicons
                          name="thumbs-down-outline"
                          size={20}
                          color={feedback?.useful === false ? color.white : color.error}
                        />
                        <Text style={[styles.feedbackText, feedback?.useful === false && styles.feedbackTextOn]}> Not helpful</Text>
                      </TouchableOpacity>
                    </View>
                    {feedback && (
                      <Text style={styles.meta}>
                        {feedback.useful
                          ? 'Thanks. Marked as helpful.'
                          : 'Thanks. Marked as not helpful.'}
                      </Text>
                    )}
                    {feedback?.useful === false && (
                      <>
                        <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>What was wrong? (optional)</Text>
                        <View style={styles.chipRow}>
                          {FEEDBACK_REASONS.map((r) => {
                            const on = feedback.reason === r.value;
                            return (
                              <TouchableOpacity
                                key={r.value}
                                style={[styles.chip, on && styles.chipOn, sending && styles.btnDisabled]}
                                onPress={() => onSend(item.case_id, false, r.value)}
                                disabled={sending}
                                accessibilityRole="button"
                                accessibilityLabel={`Reason: ${r.label}`}
                                accessibilityState={{ selected: on, disabled: sending }}
                              >
                                <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>
                )}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function MyCasesTab() {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, loading, refreshing, error, isStale, retry, refresh } = useDataFetch<MyCase[]>(
    () => apiClient.request('/knowledge/cases/my', 'GET', 'admin_action'),
    [],
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!Array.isArray(data) || data.length === 0) {
    return (
      <EmptyState
        message="You have not submitted any cases yet."
        actionHint="Cases you file on the web dashboard show up here."
      />
    );
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
        const open = openId === item.id;
        const st = statusInfo(item.verification_status);
        const crop = item.crop_name || item.crop_text;
        const disease = item.disease_name || item.disease_text;
        return (
          <TouchableOpacity
            style={styles.card}
            onPress={() => setOpenId(open ? null : item.id)}
            accessibilityRole="button"
            accessibilityLabel={`${caseNumber(item.case_number)}, ${st.label}. ${open ? 'Hide' : 'Show'} details`}
            accessibilityState={{ expanded: open }}
          >
            <View style={styles.cardTop}>
              <Text style={[styles.cardTitle, styles.flex]}>{caseNumber(item.case_number)}</Text>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={color.textMuted} />
            </View>
            <Text style={styles.question} numberOfLines={open ? undefined : 2}>{item.question}</Text>
            <View style={styles.statusRow}>
              <Ionicons name={st.icon} size={16} color={st.tint} />
              <Text style={[styles.statusText, { color: st.tint }]}> {st.label}</Text>
              <Text style={styles.meta}> · {formatDateTime(item.created_at)}</Text>
            </View>
            {item.verification_status === 'rejected' && !!item.rejection_reason && (
              <Text style={styles.rejectNote}>
                <Text style={styles.bold}>Reason: </Text>
                {item.rejection_reason}
              </Text>
            )}
            {open && (
              <View style={styles.expand}>
                {!!crop && <Detail label="Crop" value={crop} />}
                {!!disease && <Detail label="Disease" value={disease} />}
                {!!item.symptoms && <Detail label="Symptoms" value={item.symptoms} />}
                {!!item.solution_used && <Detail label="Solution you used" value={item.solution_used} />}
                {!!item.notes && <Detail label="Notes" value={item.notes} />}
                {!!item.district && <Detail label="District" value={item.district} />}
              </View>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  flex: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: color.cardBg,
    margin: spacing.lg,
    marginBottom: 0,
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: color.border,
  },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textSecondary },
  tabTextActive: { color: color.white },
  searchRow: { flexDirection: 'row', padding: spacing.lg, paddingBottom: spacing.sm },
  input: {
    flex: 1,
    minHeight: 48,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: font.subtitle,
    color: color.textPrimary,
  },
  searchBtn: {
    width: 48,
    minHeight: 48,
    marginLeft: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  inlineError: {
    color: color.error,
    fontSize: font.body,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listPad: { padding: spacing.lg },
  intro: { fontSize: font.body, color: color.textSecondary, marginBottom: spacing.lg },
  sectionLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  historyText: { flex: 1, marginLeft: spacing.md },
  historyQuery: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  noticeBox: {
    backgroundColor: color.warningBg,
    borderWidth: 1,
    borderColor: color.warningBorder,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: { fontSize: font.body, color: color.warningText },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    minHeight: 44,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  question: { fontSize: font.body, color: color.textSecondary, marginTop: spacing.xs },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.borderLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    marginTop: spacing.xs,
  },
  badgeGood: { backgroundColor: color.screenBg },
  badgeText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary },
  meta: { fontSize: font.caption, color: color.textMuted, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: spacing.sm },
  statusText: { fontSize: font.caption, fontWeight: fontWeight.semibold },
  rejectNote: { fontSize: font.body, color: color.errorText, marginTop: spacing.sm },
  expand: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: color.borderLight, paddingTop: spacing.sm },
  detailRow: { marginTop: spacing.sm },
  overlay: { flex: 1, backgroundColor: color.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.cardBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '90%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  sheetTitle: { fontSize: font.title, fontWeight: fontWeight.bold, color: color.textPrimary },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
  sheetBody: { padding: spacing.lg, paddingBottom: spacing.xxl },
  fieldLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textMuted,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  fieldValue: { fontSize: font.body, color: color.textPrimary, lineHeight: 20 },
  bold: { fontWeight: fontWeight.bold },
  solutionBox: {
    backgroundColor: color.screenBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.md,
  },
  solutionTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.success,
    marginBottom: spacing.xs,
  },
  solutionExtra: { marginTop: spacing.sm },
  feedbackBox: { marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: color.borderLight, paddingTop: spacing.sm },
  feedbackRow: { flexDirection: 'row', marginBottom: spacing.sm },
  feedbackBtn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
    marginRight: spacing.sm,
  },
  feedbackBtnYes: { backgroundColor: color.success, borderColor: color.success },
  feedbackBtnNo: { backgroundColor: color.error, borderColor: color.error, marginRight: 0 },
  feedbackText: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  feedbackTextOn: { color: color.white },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.cardBg,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipText: { fontSize: font.body, color: color.textPrimary },
  chipTextOn: { color: color.white, fontWeight: fontWeight.semibold },
});
