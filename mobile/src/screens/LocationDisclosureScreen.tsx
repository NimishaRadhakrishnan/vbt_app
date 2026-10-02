/**
 * PHASE 3A ITEMS 6 + 8 — prominent disclosure, and a genuine "Not now".
 *
 * Google requires the disclosure to appear IN THE APP and BEFORE the OS
 * permission prompt - a privacy policy link is not sufficient, and
 * neither is a toast or a line of small print. This screen is that
 * disclosure.
 *
 * Placement: after login, before the first check-in, and before any
 * location permission is requested. Registered at the root stack (see
 * AppNavigator) rather than inside a tab, so nothing behind it is
 * reachable while it is up.
 *
 * On "Not now" the app must genuinely still work. A disclosure whose
 * decline path is a dead end is coerced consent - it fails the policy's
 * intent, and a reviewer who taps "Not now" and finds themselves stuck
 * will read it as exactly that. So declining returns the officer to the
 * app: they can see their tasks, their profile, their leave, their
 * knowledge search. Only check-in is blocked, because check-in is the
 * action that starts tracking, and that is an honest boundary rather
 * than a punishment.
 *
 * Wording follows the app-wide rule of simple language with no
 * onboarding screens: five short blocks, no jargon, no scrolling
 * required on a normal phone.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ConsentService } from '../services/consent';
import { DisclosureContent } from '../constants/disclosure';
import { color, font, fontWeight, radius, spacing } from '../theme';

interface Props {
  navigation: any;
  route: {
    params?: {
      /**
       * Where to go after accepting. Defaults to 'Tabs'. Set to
       * 'back' when the screen is opened from the check-in button, so
       * the officer lands where they were instead of at the dashboard.
       */
      onAcceptNavigateTo?: 'Tabs' | 'back';
    };
  };
}

export default function LocationDisclosureScreen({ navigation, route }: Props) {
  const [disclosure, setDisclosure] = useState<DisclosureContent | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const target = route?.params?.onAcceptNavigateTo ?? 'Tabs';

  useEffect(() => {
    let cancelled = false;
    ConsentService.getStatus()
      .then((status) => {
        if (cancelled) return;
        setDisclosure(status.disclosure);
        setUsedFallback(status.usedFallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAccept = async () => {
    if (!disclosure || submitting) return;
    setSubmitting(true);
    try {
      await ConsentService.accept(disclosure.version, usedFallback);
      if (target === 'back') {
        navigation.goBack();
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
      }
    } catch (err: any) {
      Alert.alert('Could Not Save', err?.message ?? 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = () => {
    // No scare dialog, no "are you sure you want to lose access". State
    // the one real consequence and let them through.
    Alert.alert(
      'No Problem',
      'You can use the app as normal. You just will not be able to check in until you agree to this, because checking in is what turns location recording on.',
      [
        {
          text: 'OK',
          onPress: () => {
            if (target === 'back') {
              navigation.goBack();
            } else {
              navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
            }
          },
        },
      ]
    );
  };

  if (loading || !disclosure) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={color.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{disclosure.title}</Text>

        {disclosure.points.map((point) => (
          <View key={point.label} style={styles.block}>
            <Text style={styles.blockLabel}>{point.label}</Text>
            <Text style={styles.blockText}>{point.text}</Text>
          </View>
        ))}

        <View style={styles.footerBox}>
          <Text style={styles.footerText}>{disclosure.footer}</Text>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('PrivacyPolicy')}>
          <Text style={styles.link}>Read the full privacy policy</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Actions pinned outside the ScrollView so they are always visible
          without scrolling - a disclosure whose Accept button is below
          the fold invites tapping without reading, which is the exact
          behaviour this screen exists to prevent. */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primaryButton, submitting && styles.buttonDisabled]}
          onPress={handleAccept}
          disabled={submitting}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color={color.white} />
          ) : (
            <Text style={styles.primaryButtonText}>I understand, continue</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleDecline}
          disabled={submitting}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryButtonText}>Not now</Text>
        </TouchableOpacity>
      </View>
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
  content: { padding: spacing.xl, paddingBottom: spacing.xxl },
  title: {
    fontSize: font.heading,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginBottom: spacing.xl,
  },
  block: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  blockLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.bold,
    color: color.primary,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  blockText: {
    fontSize: font.subtitle,
    color: color.textPrimary,
    lineHeight: 24,
  },
  footerBox: {
    backgroundColor: color.warningBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.warningBorder,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  footerText: { fontSize: font.body, color: color.textPrimary, lineHeight: 21 },
  link: {
    fontSize: font.body,
    color: color.info,
    marginTop: spacing.lg,
    textDecorationLine: 'underline',
  },
  actions: {
    padding: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.cardBg,
  },
  primaryButton: {
    backgroundColor: color.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: color.white,
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
  },
  buttonDisabled: { opacity: 0.6 },
  secondaryButton: { paddingVertical: spacing.lg, alignItems: 'center' },
  secondaryButtonText: {
    color: color.textSecondary,
    fontSize: font.subtitle,
    fontWeight: fontWeight.semibold,
  },
});
