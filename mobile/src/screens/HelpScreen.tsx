import React from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { apiClient } from '../services/api';
import { color, font, fontWeight, spacing, radius } from '../theme';

/**
 * Plain-language "how do I..." guide, reachable from Profile without
 * needing anyone to explain the app first - the request this answers is
 * "a basic/beginner officer must be able to use the app without
 * guidance." It doesn't replace good in-app empty-state/error copy
 * (which the rest of the app already has), it's the one place an officer
 * can go when they genuinely don't know where to start.
 *
 * Content is role-aware: a field officer doesn't need to be told what
 * Admin Tools does, and an admin's day doesn't revolve around checking
 * in. Kept short on purpose - a long manual defeats the point for
 * someone who wants an answer in ten seconds.
 */
export default function HelpScreen() {
  const role = apiClient.getCurrentUser()?.role ?? '';
  const isFieldOfficer = role === 'field_officer';
  const isSalesOfficer = role === 'sales_officer';
  const isOversight = role === 'admin' || role === 'manager';

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <Topic title="How do I start and end my day?">
        Go to Dashboard → Shift / Attendance → Clock In when you start work, and Clock Out when you finish.
        The first time you clock in, you'll be asked to read and accept a short notice about location -
        this only happens once. Your location is only recorded between Clock In and Clock Out, never after.
      </Topic>

      {isFieldOfficer && (
        <>
          <Topic title="How do I log a farm visit?">
            Tap the green + button at the bottom of the screen, or go to Field Network → Daily Visit Tracker.
            Fill in the 9 short steps - you can save it as a draft at any point and come back to finish it
            later from Field Network → Draft Visits.
          </Topic>
          <Topic title="How do I see my past visits?">
            Field Network → My Visits shows everything you've submitted. Tap any visit to see its full detail.
          </Topic>
        </>
      )}

      <Topic title="How do I submit my Day Closure?">
        You'll be asked for this automatically when you try to sign out if you haven't done it yet that day.
        You can also do it any time from Profile → Submit Day Closure, so you don't have to wait until
        you're trying to leave.
      </Topic>

      <Topic title="How do I apply for leave?">
        Profile → My Leave. Pick your dates and leave type, write a short reason, and submit. You'll see
        whether it's pending, approved, or rejected on the same screen.
      </Topic>

      <Topic title="How do I see my tasks?">
        The Tasks tab shows everything assigned to you, grouped by status. Overdue tasks are marked in red.
      </Topic>

      <Topic title="What if I'm offline?">
        The app still works. Anything you submit while offline is saved on your phone and sent automatically
        once you're back online - you'll see "Saved on device" at the top of the screen until it syncs.
      </Topic>

      {isSalesOfficer && (
        <>
          <Topic title="How do I register a dealer?">
            Field Network → Dealer. The app checks for likely duplicates (same phone, GST, or name and
            district) before saving, so you don't create the same dealer twice by accident.
          </Topic>
          <Topic title="How do I check my stock?">
            Field Network → My Stock shows what you currently have for every product. Use Adjust Stock
            whenever you give out, sell, or lose any of it - always give a reason, since every change is
            kept in a permanent history.
          </Topic>
        </>
      )}

      {isOversight && (
        <Topic title="What's in Admin Tools?">
          Profile → Admin Tools has everything you need to manage officers and approvals from your phone:
          leave approvals, task assignment and review, who hasn't submitted today's closure, user accounts,
          every officer's visit reports, dealer approvals and orders, and stock reconciliation. Master Data
          (crops, pests, diseases, etc.) is available there too if you're an administrator.
        </Topic>
      )}

      <Topic title="Something looks wrong or stuck">
        Pull down on most list screens to refresh. If a screen shows "Couldn't connect," tap it to retry.
        If something still doesn't look right, contact your admin - they can see the same records you do
        from the web console.
      </Topic>
    </ScrollView>
  );
}

function Topic({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.primary,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: font.body,
    color: color.textPrimary,
    lineHeight: 21,
  },
});
