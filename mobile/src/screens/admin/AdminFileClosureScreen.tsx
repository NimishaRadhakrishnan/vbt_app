import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type SimpleUser = { id: string; full_name: string; role: string; employee_id?: string | null };

// Mobile equivalent of web's Admin "Add Day Closure" action, which was an
// orphaned endpoint on mobile - POST /admin/day-closures existed and
// worked on web (letting an admin file today's closure on behalf of an
// officer who forgot), but mobile had no screen that reached it at all.
// Rather than duplicate the 9-step Daily Visit Tracker form, this screen
// is just the officer picker: once one is chosen it pushes the SAME
// DailyVisitTrackerScreen used everywhere else, with adminOfficerId set,
// which redirects that screen's single submit call to
// /admin/day-closures?officer_id=... instead of /day-closure - identical
// field set, identical validation, matching web's DayClosureForm
// adminOfficerId prop exactly (see that component's own comment).
export default function AdminFileClosureScreen({ navigation }: any) {
  const [officerId, setOfficerId] = useState<string | null>(null);

  const { data, loading, error, retry } = useDataFetch<SimpleUser[]>(
    () => apiClient.request('/users?limit=200', 'GET', 'admin_action'),
    []
  );
  const officers = (data ?? []).filter((u) => u.role === 'field_officer' || u.role === 'sales_officer');

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;
  if (officers.length === 0) return <EmptyState message="No field or sales officers found." />;

  return (
    <View style={styles.container}>
      <Text style={styles.intro}>
        Pick the officer who missed their closure. You'll fill out the same form they would, and it will be filed
        under today's date for them.
      </Text>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {officers.map((o) => (
          <TouchableOpacity
            key={o.id}
            style={[styles.card, officerId === o.id && styles.cardActive]}
            onPress={() => setOfficerId(o.id)}
          >
            <Text style={[styles.name, officerId === o.id && styles.nameActive]}>{o.full_name}</Text>
            <Text style={styles.meta}>
              {o.role.replace('_', ' ')}{o.employee_id ? ` · ${o.employee_id}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity
        style={[styles.continueBtn, !officerId && styles.continueBtnDisabled]}
        disabled={!officerId}
        onPress={() => navigation.navigate('DailyVisitTracker', { adminOfficerId: officerId, dayClosureMode: true })}
      >
        <Text style={styles.continueBtnText}>Continue to Closure Form</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  intro: { fontSize: font.body, color: color.textSecondary, padding: spacing.lg, paddingBottom: 0 },
  card: {
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardActive: { borderColor: color.primary, borderWidth: 2 },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  nameActive: { color: color.primary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  continueBtn: {
    margin: spacing.lg,
    backgroundColor: color.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { color: color.white, fontWeight: fontWeight.bold },
});
