import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type Task = {
  id: string;
  title: string;
  description?: string | null;
  assigned_to_name: string;
  due_date: string;
  status: string;
  is_overdue: boolean;
};

type OfficerOption = { id: string; full_name: string; employee_id?: string; role: string };

const TABS = ['review', 'assign', 'all'] as const;
type TabKey = typeof TABS[number];
const TAB_LABEL: Record<TabKey, string> = { review: 'Review', assign: 'Assign New', all: 'All Tasks' };

// Admin/manager side of the existing task-assignment system
// (task_router.py). Field officers already have TasksScreen.tsx for
// "my tasks"; this is the missing other half - assigning work to
// someone, and approving/rejecting what they submit for review. Both
// actions already exist as real backend endpoints
// (POST /tasks, PATCH /tasks/{id}/review) that the web admin console
// also calls; nothing here is new backend surface, only the mobile UI
// that was missing.
export default function AdminTasksScreen() {
  const [tab, setTab] = useState<TabKey>('review');

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{TAB_LABEL[t]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'review' && <ReviewTab />}
      {tab === 'assign' && <AssignTab />}
      {tab === 'all' && <AllTasksTab />}
    </View>
  );
}

function ReviewTab() {
  const [actingId, setActingId] = useState<string | null>(null);
  const { data, loading, error, retry } = useDataFetch<Task[]>(
    () => apiClient.request('/tasks?status_filter=pending_review', 'GET', 'admin_action'),
    []
  );

  const act = async (task: Task, approve: boolean) => {
    if (!approve) {
      Alert.prompt
        ? Alert.prompt('Reject Task', 'Reason for rejecting (optional):', async (reason) => {
            await decide(task, false, reason);
          })
        : await decide(task, false, undefined);
      return;
    }
    await decide(task, true, undefined);
  };

  const decide = async (task: Task, approve: boolean, rejection_reason?: string) => {
    setActingId(task.id);
    try {
      await apiClient.request(`/tasks/${task.id}/review`, 'PATCH', 'admin_action', {
        approve,
        rejection_reason: rejection_reason || undefined,
      });
      retry();
    } catch (err: any) {
      Alert.alert('Could Not Update', err?.message ?? 'Please try again.');
    } finally {
      setActingId(null);
    }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <EmptyState message="Nothing waiting for review." />;

  return (
    <FlatList
      data={data}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: spacing.lg }}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardMeta}>Submitted by {item.assigned_to_name} · due {item.due_date}</Text>
          {!!item.description && <Text style={styles.cardDesc}>{item.description}</Text>}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.rejectBtn]}
              disabled={actingId === item.id}
              onPress={() => act(item, false)}
            >
              {actingId === item.id ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Reject</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.approveBtn]}
              disabled={actingId === item.id}
              onPress={() => act(item, true)}
            >
              {actingId === item.id ? <ActivityIndicator color={color.white} /> : <Text style={styles.actionText}>Approve</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    />
  );
}

function AllTasksTab() {
  const { data, loading, error, retry } = useDataFetch<Task[]>(
    () => apiClient.request('/tasks', 'GET', 'admin_action'),
    []
  );

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (!data || data.length === 0) return <EmptyState message="No tasks have been created yet." />;

  return (
    <FlatList
      data={data}
      keyExtractor={(t) => t.id}
      contentContainerStyle={{ padding: spacing.lg }}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardMeta}>
            {item.assigned_to_name} · due {item.due_date} · {item.status.replace('_', ' ')}
            {item.is_overdue ? ' · OVERDUE' : ''}
          </Text>
        </View>
      )}
    />
  );
}

function AssignTab() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: officers, loading: loadingOfficers, error: officersError, retry: retryOfficers } = useDataFetch<{
    items: OfficerOption[];
  }>(() => apiClient.request('/users?limit=200', 'GET', 'admin_action'), [], { refetchOnFocus: false });

  const assignableOfficers = (officers?.items ?? []).filter(
    (u) => u.role === 'field_officer' || u.role === 'sales_officer'
  );

  const submit = async () => {
    if (!title.trim() || !dueDate.trim() || !assigneeId) {
      Alert.alert('Missing Details', 'Please enter a title, pick an officer, and set a due date (YYYY-MM-DD).');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate.trim())) {
      Alert.alert('Invalid Date', 'Due date must be in YYYY-MM-DD format.');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.request('/tasks', 'POST', 'admin_action', {
        title: title.trim(),
        description: description.trim() || undefined,
        assigned_to: assigneeId,
        due_date: dueDate.trim(),
      });
      Alert.alert('Task Assigned', 'The task has been assigned.');
      setTitle('');
      setDescription('');
      setDueDate('');
      setAssigneeId(null);
    } catch (err: any) {
      Alert.alert('Could Not Assign', err?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What needs to be done" />

      <Text style={styles.label}>Description (optional)</Text>
      <TextInput
        style={[styles.input, { height: 80 }]}
        value={description}
        onChangeText={setDescription}
        placeholder="Details for the officer"
        multiline
      />

      <Text style={styles.label}>Due Date (YYYY-MM-DD)</Text>
      <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="2026-10-15" />

      <Text style={styles.label}>Assign To</Text>
      {loadingOfficers ? (
        <ActivityIndicator color={color.primary} style={{ marginVertical: spacing.md }} />
      ) : officersError ? (
        <ErrorState message={officersError} onRetry={retryOfficers} />
      ) : (
        <View style={styles.officerList}>
          {assignableOfficers.map((o) => (
            <TouchableOpacity
              key={o.id}
              style={[styles.officerChip, assigneeId === o.id && styles.officerChipActive]}
              onPress={() => setAssigneeId(o.id)}
            >
              <Text style={[styles.officerChipText, assigneeId === o.id && styles.officerChipTextActive]}>
                {o.full_name}{o.employee_id ? ` (${o.employee_id})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
          {assignableOfficers.length === 0 && (
            <Text style={styles.cardMeta}>No field or sales officers found.</Text>
          )}
        </View>
      )}

      <TouchableOpacity style={styles.submitBtn} onPress={submit} disabled={submitting}>
        {submitting ? <ActivityIndicator color={color.white} /> : <Text style={styles.submitText}>Assign Task</Text>}
      </TouchableOpacity>
    </ScrollView>
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
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: 'center' },
  tabActive: { backgroundColor: color.primary },
  tabText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary },
  tabTextActive: { color: color.white },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  cardMeta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  cardDesc: { fontSize: font.body, color: color.textPrimary, marginTop: spacing.sm },
  actions: { flexDirection: 'row', marginTop: spacing.lg },
  actionBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center', marginRight: spacing.sm },
  rejectBtn: { backgroundColor: color.error },
  approveBtn: { backgroundColor: color.success, marginRight: 0 },
  actionText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
  label: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    backgroundColor: color.cardBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    color: color.textPrimary,
  },
  officerList: { flexDirection: 'row', flexWrap: 'wrap' },
  officerChip: {
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: color.cardBg,
  },
  officerChipActive: { backgroundColor: color.primary, borderColor: color.primary },
  officerChipText: { fontSize: font.caption, color: color.textPrimary },
  officerChipTextActive: { color: color.white, fontWeight: fontWeight.semibold },
  submitBtn: {
    backgroundColor: color.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  submitText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.subtitle },
});
