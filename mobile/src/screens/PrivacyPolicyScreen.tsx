import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { color, font, fontWeight, spacing, radius } from '../theme';

// Same content, same URL, as the publicly hosted page at
// frontend/app/privacy/page.tsx - kept in sync manually since there's no
// shared CMS here. If the wording changes, update both files together.
const PRIVACY_POLICY_URL = 'https://vishakanbiotech.com/privacy';
const LAST_UPDATED = 'August 24, 2026';
const CONTACT_EMAIL = 'privacy@vishakanbiotech.com';

export default function PrivacyPolicyScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Privacy Policy</Text>
      <Text style={styles.updated}>Last updated: {LAST_UPDATED}</Text>

      <Section title="What this app collects">
        <Bullet text="Your name, employee ID, and role" />
        <Bullet text="Your location, while you're checked in for work" />
        <Bullet text="Photos you take for visit and crop issue reports" />
        <Bullet text="Your task, visit, and leave records" />
      </Section>

      <Section title="Why we collect it">
        <Bullet text="We use your location to confirm your field visits really happened, and to record your attendance." />
        <Bullet text="We use your photos as proof for visit and crop issue reports." />
        <Bullet text="We use your task, visit, and leave records to run day-to-day field operations." />
      </Section>

      <Section title="Who can see it">
        <Text style={styles.paragraph}>
          Your manager and company admins, for work purposes only. We don't sell your data or share it with
          anyone outside the company.
        </Text>
      </Section>

      <Section title="When location tracking happens">
        <Text style={styles.paragraph}>
          Only while you're checked in during company working hours (9 AM–6 PM). Tracking stops the moment
          you check out. We don't track your location on personal time.
        </Text>
      </Section>

      <Section title="How long we keep it">
        <Text style={styles.paragraph}>
          We keep your work records for as long as you're employed with us, and for 24 months after your last
          working day.
        </Text>
      </Section>

      <Section title="Your choices">
        <Text style={styles.paragraph}>
          You can ask your manager or an admin to see or correct your own data at any time.
        </Text>
      </Section>

      <Section title="Contact">
        <Text style={styles.paragraph}>
          Questions about this policy? Write to{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>
            {CONTACT_EMAIL}
          </Text>
          .
        </Text>
      </Section>

      <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} style={styles.webLinkBtn}>
        <Text style={styles.webLinkText}>View this policy online</Text>
      </TouchableOpacity>

      <Text style={styles.reviewNote}>
        Note for the team: retention period and contact address above are placeholders pending sign-off from
        whoever owns compliance/HR — update both this screen and the public page together before publishing.
      </Text>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.white,
  },
  content: {
    padding: spacing.xl,
    paddingBottom: 40,
  },
  title: {
    fontSize: font.title,
    fontWeight: fontWeight.bold,
    color: color.primary,
  },
  updated: {
    fontSize: font.caption,
    color: color.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginBottom: spacing.sm,
  },
  paragraph: {
    fontSize: font.body,
    color: color.textSecondary,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  bulletDot: {
    fontSize: font.body,
    color: color.primary,
    marginRight: spacing.sm,
  },
  bulletText: {
    fontSize: font.body,
    color: color.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  link: {
    color: color.primary,
    fontWeight: fontWeight.semibold,
  },
  webLinkBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.primary,
  },
  webLinkText: {
    color: color.primary,
    fontWeight: fontWeight.bold,
    fontSize: font.body,
  },
  reviewNote: {
    fontSize: font.caption,
    color: color.textDisabled,
    marginTop: spacing.xxl,
    fontStyle: 'italic',
  },
});
