import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { apiClient } from '../../services/api';
import { LoadingState, ErrorState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

// Officers who could not sign in (new phone, deactivated account). The admin
// approves the phone, switches the account on, resets the phone, or declines;
// the officer is told. Refreshes itself every 15 seconds.
type Issue = {
  id: string; ref: string; officer_name: string; employee_id?: string | null; phone?: string | null;
  issue_type: string; status: string; description?: string | null; attempted_device_id?: string | null;
  device_name?: string | null; registered_device_id?: string | null; attempt_count: number;
  last_attempt_at: string; resolution_action?: string | null; resolution_note?: string | null;
  resolved_by_name?: string | null; resolved_at?: string | null;
};

const TYPE: Record<string, string> = {
  device_mismatch: 'Signing in from a different phone',
  account_inactive: 'Account is deactivated',
  other: 'Other sign-in problem',
};
const DONE: Record<string, string> = {
  approve_device: 'Approved new phone', authorize_login: 'Allowed sign-in', rectify: 'Reset phone', reject: 'Declined',
};
const when = (s?: string | null) => (s ? new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function AdminLoginRequestsScreen() {
  const [view, setView] = useState<'pending' | 'handled'>('pending');
  const [items, setItems] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = view === 'pending' ? '?status_filter=pending' : '';
      const all: Issue[] = (await apiClient.request(`/login-issues${q}`, 'GET', 'admin_action', undefined, { queue: false })) || [];
      setItems(view === 'pending' ? all : all.filter((i) => i.status !== 'pending'));
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load requests.');
    }
  }, [view]);

  useEffect(() => {
    setItems(null);
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (i: Issue, action: string) => {
    const note = (notes[i.id] || '').trim();
    if ((action === 'reject' || action === 'rectify') && !note) {
      Alert.alert('Add a note', 'Write a short note first. The officer is shown it.');
      return;
    }
    setBusy(i.id + action);
    try {
      await apiClient.request(`/login-issues/${i.id}/action`, 'POST', 'admin_action', { action, note: note || null }, { queue: false });
      setNotes((n) => ({ ...n, [i.id]: '' }));
      await load();
    } catch (e: any) {
      Alert.alert('Could not do that', e?.message || 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const Btn = ({ i, action, label, kind }: { i: Issue; action: string; label: string; kind: 'main' | 'plain' | 'danger' }) => (
    <TouchableOpacity
      style={[styles.btn, kind === 'main' && styles.btnMain, kind === 'danger' && styles.btnDanger, busy !== null && { opacity: 0.5 }]}
      disabled={busy !== null}
      onPress={() => act(i, action)}
    >
      <Text style={[styles.btnText, kind === 'main' && { color: color.white }, kind === 'danger' && { color: color.error }]}>
        {busy === i.id + action ? 'Working…' : label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['pending', 'handled'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, view === t && styles.tabOn]} onPress={() => setView(t)}>
            <Text style={[styles.tabText, view === t && { color: color.white }]}>{t === 'pending' ? 'Needs action' : 'Handled'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error && items === null ? (
        <ErrorState message={error} onRetry={load} />
      ) : items === null ? (
        <LoadingState />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl ?? 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          keyboardShouldPersistTaps="handled"
        >
          {items.length === 0 && <Text style={styles.empty}>{view === 'pending' ? 'Nothing waiting. New requests appear here by themselves.' : 'No handled requests yet.'}</Text>}
          {items.map((i) => (
            <View key={i.id} style={styles.card}>
              <Text style={styles.name}>{i.officer_name}</Text>
              <Text style={styles.meta}>ID {i.employee_id || '—'}{i.phone ? ` · ${i.phone}` : ''} · ref {i.ref}</Text>
              <Text style={styles.problem}>{TYPE[i.issue_type] || i.issue_type}</Text>
              <Text style={styles.meta}>Phone: {i.device_name || 'name not sent'}</Text>
              <Text style={styles.meta}>Tried {i.attempt_count}× · last {when(i.last_attempt_at)}</Text>
              {i.status === 'pending' ? (
                <>
                  <TextInput
                    style={styles.input}
                    value={notes[i.id] || ''}
                    onChangeText={(v) => setNotes((n) => ({ ...n, [i.id]: v }))}
                    placeholder="Note for the officer (needed to decline or reset)"
                    placeholderTextColor={color.textMuted}
                    maxLength={500}
                  />
                  <View style={styles.btnRow}>
                    {i.issue_type === 'device_mismatch'
                      ? <Btn i={i} action="approve_device" label="Approve this phone" kind="main" />
                      : <Btn i={i} action="authorize_login" label={i.issue_type === 'account_inactive' ? 'Switch account on' : 'Allow sign-in'} kind="main" />}
                    <Btn i={i} action="rectify" label="Reset phone" kind="plain" />
                    <Btn i={i} action="reject" label="Decline" kind="danger" />
                  </View>
                </>
              ) : (
                <Text style={styles.done}>
                  {DONE[i.resolution_action || ''] || i.resolution_action} by {i.resolved_by_name || 'admin'} · {when(i.resolved_at)}
                  {i.resolution_note ? ` — “${i.resolution_note}”` : ''}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabs: { flexDirection: 'row', padding: spacing.lg, paddingBottom: 0 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderWidth: 1, borderColor: color.border, backgroundColor: color.white },
  tabOn: { backgroundColor: color.primary, borderColor: color.primary },
  tabText: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary },
  empty: { color: color.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: spacing.xl },
  card: { backgroundColor: color.white, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, padding: spacing.lg, marginBottom: spacing.md },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  problem: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary, marginTop: spacing.sm },
  meta: { fontSize: font.caption, color: color.textMuted, marginTop: 2 },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, padding: 10, marginTop: spacing.md, color: color.textPrimary },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  btn: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, marginRight: 8, marginBottom: 8, backgroundColor: color.white },
  btnMain: { backgroundColor: color.primary, borderColor: color.primary },
  btnDanger: { borderColor: color.error },
  btnText: { fontSize: font.body, fontWeight: fontWeight.bold, color: color.textPrimary },
  done: { fontSize: font.body, color: color.textSecondary, marginTop: spacing.md },
});
