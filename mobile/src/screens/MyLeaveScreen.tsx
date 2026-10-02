import React, { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient } from '../services/api';
import { showSubmitResult } from '../utils/offlineAlert';
import { ErrorState } from '../components/FetchStates';
import { CONNECTION_ERROR_MESSAGE } from '../hooks/useDataFetch';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Holiday = { id: string; date: string; description: string; is_national: boolean };
type LeaveRequest = { id: string; leave_type: string; start_date: string; end_date: string; status: string; reason: string };

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

// section 7: My Leave as a calendar, not a list. Holidays (every Sunday +
// whatever admin has set for Pongal/Diwali/etc, from GET /holidays) and
// the officer's own leave requests are both marked directly on the dates
// they fall on. Applying for leave happens from inside this same screen.
export default function MyLeaveScreen() {
  const [monthDate, setMonthDate] = useState(new Date());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = React.useRef(false);

  const [applyVisible, setApplyVisible] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState('');
  const [leaveType, setLeaveType] = useState<'planned' | 'emergency'>('planned');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth(); // 0-indexed

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiClient.request(`/holidays?year=${year}`, 'GET', 'plan_submit'),
      apiClient.request('/leave', 'GET', 'plan_submit'),
    ])
      .then(([holidayData, leaveData]) => {
        setHolidays(holidayData || []);
        setLeaves(leaveData || []);
        setError(null);
        hasLoadedOnce.current = true;
      })
      .catch((err) => {
        console.warn('Failed to load leave calendar data', err);
        if (!hasLoadedOnce.current) setError(CONNECTION_ERROR_MESSAGE);
      })
      .finally(() => setLoading(false));
  }, [year]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const holidayByDate: Record<string, Holiday> = {};
  holidays.forEach((h) => {
    holidayByDate[h.date] = h;
  });

  const leaveStatusByDate: Record<string, string> = {};
  leaves.forEach((l) => {
    const start = new Date(l.start_date);
    const end = new Date(l.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      leaveStatusByDate[toISODate(d)] = l.status;
    }
  });

  const totalDays = daysInMonth(year, month);
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  const changeMonth = (delta: number) => {
    setMonthDate(new Date(year, month + delta, 1));
  };

  const openApplyFor = (day: number) => {
    const iso = toISODate(new Date(year, month, day));
    setSelectedDate(iso);
    setEndDate(iso);
    setReason('');
    setLeaveType('planned');
    setApplyVisible(true);
  };

  const submitLeave = async () => {
    if (!selectedDate) return;
    if (!reason.trim()) {
      Alert.alert('Reason Required', 'Please add a short reason for your leave.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.request('/leave', 'POST', 'plan_submit', {
        leave_type: leaveType,
        start_date: selectedDate,
        end_date: endDate || selectedDate,
        reason: reason.trim(),
      });
      setApplyVisible(false);
      showSubmitResult(res, 'Leave Requested', 'Your leave request has been submitted.');
      loadData();
    } catch (err: any) {
      Alert.alert('Could Not Submit', err.message || 'Please check the dates and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => changeMonth(-1)}
          style={styles.navBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
        >
          <Text style={styles.navBtnText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{MONTH_LABELS[month]} {year}</Text>
        <TouchableOpacity
          onPress={() => changeMonth(1)}
          style={styles.navBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Next month"
        >
          <Text style={styles.navBtnText}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={color.primary} style={{ marginTop: 40 }} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : (
        <ScrollView>
          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((w, i) => (
              <Text key={i} style={styles.weekdayLabel}>{w}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((day, idx) => {
              if (day === null) return <View key={idx} style={styles.cell} />;

              const iso = toISODate(new Date(year, month, day));
              const dow = new Date(year, month, day).getDay();
              const isSunday = dow === 0;
              const holiday = holidayByDate[iso];
              const leaveStatus = leaveStatusByDate[iso];
              const isHoliday = isSunday || !!holiday;

              let markerStyle = null;
              if (leaveStatus === 'approved') markerStyle = styles.dotApproved;
              else if (leaveStatus === 'pending') markerStyle = styles.dotPending;
              else if (leaveStatus === 'rejected') markerStyle = styles.dotRejected;

              return (
                <TouchableOpacity
                  key={idx}
                  style={[styles.cell, isHoliday && styles.cellHoliday]}
                  onPress={() => !isHoliday && openApplyFor(day)}
                  disabled={isHoliday}
                  // Small, symmetric hitSlop - day cells sit edge-to-edge in
                  // a 7-column grid with no gap between them, so this can't
                  // safely be as generous as the nav buttons' hitSlop
                  // (overlapping into a neighboring cell's hit region would
                  // risk taps near a boundary registering on the wrong
                  // day). Kept small and applied uniformly to every cell so
                  // the shared boundary between any two adjacent cells
                  // stays at their visual midpoint - see the item 5 report
                  // for the full reasoning on why this couldn't just be
                  // widened further.
                  hitSlop={{ top: 3, bottom: 3, left: 3, right: 3 }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isHoliday
                      ? `${day}, ${isSunday ? 'Sunday' : holiday?.description ?? 'holiday'}, not available`
                      : `${day}${leaveStatus ? `, leave ${leaveStatus}` : ''}, tap to apply for leave`
                  }
                >
                  <Text style={[styles.cellText, isHoliday && styles.cellTextHoliday]}>{day}</Text>
                  {holiday && !isSunday && <Text style={styles.holidayLabel} numberOfLines={1}>{holiday.description}</Text>}
                  {markerStyle && <View style={[styles.dot, markerStyle]} />}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.legend}>
            <LegendItem color={color.textMuted} label="Holiday / Sunday" />
            <LegendItem color={color.warning} label="Pending" />
            <LegendItem color={color.success} label="Approved" />
            <LegendItem color={color.error} label="Rejected" />
          </View>
          <Text style={styles.tapHint}>Tap any working day to apply for leave.</Text>
        </ScrollView>
      )}

      <Modal visible={applyVisible} transparent animationType="fade" onRequestClose={() => setApplyVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Apply for Leave</Text>
            <Text style={styles.modalSubtitle}>From {selectedDate}</Text>

            <TextInput
              style={styles.input}
              placeholder="End date (YYYY-MM-DD)"
              placeholderTextColor={color.textMuted}
              value={endDate}
              onChangeText={setEndDate}
            />

            <View style={styles.typeToggle}>
              <TouchableOpacity
                style={[styles.typeChip, leaveType === 'planned' && styles.typeChipActive]}
                onPress={() => setLeaveType('planned')}
                accessibilityRole="button"
                accessibilityLabel="Planned leave"
                accessibilityState={{ selected: leaveType === 'planned' }}
              >
                <Text style={[styles.typeChipText, leaveType === 'planned' && styles.typeChipTextActive]}>Planned</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.typeChip, leaveType === 'emergency' && styles.typeChipActive]}
                onPress={() => setLeaveType('emergency')}
                accessibilityRole="button"
                accessibilityLabel="Emergency leave"
                accessibilityState={{ selected: leaveType === 'emergency' }}
              >
                <Text style={[styles.typeChipText, leaveType === 'emergency' && styles.typeChipTextActive]}>Emergency</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.input, { height: 70 }]}
              placeholder="Reason"
              placeholderTextColor={color.textMuted}
              value={reason}
              onChangeText={setReason}
              multiline
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setApplyVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSubmit}
                onPress={submitLeave}
                disabled={submitting}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={submitting ? 'Submitting leave request' : 'Submit leave request'}
              >
                <Text style={styles.modalSubmitText}>{submitting ? 'Submitting…' : 'Submit'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const CELL_SIZE = '14.28%';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: color.primary,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  navBtn: {
    padding: spacing.sm,
  },
  navBtnText: {
    color: color.white,
    fontSize: font.title,
    fontWeight: fontWeight.bold,
  },
  monthLabel: {
    color: color.white,
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
  },
  weekdayRow: {
    flexDirection: 'row',
    paddingTop: spacing.md,
  },
  weekdayLabel: {
    width: CELL_SIZE,
    textAlign: 'center',
    fontSize: font.caption,
    color: color.textMuted,
    fontWeight: fontWeight.bold,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.xs,
  },
  cell: {
    width: CELL_SIZE,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  cellHoliday: {
    backgroundColor: color.borderLight,
    borderRadius: radius.sm,
  },
  cellText: {
    fontSize: font.body,
    color: color.textPrimary,
  },
  cellTextHoliday: {
    color: color.textMuted,
  },
  holidayLabel: {
    fontSize: font.caption,
    color: color.textMuted,
    marginTop: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 3,
  },
  dotApproved: { backgroundColor: color.success },
  dotPending: { backgroundColor: color.warning },
  dotRejected: { backgroundColor: color.error },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.lg,
    marginBottom: spacing.sm,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendLabel: {
    fontSize: font.caption,
    color: color.textSecondary,
  },
  tapHint: {
    textAlign: 'center',
    fontSize: font.caption,
    color: color.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: color.overlay,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  modalCard: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  modalTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.primary,
  },
  modalSubtitle: {
    fontSize: font.body,
    color: color.textSecondary,
    marginTop: 2,
    marginBottom: spacing.lg,
  },
  input: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    color: color.textPrimary,
    marginBottom: 14,
  },
  typeToggle: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  typeChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.screenBg,
  },
  typeChipActive: {
    backgroundColor: color.primary,
    borderColor: color.primary,
  },
  typeChipText: {
    fontSize: font.body,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
  },
  typeChipTextActive: {
    color: color.white,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  modalCancelText: {
    color: color.textMuted,
    fontWeight: fontWeight.semibold,
  },
  modalSubmit: {
    backgroundColor: color.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.sm,
  },
  modalSubmitText: {
    color: color.white,
    fontWeight: fontWeight.bold,
  },
});
