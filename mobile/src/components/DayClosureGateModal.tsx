import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { apiClient } from '../services/api';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Props = {
  visible: boolean;
  onCancel: () => void;
  onSubmitted: () => void;
};

// Blocks logout for field/sales officers until today's closure is
// submitted - mirrors the web frontend's handleLogoutClick /
// handleSubmitDayClosure pattern exactly (same endpoint, same "no skip
// option" rule). See day_closure_router.py's own docstring: this is a
// client-side gate, the backend only tracks the submission.
//
// Previously this required a photo/document upload as the only real
// content. Replaced per direct request with a short self-reported daily
// pulse-check (farmers visited, villages covered, demos, conversions),
// matching the same four numbers the web version now asks - not a
// re-entry of the Daily Visit Tracker's per-visit detail, just a quick
// end-of-day total.
export default function DayClosureGateModal({ visible, onCancel, onSubmitted }: Props) {
  const [farmersVisited, setFarmersVisited] = useState('');
  const [villagesCovered, setVillagesCovered] = useState('');
  const [demosConducted, setDemosConducted] = useState('');
  const [conversions, setConversions] = useState('');
  const [blockers, setBlockers] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setFarmersVisited('');
    setVillagesCovered('');
    setDemosConducted('');
    setConversions('');
    setBlockers('');
    setNotes('');
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleSubmit = async () => {
    if (farmersVisited === '' || villagesCovered === '' || demosConducted === '' || conversions === '') {
      Alert.alert('Missing Info', 'Please fill in all four numbers before logging out.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiClient.request('/day-closure', 'POST', 'task_action', {
        farmers_visited: parseInt(farmersVisited, 10) || 0,
        villages_covered: parseInt(villagesCovered, 10) || 0,
        demos_conducted: parseInt(demosConducted, 10) || 0,
        conversions: parseInt(conversions, 10) || 0,
        blockers: blockers.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      reset();
      if (res?.offline) {
        // The whole point of this gate is "confirm today's closure is
        // submitted before logging out" - a queued-not-yet-sent closure
        // hasn't actually reached the server, so say so plainly rather
        // than implying it's done. Logout still proceeds either way
        // (same as the rest of the app's fail-open behavior) since
        // blocking logout indefinitely for connectivity would violate
        // the "impossible to get stuck in" goal just as badly as a false
        // success would violate the "no silent data loss" one - the
        // closure is safely queued and will sync automatically.
        Alert.alert(
          'Saved on Your Phone',
          "No connection right now, so today's closure will send automatically once you're back online. You can still log out."
        );
      }
      onSubmitted();
    } catch (err: any) {
      Alert.alert('Could Not Submit', err.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Submit Today's Closure</Text>
          <Text style={styles.subtitle}>
            Answer these quick questions before you log out.
          </Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.row}>
              <View style={styles.halfField}>
                <Text style={styles.fieldLabel}>Farmers Visited *</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="0"
                  placeholderTextColor={color.textMuted}
                  value={farmersVisited}
                  onChangeText={setFarmersVisited}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.halfField}>
                <Text style={styles.fieldLabel}>Villages Covered *</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="0"
                  placeholderTextColor={color.textMuted}
                  value={villagesCovered}
                  onChangeText={setVillagesCovered}
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.halfField}>
                <Text style={styles.fieldLabel}>Demos Conducted *</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="0"
                  placeholderTextColor={color.textMuted}
                  value={demosConducted}
                  onChangeText={setDemosConducted}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.halfField}>
                <Text style={styles.fieldLabel}>Conversions *</Text>
                <TextInput
                  style={styles.numberInput}
                  placeholder="0"
                  placeholderTextColor={color.textMuted}
                  value={conversions}
                  onChangeText={setConversions}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <TextInput
              style={styles.notesInput}
              placeholder="Blockers or issues today? (optional)"
              placeholderTextColor={color.textMuted}
              value={blockers}
              onChangeText={setBlockers}
              multiline
            />
            <TextInput
              style={styles.notesInput}
              placeholder="Notes (optional)"
              placeholderTextColor={color.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} disabled={submitting}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator color={color.white} /> : <Text style={styles.submitText}>Submit & Log Out</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: color.overlay,
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  card: {
    backgroundColor: color.white,
    borderRadius: radius.lg,
    padding: 22,
    maxHeight: '85%',
  },
  title: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.primary,
  },
  subtitle: {
    fontSize: font.body,
    color: color.textSecondary,
    marginTop: 6,
    marginBottom: 18,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  halfField: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: font.caption,
    fontWeight: fontWeight.semibold,
    color: color.textSecondary,
    marginBottom: 4,
  },
  numberInput: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    color: color.textPrimary,
  },
  notesInput: {
    backgroundColor: color.screenBg,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    color: color.textPrimary,
    minHeight: 50,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  cancelText: {
    color: color.textMuted,
    fontWeight: fontWeight.semibold,
  },
  submitBtn: {
    backgroundColor: color.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    minWidth: 140,
    alignItems: 'center',
  },
  submitText: {
    color: color.white,
    fontWeight: fontWeight.bold,
  },
});
