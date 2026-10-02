import React, { useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Alert, ActivityIndicator } from 'react-native';
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
  email: string;
};

// GET /users (no role restriction beyond being signed in - any
// authenticated user can list, matching user_management_router.py) and
// POST /users/{id}/status to activate/deactivate (ADMIN-only server
// side - require_role(Role.ADMIN)). A manager can see this screen and
// read the roster, but the toggle 403s for them, so it's hidden here for
// anyone who isn't an admin rather than offering a button that always
// fails.
export default function AdminUsersScreen() {
  const currentUser = apiClient.getCurrentUser();
  const isAdmin = currentUser?.role === 'admin';
  const [actingId, setActingId] = useState<string | null>(null);

  const { data, loading, error, retry } = useDataFetch<{ items: UserRow[] }>(
    () => apiClient.request('/users?limit=200', 'GET', 'admin_action'),
    []
  );

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
  const items = data?.items ?? [];
  if (items.length === 0) return <EmptyState message="No users found." />;

  return (
    <FlatList
      style={styles.container}
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
            <Text style={[styles.statusBadge, { color: item.is_active ? color.success : color.error }]}>
              {item.is_active ? 'Active' : 'Inactive'}
            </Text>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  name: { fontSize: font.subtitle, fontWeight: fontWeight.bold, color: color.textPrimary },
  meta: { fontSize: font.caption, color: color.textSecondary, marginTop: 2 },
  statusBadge: { fontSize: font.caption, fontWeight: fontWeight.bold, marginTop: spacing.xs },
  toggleBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, minWidth: 92, alignItems: 'center' },
  toggleText: { color: color.white, fontSize: font.caption, fontWeight: fontWeight.bold },
});
