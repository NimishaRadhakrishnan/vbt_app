import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { apiClient } from '../services/api';
import { LocationService } from '../services/LocationService';
import { color, font, fontWeight, spacing, radius } from '../theme';
import { MORE_SECTION_IDS, sectionsForRole } from '../navigation/navConfig';

// Roles the day-closure gate applies to - mirrors the web frontend's
// `requiresDayClosure` check exactly (app/dashboard/page.tsx). Admin and
// manager accounts don't submit field closure documents, so they're not
// gated.
const DAY_CLOSURE_ROLES = ['field_officer', 'sales_officer'];

// Card-style Profile tab: avatar, name, employee ID, role/designation, and
// an online/offline status badge - moved here from DashboardScreen's header
// since it's session/identity state, not a dashboard widget.
//
// Day Closure's content changed twice this session: first a photo
// upload, then a 4-number summary, and per the latest request it's now
// the full Daily Visit Tracker form (crop profile, health diagnosis,
// demo/trial, sales, photos). Rather than build that ~40-field form a
// third time in a modal, the gate now sends the officer to the existing
// DailyVisitTrackerScreen with `dayClosureMode: true` - same screen, same
// 9 steps, just POSTs to /day-closure instead of
// /visits/daily-tracker/submit (see that screen's own comment on
// isDayClosureMode). One form, reused, not a fourth implementation of it.
//
// NOT YET RESOLVED: DailyVisitTrackerScreen is only registered in the
// Field Officer's stack (TabNavigator.tsx gates it behind
// showFieldOfficerScreens) - Sales Officers can't reach it at all, and
// the crop/farm-visit content doesn't fit their job anyway. This wiring
// only actually works end-to-end for field_officer right now; a Sales
// Officer hitting this gate will fail to navigate. Flagging rather than
// guessing what their version of "day closure" should be.
export default function ProfileScreen({ navigation }: any) {
  const [isOnline, setIsOnline] = useState(apiClient.getOnlineStatus());
  const currentUser = apiClient.getCurrentUser();
  // Team, Stock, Library and Setup: the sections that are not on the bottom bar.
  const moreSections = sectionsForRole(currentUser?.role).filter((s) => MORE_SECTION_IDS.includes(s.id));

  const toggleNetwork = (value: boolean) => {
    setIsOnline(value);
    apiClient.setOnlineStatus(value);
  };

  const performLogout = async () => {
    // Same defensive safety net as before: tracking is really
    // started/stopped by AttendanceScreen's check-in/check-out, but
    // this stops it unconditionally in case an officer signs out
    // mid-shift without checking out first. No-op if nothing is
    // running, so always safe to call.
    await LocationService.stopTracking();
    apiClient.logout();
    // Profile now sits inside its own nested stack (Tab > ProfileStack
    // > ProfileHome), so getParent() once only reaches ProfileStack -
    // need to go up twice to reach the outer auth stack that owns
    // 'Login'.
    navigation.getParent()?.getParent()?.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Sign out of the app?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          const role = currentUser?.role ?? '';
          if (!DAY_CLOSURE_ROLES.includes(role)) {
            await performLogout();
            return;
          }
          try {
            const closureStatus: any = await apiClient.request('/day-closure/status', 'GET', 'task_action');
            if (closureStatus?.closed_today) {
              await performLogout();
            } else {
              Alert.alert(
                "Today's Closure Required",
                "You haven't submitted today's closure yet. Please fill it in before signing out.",
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Go to Day Closure',
                    onPress: () => {
                      // Sales Officers submit a DEALER closure, not a
                      // farm visit - different screen, different
                      // payload. Both live in FieldNetworkTab's stack,
                      // each registered behind its own role gate.
                      if (role === 'sales_officer') {
                        navigation.navigate('SalesDayClosure');
                        return;
                      }
                      navigation.navigate('DailyVisitTracker', { dayClosureMode: true });
                    },
                  },
                ]
              );
            }
          } catch (err) {
            // Same fail-open rule as the web frontend: if we can't verify
            // status, don't trap the officer out of the app - proceed.
            await performLogout();
          }
        },
      },
    ]);
  };

  const initials = (currentUser?.fullName ?? 'FO')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials || 'FO'}</Text>
        </View>
        <Text style={styles.name}>{currentUser?.fullName ?? 'Field Officer'}</Text>
        <Text style={styles.meta}>
          {currentUser?.employeeId ? `ID: ${currentUser.employeeId}` : ''}
        </Text>
        <Text style={styles.meta}>{currentUser?.role ?? ''}</Text>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? color.success : color.textMuted }]} />
          <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
          <Switch
            value={isOnline}
            onValueChange={toggleNetwork}
            trackColor={{ false: color.border, true: color.primaryLight }}
            thumbColor={isOnline ? color.primary : color.textSecondary}
            style={{ marginLeft: 10 }}
          />
        </View>
      </View>

      <View style={styles.menu}>
        {moreSections.map((section) => (
          <MenuRow
            key={section.id}
            label={section.label}
            onPress={() => navigation.navigate('Section', { sectionId: section.id })}
          />
        ))}
        <MenuRow label="Help & Getting Started" onPress={() => navigation.navigate('Help')} />
        <MenuRow label="My Preferences" onPress={() => navigation.navigate('Preferences')} />
        {/* BUG FIX: the backend tells a blocked check-in "you can find it
            on the home screen", but until now nothing navigated to
            LocationDisclosure from anywhere in the app - this is that
            promised, always-reachable entry point (also reachable
            automatically right after login and from the check-in button
            itself - see LoginScreen.tsx / AttendanceScreen.tsx). Letting
            an officer open this on demand also covers the case where
            they tapped "Not now" once and want to revisit the decision
            without having to log out and back in. */}
        <MenuRow label="Location Notice" onPress={() => navigation.getParent()?.getParent()?.navigate('LocationDisclosure', { onAcceptNavigateTo: 'back' })} />
        {/* Spec (Phase 2, section 3) asked for this placeholder row to be
            replaced with a real screen - PrivacyPolicyScreen exists and
            is registered on this stack, but nothing here ever linked to
            it. */}
        <MenuRow label="Privacy Policy" onPress={() => navigation.navigate('PrivacyPolicy')} />
        <MenuRow label="Sign Out" onPress={handleLogout} destructive last />
      </View>
    </ScrollView>
  );
}

function MenuRow({
  label,
  onPress,
  destructive,
  disabled,
  last,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuRow, last && { borderBottomWidth: 0 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.menuLabel, destructive && { color: color.errorText }, disabled && { color: color.success }]}>
        {label}
      </Text>
      {!disabled && <Text style={styles.menuChevron}>{'>'}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  card: {
    backgroundColor: color.primary,
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: spacing.xl,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    fontSize: font.heading,
    fontWeight: fontWeight.bold,
    color: color.primary,
  },
  name: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.white,
  },
  meta: {
    fontSize: font.body,
    color: color.primaryPale,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: font.body,
    fontWeight: fontWeight.semibold,
    color: color.white,
  },
  menu: {
    backgroundColor: color.white,
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  menuLabel: {
    fontSize: font.subtitle,
    color: color.textPrimary,
  },
  menuChevron: {
    fontSize: font.subtitle,
    color: color.textDisabled,
  },
});
