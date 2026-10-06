import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { apiClient } from '../services/api';
import { ConsentService } from '../services/consent';
import { color, font, fontWeight, spacing, radius } from '../theme';

export default function LoginScreen({ navigation }: any) {
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const handleLogin = async () => {
    if (!employeeId || !password) {
      Alert.alert('Required Fields', 'Please enter your Employee ID and password.');
      return;
    }
    setSigningIn(true);
    try {
      await apiClient.login(employeeId.trim(), password);
      // GPS tracking is scoped to check-in/check-out (AttendanceScreen),
      // not to login/logout - being signed in doesn't mean being on shift.
      // Previously this started background tracking right at login, which
      // meant tracking ran continuously from sign-in until sign-out
      // regardless of whether the officer had actually started their day.
      //
      // BUG FIX: this previously always went straight to 'Tabs', so the
      // LocationDisclosure screen (built, registered in AppNavigator, but
      // never navigated to from anywhere) was completely unreachable in
      // normal use. Google requires this disclosure in-app before the OS
      // permission prompt, and the backend independently refuses
      // check-in until it has an acceptance on record - so an officer who
      // never saw this screen could grant the OS permission yet still get
      // blocked at check-in with a confusing server error. Checking
      // status here (one fast network call right after login, before the
      // officer has done anything else) is the normal path everyone
      // should see it on; AttendanceScreen below is the safety-net path
      // for anyone who declined here and later wants to check in.
      let alreadyAccepted = true;
      try {
        const status = await ConsentService.getStatus();
        alreadyAccepted = status.accepted;
      } catch {
        // If this fails for some reason, fail open to Tabs rather than
        // stranding the officer on a blank screen - AttendanceScreen's
        // own check still protects check-in either way.
        alreadyAccepted = true;
      }
      if (alreadyAccepted) {
        navigation.replace('Tabs');
      } else {
        navigation.replace('LocationDisclosure', { onAcceptNavigateTo: 'Tabs' });
      }
    } catch (err: any) {
      // Previously this showed the same generic "wrong password" text for
      // every possible failure - including a device-binding rejection,
      // where the officer's password is actually correct and retrying it
      // will never succeed. That's a real trap: they'd assume a typo and
      // keep retrying instead of contacting an admin.
      //
      // This matches on a distinctive substring of the backend's exact
      // message (LoginUserUseCase: "This account is bound to another
      // mobile device."), NOT on the response's `code` field - the
      // backend currently returns the same code ("invalid_credentials")
      // for both wrong-password and device-mismatch, so code-based
      // matching isn't available without a backend change beyond what
      // was asked here. String-matching a backend message is inherently
      // fragile: if that message text is ever reworded without updating
      // this check, it silently falls back to the generic message with
      // no build-time warning. Deliberately matching only a distinctive
      // middle phrase (not the full sentence, not exact punctuation)
      // to survive minor rewording, but this is not a robust contract -
      // a dedicated error code from the backend would be the real fix.
      const rawMessage: string = err?.message || '';
      if (rawMessage.includes('bound to another mobile device')) {
        Alert.alert(
          'Device Not Recognized',
          'This account is already linked to a different device. Please contact your admin to reset your device access before signing in - retrying your password will not fix this.'
        );
      } else {
        Alert.alert('Sign In Failed', 'Wrong Employee ID or password. Please try again.');
      }
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Vishakan Biotech</Text>
        <Text style={styles.cardSubtitle}>Sign in to access your dashboard</Text>

        <TextInput
          style={styles.input}
          placeholder="Employee ID or Mobile Number"
          placeholderTextColor={color.textMuted}
          value={employeeId}
          onChangeText={setEmployeeId}
          autoCapitalize="characters"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={color.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={signingIn}>
          {signingIn ? (
            <ActivityIndicator color={color.white} />
          ) : (
            <Text style={styles.loginBtnText}>Sign In</Text>
          )}
        </TouchableOpacity>

        {/* Reachable before sign-in - Play Store expects the privacy
            policy to be accessible without an account. See
            AppNavigator.tsx for why this screen is registered at the
            root level as well as inside ProfileStack. */}
        <TouchableOpacity
          style={styles.privacyLink}
          onPress={() => navigation.navigate('PrivacyPolicy')}
        >
          <Text style={styles.privacyLinkText}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.primary,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    shadowColor: color.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 8,
  },
  cardTitle: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  cardSubtitle: {
    fontSize: font.body,
    color: color.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  input: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.subtitle,
    color: color.textPrimary,
    marginBottom: spacing.lg,
  },
  deviceNotice: {
    fontSize: font.caption,
    color: color.errorText,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  loginBtn: {
    backgroundColor: color.primary,
    borderRadius: radius.sm,
    padding: 14,
    alignItems: 'center',
  },
  loginBtnText: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.white,
  },
  privacyLink: {
    marginTop: spacing.lg,
    alignItems: 'center',
    // Keeps the tap target at the 44dp minimum even though the label
    // itself is small text.
    paddingVertical: spacing.md,
  },
  privacyLinkText: {
    fontSize: font.caption,
    color: color.textMuted,
  },
});
