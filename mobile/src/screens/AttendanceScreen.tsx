import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { apiClient } from '../services/api';
import { LocationService } from '../services/LocationService';
import { flushSavedPings } from '../services/pingBuffer';
import { promptBatterySettingsOnce } from '../services/batterySettings';
import { ConsentService } from '../services/consent';
import { showSubmitResult } from '../utils/offlineAlert';
import { color, font, fontWeight, spacing, radius } from '../theme';

export default function AttendanceScreen({ navigation }: any) {
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [busy, setBusy] = useState(false);

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

  const handleCheckIn = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // BUG FIX: previously this went straight to the OS permission
      // prompt and then the check-in API call, with no client-side
      // awareness that the backend independently requires a recorded
      // location-notice acceptance (see consent_router.py /consent/location)
      // before it will accept a check-in at all. An officer who granted
      // the OS permission but never saw/accepted the in-app disclosure
      // (which, until this fix, nothing in the app ever navigated to -
      // see LoginScreen.tsx) would have the OS prompt succeed and then
      // get a confusing 400 from the server on the next step. Checking
      // here first and routing to the disclosure screen turns that into
      // the normal, expected flow instead of a dead end.
      let accepted = true;
      try {
        const consentStatus = await ConsentService.getStatus();
        accepted = consentStatus.accepted;
      } catch {
        // Can't verify right now (offline, etc.) - let the existing
        // permission/check-in flow below run; the backend is still the
        // authority and will reject with its own message if truly
        // unaccepted, same as before this fix.
        accepted = true;
      }
      if (!accepted) {
        navigation.navigate('LocationDisclosure', { onAcceptNavigateTo: 'back' });
        return;
      }

      // Real device fix, same source LocationService.ts uses for tracking
      // pings. Previously this sent a hardcoded lat/lng ("Mock latitude/
      // longitude fetch") regardless of where the officer actually was.
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Required', 'Location permission is needed to check in.');
        return;
      }
      const position = await fixOrExplain();
      if (!position) return;

      const res = await apiClient.request('/attendance/check-in', 'POST', 'check_in', {
        device_id: apiClient.getDeviceIdValue() ?? 'unknown-device',
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        is_fake_gps: !!position.mocked,
        is_gps_disabled: false,
      });

      setIsCheckedIn(true);
      setCheckInTime(new Date().toLocaleTimeString());
      // Tracking is now scoped to the shift (check-in through check-out),
      // not to the login session - previously LoginScreen started this at
      // sign-in regardless of whether the officer had actually started
      // their day, so this Alert's "Live tracking started" claim used to
      // be inaccurate (tracking had already been running since login).
      //
      // Check-in itself has already succeeded at this point (the
      // attendance record exists) regardless of what happens next - only
      // the wording of the confirmation changes based on whether
      // continuous background tracking actually started. Previously this
      // was unconditional even if the officer declined the Always-upgrade
      // prompt, silently telling them tracking started when it hadn't.
      const trackingResult = await LocationService.startTracking();
      if (res?.offline) {
        // Attendance wasn't confirmed by the server yet - queued locally.
        // Tracking itself is a local OS feature and can still start
        // regardless of network, so that part of the message stays
        // accurate; only the "clocked" claim needs to change.
        Alert.alert(
          'Saved on Your Phone',
          trackingResult === 'started' || trackingResult === 'already_running'
            ? "Check-in will send when you're back online. Live tracking started now."
            : "Check-in will send when you're back online. Tracking could not start - check location settings."
        );
      } else if (trackingResult === 'started' || trackingResult === 'already_running') {
        Alert.alert('Checked In Successfully', 'Daily attendance clocked. Live tracking started.', [
          { text: 'OK', onPress: () => void promptBatterySettingsOnce() },
        ]);
      } else {
        Alert.alert(
          'Checked In - Tracking Not Active',
          'Your attendance was recorded, but continuous location tracking could not start. Please open Settings and set this app\u2019s location access to "Always Allow" so your shift is tracked correctly.'
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Check-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Field and sales officers file today's closure BEFORE ending the
      // day. Only an explicit "not closed" blocks; if the status can't be
      // read (no signal) the officer is not trapped on duty.
      const role = apiClient.getCurrentUser()?.role ?? '';
      if (role === 'field_officer' || role === 'sales_officer') {
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
                onPress: () =>
                  role === 'sales_officer'
                    ? navigation.navigate('SalesDayClosure')
                    : navigation.navigate('DailyVisitTracker', { dayClosureMode: true }),
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
    <View style={styles.container}>
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

      {loadingStatus ? null : !isCheckedIn ? (
        <TouchableOpacity style={[styles.btnCheckIn, busy && styles.btnBusy]} onPress={handleCheckIn} disabled={busy}>
          {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.btnText}>Clock In (Start Duty)</Text>}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={[styles.btnCheckOut, busy && styles.btnBusy]} onPress={handleCheckOut} disabled={busy}>
          {busy ? <ActivityIndicator color={color.white} /> : <Text style={styles.btnText}>Clock Out (End Duty)</Text>}
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.btnBack} onPress={() => navigation.goBack()}>
        <Text style={styles.btnBackText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
