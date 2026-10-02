import React, { useCallback, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient } from '../services/api';
import { dbService } from '../services/db';
import { wasQueuedOffline } from '../utils/offlineAlert';
import { ErrorState, EmptyState } from '../components/FetchStates';
import { CONNECTION_ERROR_MESSAGE } from '../hooks/useDataFetch';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Task = {
  id: string;
  title: string;
  description?: string | null;
  due_date: string;
  status: string; // assigned | in_progress | pending_review | done | cancelled
  is_overdue: boolean;
  related_type?: string | null;
  related_id?: string | null;
};

const NEXT_STATUS: Record<string, string | null> = {
  assigned: 'in_progress',
  in_progress: 'pending_review',
  pending_review: null,
  done: null,
  cancelled: null,
};

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Assigned',
  in_progress: 'In Progress',
  pending_review: 'Waiting for Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_COLOR: Record<string, string> = {
  assigned: color.info,
  in_progress: color.warning,
  pending_review: '#6a1b9a',
  done: color.success,
  cancelled: color.textSecondary,
};

const RELATED_LABEL: Record<string, string> = {
  farmer: 'From: Farmer record',
  dealer: 'From: Dealer record',
  crop_issue: 'From: Crop issue report',
  general: '',
};

// Filter tabs group by status - "Pending" maps to the backend's "assigned"
// status; the rest match 1:1. A simple segmented strip over the same list,
// not separate screens, per the spec.
type FilterTab = 'pending' | 'in_progress' | 'pending_review' | 'done';

const FILTER_TABS: { key: FilterTab; label: string; statuses: string[] }[] = [
  { key: 'pending', label: 'Pending', statuses: ['assigned'] },
  { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'] },
  { key: 'pending_review', label: 'Waiting for Review', statuses: ['pending_review'] },
  { key: 'done', label: 'Done', statuses: ['done'] },
];

function isOverdue(task: Task): boolean {
  if (task.status === 'done' || task.status === 'cancelled') return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.due_date);
  return due < today;
}

export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>('pending');
  // Task ids with a status change still sitting in the offline queue -
  // their row keeps showing the old status (that's the real state until
  // it syncs) but gets a "Pending sync" badge instead of looking like
  // nothing happened when the officer tapped the action button.
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());
  const currentUser = apiClient.getCurrentUser();

  const refreshPendingIds = () => {
    dbService.getQueuedItems().then((items) => {
      const ids = items
        .filter((i) => i.type === 'task_action' && i.endpoint.includes('/status'))
        .map((i) => i.endpoint.split('/tasks/')[1]?.split('/status')[0])
        .filter(Boolean) as string[];
      setPendingTaskIds(new Set(ids));
    });
  };

  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = React.useRef(false);

  const fetchTasks = useCallback(() => {
    const userId = currentUser?.id;
    const query = userId ? `?assigned_to=${userId}` : '';
    return apiClient
      .request(`/tasks${query}`, 'GET', 'task_action')
      .then((data: Task[]) => {
        setTasks(data || []);
        setError(null);
        hasLoadedOnce.current = true;
      })
      .catch((err) => {
        console.warn('Failed to load tasks', err);
        // Only replace the screen with an error state on the very first
        // load - a failed background refresh keeps showing the tasks
        // already on screen rather than blanking them out.
        if (!hasLoadedOnce.current) setError(CONNECTION_ERROR_MESSAGE);
      });
  }, [currentUser?.id]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchTasks().finally(() => setLoading(false));
      refreshPendingIds();
    }, [fetchTasks])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchTasks().finally(() => setRefreshing(false));
    refreshPendingIds();
  };

  const advanceStatus = async (task: Task) => {
    const next = NEXT_STATUS[task.status];
    if (!next) return;
    try {
      const res = await apiClient.request(`/tasks/${task.id}/status`, 'PATCH', 'task_action', { status: next });
      if (wasQueuedOffline(res)) {
        Alert.alert('Saved on Your Phone', "This update will send when you're back online.");
        refreshPendingIds();
      } else {
        fetchTasks();
      }
    } catch (err) {
      Alert.alert('Could not update task', 'Please try again once you have a connection.');
    }
  };

  const activeStatuses = FILTER_TABS.find((t) => t.key === activeTab)?.statuses ?? [];
  const filteredTasks = useMemo(
    () => tasks.filter((t) => activeStatuses.includes(t.status)),
    [tasks, activeTab]
  );

  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = { pending: 0, in_progress: 0, pending_review: 0, done: 0 };
    FILTER_TABS.forEach((tab) => {
      c[tab.key] = tasks.filter((t) => tab.statuses.includes(t.status)).length;
    });
    return c;
  }, [tasks]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={color.primary} />
      </View>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); fetchTasks().finally(() => setLoading(false)); }} />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>My Tasks</Text>

      <View style={styles.tabStrip}>
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabChip, activeTab === tab.key && styles.tabChipActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabChipText, activeTab === tab.key && styles.tabChipTextActive]}>
              {tab.label} ({counts[tab.key]})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filteredTasks}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[color.primary]} />}
        ListEmptyComponent={<EmptyState message="No tasks right now." />}
        contentContainerStyle={filteredTasks.length === 0 ? { flexGrow: 1 } : { paddingBottom: 20 }}
        renderItem={({ item }) => {
          const next = NEXT_STATUS[item.status];
          const overdue = isOverdue(item);
          const relatedLabel = item.related_type ? RELATED_LABEL[item.related_type] : '';
          const pendingSync = pendingTaskIds.has(item.id);
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={[styles.dueDate, overdue && styles.dueDateOverdue]}>
                  {overdue ? `Overdue — was due ${item.due_date}` : `Due ${item.due_date}`}
                </Text>
              </View>
              {item.description ? <Text style={styles.cardDesc}>{item.description}</Text> : null}
              {!!relatedLabel && <Text style={styles.relatedLabel}>{relatedLabel}</Text>}
              {pendingSync && <Text style={styles.pendingSyncBadge}>⏳ Pending sync</Text>}
              <View style={styles.cardFooter}>
                <Text style={[styles.statusPill, { backgroundColor: STATUS_COLOR[item.status] ?? color.textSecondary }]}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </Text>
                {next && !pendingSync && (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => advanceStatus(item)}>
                    <Text style={styles.actionBtnText}>
                      {next === 'in_progress' ? 'Start' : 'Mark for Review'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  tabStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  tabChip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.border,
    marginHorizontal: spacing.xs,
    marginBottom: spacing.sm,
  },
  tabChipActive: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  tabChipText: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
  },
  tabChipTextActive: {
    color: color.white,
  },
  emptyText: {
    color: color.textMuted,
    fontSize: font.body,
  },
  card: {
    backgroundColor: color.white,
    borderRadius: 14,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: color.borderLight,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    flexShrink: 1,
    marginRight: spacing.sm,
  },
  dueDate: {
    fontSize: font.caption,
    color: color.textMuted,
  },
  dueDateOverdue: {
    color: color.error,
    fontWeight: fontWeight.bold,
  },
  cardDesc: {
    fontSize: font.body,
    color: color.textSecondary,
    marginTop: 6,
  },
  relatedLabel: {
    fontSize: font.caption,
    color: color.primary,
    marginTop: 6,
    fontWeight: fontWeight.semibold,
  },
  pendingSyncBadge: {
    fontSize: font.caption,
    color: color.warningText,
    marginTop: 6,
    fontWeight: fontWeight.semibold,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  statusPill: {
    color: color.white,
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  actionBtn: {
    backgroundColor: color.primary,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  actionBtnText: {
    color: color.white,
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
  },
});
