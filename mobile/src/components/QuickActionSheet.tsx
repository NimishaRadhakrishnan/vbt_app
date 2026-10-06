import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../services/api';
import { color, font, fontWeight, spacing, radius } from '../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onNavigate: (screen: string) => void;
};

// Bottom sheet opened by the center "+" tab. Deep-links into existing
// screens rather than building new forms - see 1.3 of the nav spec.
export default function QuickActionSheet({ visible, onClose, onNavigate }: Props) {
  const role = apiClient.getCurrentUser()?.role ?? '';
  const canCreateTasks = role === 'admin' || role === 'manager';
  const isFieldOfficer = role === 'field_officer' || role === 'admin' || role === 'manager';
  const isSalesOfficer = role === 'sales_officer' || role === 'admin' || role === 'manager';

  const go = (screen: string) => {
    onClose();
    onNavigate(screen);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Quick Actions</Text>

        <TouchableOpacity style={styles.row} onPress={() => go('Visit')}>
          <Ionicons name="car-outline" size={24} color={color.primary} style={{ width: 40 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>New Visit</Text>
            <Text style={styles.rowDesc}>Start a farmer or dealer visit</Text>
          </View>
        </TouchableOpacity>

        {canCreateTasks && (
          <TouchableOpacity style={styles.row} onPress={() => go('TasksTab')}>
            <Ionicons name="create-outline" size={24} color={color.primary} style={{ width: 40 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>New Task</Text>
              <Text style={styles.rowDesc}>Assign a task to an officer</Text>
            </View>
          </TouchableOpacity>
        )}

        {isFieldOfficer && (
          <TouchableOpacity style={styles.row} onPress={() => go('CropIssue')}>
            <Ionicons name="bug-outline" size={24} color={color.primary} style={{ width: 40 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>New Crop Issue</Text>
              <Text style={styles.rowDesc}>Report a disease with a photo</Text>
            </View>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: color.overlay,
  },
  sheet: {
    backgroundColor: color.cardBg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl + spacing.xs,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#dddddd',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: color.borderLight,
  },
  rowEmoji: {
    fontSize: font.heading + 2,
    marginRight: spacing.md + 2,
  },
  rowTitle: {
    fontSize: font.body + 1,
    fontWeight: fontWeight.semibold,
    color: color.textPrimary,
  },
  rowDesc: {
    fontSize: font.caption,
    color: color.textMuted,
    marginTop: 2,
  },
  cancelBtn: {
    marginTop: spacing.lg,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  cancelText: {
    fontSize: font.body + 1,
    fontWeight: fontWeight.semibold,
    color: color.errorText,
  },
});
