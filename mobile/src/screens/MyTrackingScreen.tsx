/**
 * PHASE 3A ITEM 7 — make tracking visible to the officer.
 *
 * The single strongest signal to a Play reviewer that this is a
 * legitimate enterprise tool rather than covert surveillance is that the
 * tracked person can see exactly what is collected about them. The
 * Stalkerware policy's core prohibition is cloaked or misleading
 * tracking behaviour; an in-app screen showing live tracking state plus
 * the officer's own recorded history is the direct answer to it.
 *
 * It is also the answer to the internal objection this feature will get
 * from officers, which is worth more than the compliance benefit.
 *
 * NO MAP HERE, deliberately. react-native-maps is not a dependency of
 * this project (checked package.json), and adding a native map module
 * during the same change as an Expo SDK upgrade is how you end up unable
 * to tell which change broke the build. A timeline summary answers the
 * officer's real questions - "is it on?", "what has it recorded today?",
 * "when did it start and stop?" - without a new native dependency. The
 * map can come later as its own change; the admin web dashboard already
 * has one.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { apiClient } from '../services/api';
import { openBatterySettings } from '../services/batterySettings';
import { savedPingCount } from '../services/pingBuffer';
import { trackingDiag, TrackingDiag } from '../services/trackingDiag';
import { WakeLock } from '../../modules/wake-lock';
import { color, font, fontWeight, radius, spacing } from '../theme';

const LOCATION_TASK_NAME = 'background-location-task';

interface TodayTracking {
  point_count: number;
  first_recorded_at: string | null;
  last_recorded_at: string | null;
  total_distance_km: number;
  checked_in: boolean;
  retention_months: number;
}

function fmtGap(sec: number): string {
  if (sec < 60) return `${sec} sec`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MyTrackingScreen() {
  const [data, setData] = useState<TodayTracking | null>(null);
  const [taskRunning, setTaskRunning] = useState(false);
  const [permission, setPermission] = useState<string>('checking');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diag, setDiag] = useState<TrackingDiag | null>(null);
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Device-side truth: is the OS actually running our task right now?
      // This is deliberately read from the OS rather than from app state,
      // because the whole point of this screen is to be honest about what
      // is happening, including when the app thinks tracking is on and
      // the OS has killed it.
      const registered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      setTaskRunning(registered);

      const { status } = await Location.getBackgroundPermissionsAsync();
      setPermission(status);
      setDiag(await trackingDiag.read());
      setWaiting(await savedPingCount());
      // The phone's own state is known now: show it without waiting for the server.
      setLoading(false);

      const res: TodayTracking = await apiClient.request(
        '/location/me/today',
        'GET',
        'gps_ping'
      );
      setData(res);
    } catch (err: any) {
      setError(err?.message ?? 'Could not load your tracking information.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Loads when the screen opens and every 30 seconds while it stays in front.
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const id = setInterval(load, 30000);
      return () => clearInterval(id);
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={color.primary} />
      </View>
    );
  }

  const isOn = taskRunning && permission === 'granted';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={[styles.statusCard, isOn ? styles.statusOn : styles.statusOff]}>
        <Text style={styles.statusLabel}>
          {isOn ? 'Location recording is ON' : 'Location recording is OFF'}
        </Text>
        <Text style={styles.statusDetail}>
          {isOn
            ? 'This is on because you are checked in. It stops the moment you check out.'
            : permission !== 'granted'
            ? 'Location permission is not set to "Allow all the time", so nothing is being recorded.'
            : 'You are not checked in, so nothing is being recorded.'}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Keep it running</Text>
      <View style={styles.card}>
        <Text style={styles.bodyText}>
          Some phones stop apps when the screen is off. Set VBT One to "Don't optimise" or "Unrestricted" in the
          battery list, and keep location on "Allow all the time".
        </Text>
        <TouchableOpacity style={styles.batteryBtn} onPress={() => void openBatterySettings()}>
          <Text style={styles.batteryBtnText}>Open battery settings</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>What was recorded today</Text>

      {error ? (
        <View style={styles.card}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Row label="Points recorded" value={String(data?.point_count ?? 0)} />
          <Row label="First recorded" value={formatTime(data?.first_recorded_at ?? null)} />
          <Row label="Last recorded" value={formatTime(data?.last_recorded_at ?? null)} />
          <Row
            label="Distance covered"
            value={`${(data?.total_distance_km ?? 0).toFixed(1)} km`}
            last
          />
        </View>
      )}

      {isOn && (
        <>
          <Text style={styles.sectionTitle}>Phone check</Text>
          <View style={styles.card}>
            <Row label="Location updates from the phone" value={String(diag?.gpsUpdates ?? 0)} />
            <Row label="Sent to the server" value={String(diag?.sentOk ?? 0)} />
            <Row label="Could not send (kept)" value={String(diag?.failed ?? 0)} />
            <Row label="Waiting to upload" value={String(waiting)} />
            <Row
              label="Phone kept awake for tracking"
              value={WakeLock.isAvailable ? (WakeLock.isHeld() ? 'Yes' : 'No') : 'Not in this build'}
            />
            <Row label="Longest time with no update" value={fmtGap(diag?.longestGapSec ?? 0)} />
            <Row label="Tracking started" value={diag?.startedAt ? formatTime(new Date(diag.startedAt).toISOString()) : '—'} last />
            {!!diag?.lastError && <Text style={styles.errorText}>Last problem: {diag.lastError}</Text>}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Who can see this</Text>
      <View style={styles.card}>
        <Text style={styles.bodyText}>
          Your manager and the company admin. Nobody outside the company. This information is
          kept for {data?.retention_months ?? 3} months and then deleted automatically.
        </Text>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.screenBg },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.screenBg,
  },
  content: { padding: spacing.lg },
  batteryBtn: {
    marginTop: spacing.md,
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  batteryBtnText: { color: color.white, fontWeight: fontWeight.bold, fontSize: font.body },
  statusCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  statusOn: { backgroundColor: color.warningBg, borderColor: color.warningBorder },
  statusOff: { backgroundColor: color.cardBg, borderColor: color.border },
  statusLabel: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginBottom: spacing.xs,
  },
  statusDetail: { fontSize: font.body, color: color.textSecondary, lineHeight: 20 },
  sectionTitle: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontSize: font.body, color: color.textSecondary },
  rowValue: { fontSize: font.body, fontWeight: fontWeight.semibold, color: color.textPrimary },
  bodyText: {
    fontSize: font.body,
    color: color.textPrimary,
    lineHeight: 21,
    paddingVertical: spacing.lg,
  },
  errorText: { fontSize: font.body, color: color.errorText, paddingVertical: spacing.lg },
});
