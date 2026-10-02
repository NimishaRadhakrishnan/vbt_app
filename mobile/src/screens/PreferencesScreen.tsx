import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Alert, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { apiClient } from '../services/api';
import { color, font, fontWeight, spacing, radius } from '../theme';

// Single reusable Preferences screen for both Field Officer and Sales
// Officer, gated on currentUser.role - not two separate screens, per the
// brief's explicit instruction.
//
// What's real vs. not, checked against the backend before building
// anything: `users` has no phone/language/theme column and no per-user
// notification-preference table exists anywhere (NotificationModel is
// just the notification records themselves, is_read/title/message - no
// settings). expo-notifications isn't a dependency, so there's no push
// permission to show either. Rather than fake toggles for any of that,
// rows that would need it show a plain, honest explanation on tap -
// exactly the pattern this screen's own file already used for Help &
// Feedback / App Settings / Terms ("Coming soon."), not a new one.
// "Appearance" is omitted entirely rather than shown as a fake/disabled
// row: there's no theme-switching mechanism in the app at all (theme.ts
// is a static export), so there's nothing true to say about it, unlike
// Notifications where in-app notifications do genuinely exist.
//
// Location & Tracking is the one section here that's fully real: it
// reads the actual OS permission via expo-location and can deep-link to
// the system settings screen. It intentionally has no toggle to disable
// tracking - Field/Sales Officers still submit required location data
// as today, this is status + a link to the OS settings, not a
// business-logic control.
export default function PreferencesScreen({ navigation }: any) {
  const currentUser = apiClient.getCurrentUser();
  const role = currentUser?.role ?? '';
  const isFieldOfficer = role === 'field_officer';
  const isSalesOfficer = role === 'sales_officer';

  const [locationStatus, setLocationStatus] = useState<'granted' | 'denied' | 'undetermined' | null>(null);

  const refreshLocationStatus = useCallback(() => {
    if (!isFieldOfficer && !isSalesOfficer) return;
    Location.getForegroundPermissionsAsync()
      .then((res) => setLocationStatus(res.status as any))
      .catch(() => setLocationStatus(null));
  }, [isFieldOfficer, isSalesOfficer]);

  useFocusEffect(
    useCallback(() => {
      refreshLocationStatus();
    }, [refreshLocationStatus])
  );

  const initials = (currentUser?.fullName ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const roleLabel = role
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const locationStatusLabel =
    locationStatus === 'granted' ? 'Allowed' : locationStatus === 'denied' ? 'Not Allowed' : 'Checking…';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials || '?'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.profileName}>{currentUser?.fullName ?? ''}</Text>
          <Text style={styles.profileMeta}>{roleLabel}</Text>
          {currentUser?.employeeId ? (
            <Text style={styles.profileMeta}>Employee ID: {currentUser.employeeId}</Text>
          ) : null}
        </View>
      </View>

      <SectionLabel text="General" />
      <View style={styles.menu}>
        <MenuRow
          label="Notifications"
          onPress={() =>
            Alert.alert(
              'Notifications',
              'In-app notifications are available from the bell icon. Notification delivery preferences aren\'t configurable yet.'
            )
          }
        />
        <MenuRow
          label="Language"
          value="English"
          onPress={() => Alert.alert('Language', 'English is currently the only supported language.')}
          last
        />
      </View>

      {isFieldOfficer && (
        <>
          <SectionLabel text="Field Work" />
          <View style={styles.menu}>
            <MenuRow
              label="Location & Tracking"
              value={locationStatusLabel}
              onPress={() =>
                Alert.alert(
                  'Location & Tracking',
                  `Location access is currently ${locationStatusLabel.toLowerCase()}. Field visits and attendance require location, so this can't be turned off in the app - manage it from your phone's system settings if needed.`,
                  [
                    { text: 'Close', style: 'cancel' },
                    { text: 'Open Location Settings', onPress: () => Linking.openSettings() },
                  ]
                )
              }
              last
            />
          </View>
        </>
      )}

      {isSalesOfficer && (
        <>
          <SectionLabel text="Sales" />
          <View style={styles.menu}>
            <MenuRow
              label="Collection Reminders"
              onPress={() =>
                Alert.alert(
                  'Collection Reminders',
                  'Overdue-payment reminders are currently set by your admin for the whole team. Per-officer reminder settings aren\'t available yet.'
                )
              }
            />
            <MenuRow
              label="Stock Alerts"
              onPress={() =>
                Alert.alert('Stock Alerts', 'Low-stock alert preferences aren\'t configurable yet.')
              }
            />
            <MenuRow
              label="Marketing Reminders"
              onPress={() =>
                Alert.alert('Marketing Reminders', 'Marketing upload reminder preferences aren\'t configurable yet.')
              }
              last
            />
          </View>
        </>
      )}

      <SectionLabel text="Account" />
      <View style={styles.menu}>
        {/* BUG FIX: was a dead "Coming soon." stub - HelpScreen.tsx is a
            real, role-aware getting-started guide, now wired here instead
            of left as a placeholder. */}
        <MenuRow label="Help & Feedback" onPress={() => navigation.navigate('Help')} />
        <MenuRow label="Privacy Policy" onPress={() => navigation.navigate('PrivacyPolicy')} />
        <MenuRow label="Terms of Service" onPress={() => Alert.alert('Terms of Service', 'Coming soon.')} last />
      </View>
    </ScrollView>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text.toUpperCase()}</Text>;
}

function MenuRow({
  label,
  value,
  onPress,
  last,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.menuRow, last && { borderBottomWidth: 0 }]} onPress={onPress}>
      <Text style={styles.menuLabel}>{label}</Text>
      <View style={styles.menuRight}>
        {value ? <Text style={styles.menuValue}>{value}</Text> : null}
        <Text style={styles.menuChevron}>{'>'}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.screenBg,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.white,
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.lg,
  },
  avatarText: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.white,
  },
  profileName: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  profileMeta: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.textMuted,
    marginLeft: spacing.xl,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  menu: {
    backgroundColor: color.white,
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
  menuRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuValue: {
    fontSize: font.body,
    color: color.textMuted,
    marginRight: spacing.sm,
  },
  menuChevron: {
    fontSize: font.subtitle,
    color: color.textDisabled,
  },
});
