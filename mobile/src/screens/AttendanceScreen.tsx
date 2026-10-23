import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from 'react-native';
import OdometerCard, { OdoReading } from '../components/OdometerCard';
import * as Location from 'expo-location';
import { apiClient } from '../services/api';
import { CheckInJob, CheckInState } from '../services/CheckInJob';
import { LocationService } from '../services/LocationService';
import { flushSavedPings } from '../services/pingBuffer';
import { promptBatterySettingsOnce } from '../services/batterySettings';
import { ConsentService } from '../services/consent';
import { showSubmitResult } from '../utils/offlineAlert';
import { openDayClosure } from '../utils/closureRoute';
import { color, font, fontWeight, spacing, radius } from '../theme';

export default function AttendanceScreen({ navigation }: any) {
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<CheckInState>(CheckInJob.getState());
  // Speedometer photo + km (start of day before clock-in, end of day before
  // clock-out). null = not loaded yet / offline: the server still enforces it.
  const [odo, setOdo] = useState<{ required: boolean; check_in: OdoReading | null; check_out: OdoReading | null } | null>(null);
  const loadOdo = async () => {
    try {
      const o: any = await apiClient.request('/odometer/today', 'GET', 'check_in', undefined, { queue: false });
      setOdo(o);
    } catch {
      /* offline: do not block here */
    }
  };
  useEffect(() => { void loadOdo(); }, []);
  const needStart = !!odo?.required && !odo.check_in;
  const needEnd = !!odo?.required && !odo.check_out;

  useEffect(() => {
    const unsub = CheckInJob.subscribe((j) => setJob(j));
    return unsub;
  }, []);

  // Attendance marked by the background job: reflect it here.
  useEffect(() => {
    if (job.doneAt) {
      setIsCheckedIn(true);
      setCheckInTime(job.doneAt);
      setLoadingStatus(false);
    }
    if (job.needsConsent) {
      CheckInJob.clearDone();
      navigation.navigate('LocationDisclosure', { onAcceptNavigateTo: 'back' });
    }
  }, [job.doneAt, job.needsConsent]);

  const checkingIn = job.running;
  const stageText: Record<string, string> = {
    consent: 'Checking…', permission: 'Checking permission…', locating: 'Finding your location…',
    sending: 'Marking attendance…', tracking: 'Starting tracking…',
  };

  // Previously isCheckedIn was plain local state with no fetch-on-mount,
  // so navigating away and back (or restarting the app) always reset the
  // screen to "OFF DUTY" regardless of real backend state. That was more
  // than a display bug once tracking moved to check-in/check-out (see
  // handleCheckIn/handleCheckOut below): an officer who was genuinely
  // still checked in would never see the "Clock In" button again today,
  // so LocationService.startTracking() would never get called again for
  // the rest of their shift if the app's in-memory state was lost.
  //
  // This closes that gap on two different paths, both handled the same
  // way here:
  // - Same-session navigation away/back: the background task (if it was
  //   running) was never actually interrupted - re-calling startTracking()
  //   is a safe no-op here (see the isTaskRegisteredAsync guard added to
  //   LocationService.startTracking), so this is purely re-syncing the UI.
  // - A genuine app restart: apiClient's token is in-memory only (no
  //   persistence anywhere in this app - see api.ts/db.ts), so a real
  //   restart always forces the officer back through Login first. By the
  //   time this screen mounts again, the native task registration from
  //   before the restart is gone too, so this actually re-registers
  //   tracking, not just the label.
  useEffect(() => {
    let cancelled = false;

    const syncStatus = async () => {
      try {
        const today: any = await apiClient.request('/attendance/today', 'GET', 'check_in');
        if (cancelled) return;

        const stillCheckedIn = !!today && !today.check_out_time;
        setIsCheckedIn(stillCheckedIn);
        setCheckInTime(today?.check_in_time ? new Date(today.check_in_time).toLocaleTimeString() : null);
        // Show the screen now. Starting tracking can wait on a permission
        // dialog, and the page must not sit on a spinner until that is answered.
        setLoadingStatus(false);

        if (stillCheckedIn) {
          const trackingResult = await LocationService.startTracking();
          if (trackingResult !== 'started' && trackingResult !== 'already_running' && !cancelled) {
            Alert.alert(
              'Tracking Not Active',
              'You\u2019re checked in, but continuous location tracking isn\u2019t running. Please open Settings and set this app\u2019s location access to "Always Allow."'
            );
          }
        }
      } catch (err) {
        // No record for today (or a network hiccup) - default to OFF
        // DUTY, same as before this fix. An officer who's genuinely
        // checked in but hits this catch will just need to reopen this
        // screen once connectivity is back; that's a strictly better
        // failure mode than assuming ACTIVE SHIFT without confirming it.
        console.warn('Failed to load today\u2019s attendance status', err);
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    };

    syncStatus();
    return () => { cancelled = true; };
  }, []);

  // A position for check-in/out. Never waits more than about 12 seconds: if the
  // phone has no fix, say why and what to do instead of hanging.
  const fixOrExplain = async () => {
    const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
    if (!enabled) {
      Alert.alert('Turn on Location', 'Location (GPS) is switched off on this phone. Turn it on in the quick settings and try again.');
      return null;
    }
    const position = await LocationService.getFix();
    if (!position) {
      Alert.alert(
        'No GPS Signal Yet',
        'The phone could not find your location. Step outside or near a window, wait a few seconds, then try again.'
      );
    }
    return position;
  };

  // Check-in runs in CheckInJob so it keeps going if the officer leaves this
  // screen; this screen only mirrors its progress.
  const handleCheckIn = () => {
    if (needStart) {
      Alert.alert('Speedometer needed', 'Upload the speedometer photo and km first, then clock in.');
      return;
    }
    void CheckInJob.start();
  };

  const handleCheckOut = async () => {
    if (busy) return;
    if (needEnd) {
      Alert.alert('Speedometer needed', 'Upload the end-of-day speedometer photo and km first, then clock out.');
      return;
    }
    setBusy(true);
    try {
      // Field and sales officers file today's closure BEFORE ending the
      // day. Only an explicit "not closed" blocks; if the status can't be
      // read (no signal) the officer is not trapped on duty.
      const role = apiClient.getCurrentUser()?.role ?? '';
      if (role === 'field_officer') {
        let closed: boolean | undefined;
        try {
          // A quick look only: if the answer is slow, check out anyway.
          const closure: any = await apiClient.request('/day-closure/status', 'GET', 'task_action', undefined, {
            timeoutMs: 6000,
          });
          closed = closure?.closed_today;
        } catch {
          closed = undefined;
        }
        if (closed === false) {
          Alert.alert(
            "Today's Closure Required",
            "Please submit today's day closure before you check out.",
            [
              { text: 'Not now', style: 'cancel' },
              {
                text: 'Go to Day Closure',
                onPress: () => { void openDayClosure(navigation); },
              },
            ]
          );
          return;
        }
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Required', 'Location permission is needed to check out.');
        return;
      }
      const position = await fixOrExplain();
      if (!position) return;

      const res = await apiClient.request('/attendance/check-out', 'POST', 'check_out', {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      setIsCheckedIn(false);
      setCheckInTime(null);
      void loadOdo();
      await LocationService.stopTracking();
      void flushSavedPings(); // send anything saved while the signal was gone
      showSubmitResult(res, 'Checked Out Successfully', 'Shift completed. Live location tracking stopped.');
      navigation.goBack();
    } catch (err: any) {
      // Already checked out (for example on the web): the shift is over,
      // so make sure this phone is not still tracking.
      if (String(err?.message || '').toLowerCase().includes('already checked out')) {
        setIsCheckedIn(false);
        await LocationService.stopTracking();
      }
      Alert.alert('Error', err.message || 'Check-out failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.screenBg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Shift Management</Text>
      
      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>Current Status:</Text>
        {loadingStatus ? (
          <ActivityIndicator style={{ marginTop: 8 }} color={color.primary} />
        ) : (
          <>
            <Text style={[styles.statusValue, { color: isCheckedIn ? color.success : color.error }]}>
              {isCheckedIn ? 'ACTIVE SHIFT' : 'OFF DUTY'}
            </Text>
            {isCheckedIn && (
              <Text style={styles.clockedTime}>Clocked in at: {checkInTime}</Text>
            )}
          </>
        )}
      </View>

      {!loadingStatus && odo?.required && (
        <OdometerCard
          kind={isCheckedIn ? 'check_out' : 'check_in'}
          existing={isCheckedIn ? odo.check_out : odo.check_in}
          onSubmitted={loadOdo}
        />
      )}

      {loadingStatus ? null : !isCheckedIn ? (
        <TouchableOpacity style={[styles.btnCheckIn, (checkingIn || needStart) && styles.btnBusy]} onPress={handleCheckIn} disabled={checkingIn}>
          {checkingIn ? (
            <View style={{ alignItems: 'center' }}>
              <ActivityIndicator color={color.white} />
              <Text style={[styles.btnText, { fontSize: font.body, marginTop: 4 }]}>{stageText[job.stage] || 'Working…'}</Text>
            </View>
          ) : <Text style={styles.btnText}>Clock In (Start Duty)</Text>}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={[styles.btnCheckOut, (busy || needEnd) && styles.btnBusy]} onPress={handleCheckOut} disabled={busy}>
          {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.btnText}>Clock Out (End Duty)</Text>}
        </TouchableOpacity>
      )}

      {checkingIn && (
        <Text style={{ textAlign: 'center', color: color.textSecondary, marginBottom: 8 }}>
          You can leave this screen. Check-in will finish in the background.
        </Text>
      )}
      <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
        <Text style={styles.btnBackText}>Go Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: color.screenBg,
    padding: spacing.xxl,
    justifyContent: 'center',
  },
  title: {
    fontSize: font.heading,
    fontWeight: fontWeight.bold,
    color: color.primary,
    textAlign: 'center',
    marginBottom: 32,
  },
  statusCard: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    borderWidth: 1,
    borderColor: color.border,
    alignItems: 'center',
    marginBottom: 40,
    shadowColor: color.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  statusLabel: {
    fontSize: font.body,
    color: color.textSecondary,
  },
  statusValue: {
    fontSize: font.heading,
    fontWeight: fontWeight.bold,
    marginTop: spacing.sm,
  },
  clockedTime: {
    fontSize: font.body,
    color: color.textSecondary,
    marginTop: spacing.sm,
  },
  btnCheckIn: {
    backgroundColor: color.primary,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  btnCheckOut: {
    backgroundColor: color.error,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  btnBusy: {
    opacity: 0.7,
  },
  btnText: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.white,
  },
  btnBack: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  btnBackText: {
    fontSize: font.subtitle,
    color: color.primary,
    fontWeight: fontWeight.bold,
  },
});
