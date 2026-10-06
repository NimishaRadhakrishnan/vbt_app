import React, { useState } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, FlatList, Alert, ActivityIndicator,
  Modal, ScrollView, TextInput, Switch,
} from 'react-native';
import { apiClient } from '../../services/api';
import { useDataFetch } from '../../hooks/useDataFetch';
import { LoadingState, ErrorState, EmptyState } from '../../components/FetchStates';
import { color, font, fontWeight, spacing, radius } from '../../theme';

type UserRow = {
  id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  employee_id?: string | null;
  phone?: string | null;
  email: string;
};

const ROLES = ['field_officer', 'sales_officer', 'manager', 'admin'] as const;

type ProfileForm = { phone: string; password: string; full_name: string; role: string; employee_id: string };
const emptyProfileForm: ProfileForm = { phone: '', password: '', full_name: '', role: 'field_officer', employee_id: '' };

// Closes the single biggest web/mobile gap from the parity audit: mobile
// could only list users and flip active/inactive. Everything else - create
// a new officer, edit their profile, reset a forgotten password, (re)assign
// them to a manager, and delete/restore an account - existed only on web.
// Every call below mirrors the exact endpoint + body shape the web dashboard
// uses (frontend/app/dashboard/page.tsx), so this is the same feature, not a
// reinterpretation of it.
export default function AdminUsersScreen() {
  const currentUser = apiClient.getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
  const [actingId, setActingId] = useState<string | null>(null);

  const { data, loading, error, retry } = useDataFetch<{ items: UserRow[] }>(
    () => apiClient.request('/users?limit=200', 'GET', 'admin_action'),
    []
  );
  const items = data?.items ?? [];

  // --- Create / Edit profile modal ---
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileForm>(emptyProfileForm);
  const [profileSaving, setProfileSaving] = useState(false);

  const openCreate = () => {
    setIsCreatingUser(true);
    setEditingUserId(null);
    setProfileForm(emptyProfileForm);
    setProfileModalOpen(true);
  };
  const openEditProfile = (user: UserRow) => {
    setIsCreatingUser(false);
    setEditingUserId(user.id);
    setProfileForm({ phone: user.phone ?? '', password: '', full_name: user.full_name, role: user.role, employee_id: user.employee_id ?? '' });
    setProfileModalOpen(true);
  };
  const saveProfile = async () => {
    if (!profileForm.full_name.trim() || !profileForm.employee_id.trim()) {
      Alert.alert('Missing Info', 'Name and Employee ID are required. The Employee ID is what this person signs in with.');
      return;
    }
    if (isCreatingUser && !profileForm.password.trim()) {
      Alert.alert('Missing Info', 'Set a password for the new account.');
      return;
    }
    setProfileSaving(true);
    try {
      if (isCreatingUser) {
        await apiClient.request('/users', 'POST', 'admin_action', {
          phone: profileForm.phone.trim() || undefined,
          password: profileForm.password,
          full_name: profileForm.full_name.trim(),
          role: profileForm.role,
          employee_id: profileForm.employee_id.trim(),
        });
        Alert.alert('User Created', `${profileForm.full_name} can now sign in.`);
      } else if (editingUserId) {
        await apiClient.request(`/users/${editingUserId}`, 'PUT', 'admin_action', {
          phone: profileForm.phone.trim() || undefined,
          full_name: profileForm.full_name.trim(),
          role: profileForm.role,
          employee_id: profileForm.employee_id.trim(),
        });
        Alert.alert('Saved', 'Profile updated.');
      }
      setProfileModalOpen(false);
      retry();
    } catch (err: any) {
      Alert.alert('Could Not Save', err?.message ?? 'Please try again.');
    } finally {
      setProfileSaving(false);
    }
  };

  // --- Reset password modal ---
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetSaving, setResetSaving] = useState(false);
  const saveReset = async () => {
    if (!resetUserId) return;
    if (!resetPassword.trim()) {
      Alert.alert('Missing Info', 'Enter a new password.');
      return;
    }
    setResetSaving(true);
    try {
      await apiClient.request(`/users/${resetUserId}/reset-password`, 'POST', 'admin_action', { password: resetPassword });
      Alert.alert('Password Reset', "The officer's password has been changed.");
      setResetUserId(null);
      setResetPassword('');
    } catch (err: any) {
      Alert.alert('Could Not Reset', err?.message ?? 'Please try again.');
    } finally {
      setResetSaving(false);
    }
  };

  // --- Assignments modal (manager/device) ---
  const [assignUser, setAssignUser] = useState<UserRow | null>(null);
  const [assignManagerId, setAssignManagerId] = useState<string | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  const managers = items.filter((u) => u.role === 'manager' || u.role === 'admin');
  const openAssign = (user: UserRow) => {
    setAssignUser(user);
    setAssignManagerId(null);
  };
  const saveAssign = async () => {
    if (!assignUser) return;
    setAssignSaving(true);
    try {
      await apiClient.request(`/users/${assignUser.id}/assignments`, 'POST', 'admin_action', {
        manager_id: assignManagerId,
        device_id: null,
        territory_ids: [], // matches web - left empty there too
      });
      Alert.alert('Saved', `${assignUser.full_name}'s manager assignment was updated.`);
      setAssignUser(null);
    } catch (err: any) {
      Alert.alert('Could Not Save', err?.message ?? 'Please try again.');
    } finally {
      setAssignSaving(false);
    }
  };

  // --- Delete / restore ---
  const deleteUser = async (user: UserRow) => {
    if (user.id === currentUser?.id) {
      Alert.alert('Not Allowed', 'You cannot delete your own account.');
      return;
    }
    let impact: { can_hard_delete: boolean; counts?: Record<string, number> } | null = null;
    try {
      impact = await apiClient.request(`/users/${user.id}/delete-impact`, 'GET', 'admin_action');
    } catch {
      // fall through with impact null - still allow the attempt, matching
      // web's behaviour of not blocking the whole delete flow on this check
    }
    const title = impact?.can_hard_delete ? 'Delete Account' : 'Archive Account';
    const message = impact?.can_hard_delete
      ? `${user.full_name} has no visit history tied to them and will be permanently deleted. This cannot be undone.`
      : `${user.full_name} has existing records (visits, closures, etc.) so the account will be archived (deactivated and hidden) rather than erased.`;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: impact?.can_hard_delete ? 'Delete' : 'Archive',
        style: 'destructive',
        onPress: async () => {
          setActingId(user.id);
          try {
            await apiClient.request(`/admin/users/${user.id}`, 'DELETE', 'admin_action');
            retry();
          } catch (err: any) {
            Alert.alert('Could Not Delete', err?.message ?? 'Please try again.');
          } finally {
            setActingId(null);
          }
        },
      },
    ]);
  };

  const toggleStatus = (user: UserRow) => {
    if (user.id === currentUser?.id) {
      Alert.alert('Not Allowed', 'You cannot deactivate your own account.');
      return;
    }
    Alert.alert(
      user.is_active ? 'Deactivate Account' : 'Activate Account',
      `${user.is_active ? 'Deactivate' : 'Activate'} ${user.full_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: user.is_active ? 'destructive' : 'default',
          onPress: async () => {
            setActingId(user.id);
            try {
              await apiClient.request(`/users/${user.id}/status`, 'POST', 'admin_action', {
                is_active: !user.is_active,
              });
              retry();
            } catch (err: any) {
              Alert.alert('Could Not Update', err?.message ?? 'Please try again.');
            } finally {
              setActingId(null);
            }
          },
        },
      ]
    );
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={retry} />;

  return (
    <View style={styles.container}>
      {isAdmin && (
        <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
          <Text style={styles.addBtnText}>+ Add User</Text>
        </TouchableOpacity>
      )}

      {items.length === 0 ? (
        <EmptyState message="No users found." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ padding: spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.full_name}</Text>
                <Text style={styles.meta}>
                  {item.role.replace('_', ' ')}{item.employee_id ? ` · ${item.employee_id}` : ''}
                </Text>
                {!!item.phone && <Text style={styles.meta}>{item.phone}</Text>}
                <Text style={[styles.statusBadge, { color: item.is_active ? color.success : color.error }]}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </Text>

                {isAdmin && (
                  <View style={styles.actionsRow}>
                    <SmallBtn label="Edit" onPress={() => openEditProfile(item)} />
                    <SmallBtn label="Reset PW" onPress={() => { setResetUserId(item.id); setResetPassword(''); }} />
                    <SmallBtn label="Assign" onPress={() => openAssign(item)} />
                    <SmallBtn label="Delete" danger onPress={() => deleteUser(item)} />
                  </View>
                )}
              </View>
              {isAdmin && (
                <TouchableOpacity
                  style={[styles.toggleBtn, { backgroundColor: item.is_active ? color.error : color.success }]}
                  disabled={actingId === item.id}
                  onPress={() => toggleStatus(item)}
                >
                  {actingId === item.id ? (
                    <ActivityIndicator color={color.white} size="small" />
                  ) : (
                    <Text style={styles.toggleText}>{item.is_active ? 'Deactivate' : 'Activate'}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}

      {/* Create / Edit profile modal */}
      <Modal visible={profileModalOpen} animationType="slide" transparent onRequestClose={() => setProfileModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView>
              <Text style={styles.modalTitle}>{isCreatingUser ? 'Add User' : 'Edit User'}</Text>
              <FieldLabel text="Full Name" />
              <TextInput style={styles.input} value={profileForm.full_name} onChangeText={(v) => setProfileForm((f) => ({ ...f, full_name: v }))} />
              <FieldLabel text="Employee ID *" />
              <TextInput style={styles.input} value={profileForm.employee_id} onChangeText={(v) => setProfileForm((f) => ({ ...f, employee_id: v }))} autoCapitalize="characters" />
              <FieldLabel text="Phone Number (Optional)" />
              <TextInput style={styles.input} value={profileForm.phone} onChangeText={(v) => setProfileForm((f) => ({ ...f, phone: v }))} keyboardType="phone-pad" />
              {isCreatingUser && (
                <>
                  <FieldLabel text="Password" />
                  <TextInput style={styles.input} value={profileForm.password} onChangeText={(v) => setProfileForm((f) => ({ ...f, password: v }))} secureTextEntry />
                </>
              )}
              <FieldLabel text="Role" />
              <View style={styles.roleRow}>
                {ROLES.map((r) => (
                  <TouchableOpacity key={r} style={[styles.roleChip, profileForm.role === r && styles.roleChipActive]} onPress={() => setProfileForm((f) => ({ ...f, role: r }))}>
                    <Text style={[styles.roleChipText, profileForm.role === r && styles.roleChipTextActive]}>{r.replace('_', ' ')}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.modalBtnRow}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setProfileModalOpen(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSaveBtn} disabled={profileSaving} onPress={saveProfile}>
                  {profileSaving ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.modalSaveText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Reset password modal */}
      <Modal visible={!!resetUserId} animationType="slide" transparent onRequestClose={() => setResetUserId(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reset Password</Text>
            <FieldLabel text="New Password" />
            <TextInput style={styles.input} value={resetPassword} onChangeText={setResetPassword} secureTextEntry />
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setResetUserId(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} disabled={resetSaving} onPress={saveReset}>
                {resetSaving ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.modalSaveText}>Reset</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Assignments modal */}
      <Modal visible={!!assignUser} animationType="slide" transparent onRequestClose={() => setAssignUser(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Assign Manager</Text>
            <Text style={styles.meta}>{assignUser?.full_name}</Text>
            <ScrollView style={{ maxHeight: 220, marginTop: spacing.md }}>
              <TouchableOpacity style={[styles.roleChip, assignManagerId === null && styles.roleChipActive]} onPress={() => setAssignManagerId(null)}>
                <Text style={[styles.roleChipText, assignManagerId === null && styles.roleChipTextActive]}>No manager</Text>
              </TouchableOpacity>
              {managers.filter((m) => m.id !== assignUser?.id).map((m) => (
                <TouchableOpacity key={m.id} style={[styles.roleChip, assignManagerId === m.id && styles.roleChipActive]} onPress={() => setAssignManagerId(m.id)}>
                  <Text style={[styles.roleChipText, assignManagerId === m.id && styles.roleChipTextActive]}>{m.full_name} ({m.role})</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setAssignUser(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} disabled={assignSaving} onPress={saveAssign}>
                {assignSaving ? <ActivityIndicator color={color.white} size="small" /> : <Text style={styles.modalSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.fieldLabel}>{text}</Text>;
}

function SmallBtn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity style={[styles.smallBtn, danger && styles.smallBtnDanger]} onPress={onPress}>
      <Text style={[styles.smallBtnText, danger && styles.smallBtnTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  addBtn: { margin: spacing.lg, backgroundColor: color.primary, paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center' },
  addBtnText: { color: color.white, fontWeight: fontWeight.bold },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  statusBadge: { fontSize: font.caption, fontWeight: fontWeight.bold, marginTop: 4 },
  toggleBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, minWidth: 92, alignItems: 'center' },
  toggleText: { color: color.white, fontSize: font.caption, fontWeight: fontWeight.bold },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: color.border, backgroundColor: color.screenBg },
  smallBtnDanger: { borderColor: color.error },
  smallBtnText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textPrimary },
  smallBtnTextDanger: { color: color.error },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: color.cardBg, borderRadius: radius.md, padding: spacing.lg, maxHeight: '85%' },
  modalTitle: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary, marginBottom: spacing.md },
  fieldLabel: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, padding: spacing.sm, fontSize: font.body, color: color.textPrimary },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  roleChip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border, backgroundColor: color.screenBg, marginBottom: spacing.xs },
  roleChipActive: { backgroundColor: color.primary, borderColor: color.primary },
  roleChipText: { fontSize: font.caption, fontWeight: fontWeight.semibold, color: color.textPrimary },
  roleChipTextActive: { color: color.white },
  modalBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.sm },
  modalCancelText: { color: color.textSecondary, fontWeight: fontWeight.semibold },
  modalSaveBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.sm, backgroundColor: color.primary, minWidth: 80, alignItems: 'center' },
  modalSaveText: { color: color.white, fontWeight: fontWeight.bold },
});
