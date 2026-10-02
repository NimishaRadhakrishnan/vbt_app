import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { apiClient } from '../../services/api';
import { color, font, fontWeight, spacing, radius } from '../../theme';

/**
 * Real admin/manager surface on mobile.
 *
 * Previously admin and manager accounts logged into the exact same five
 * tabs a field officer sees, with none of the oversight actions the web
 * admin console already has (approve leave, assign/review tasks, manage
 * users, review day closures, manage master data, browse all officers'
 * visits) exposed anywhere in the app - "they are like a normal officer"
 * was an accurate complaint, not a misunderstanding. This screen is the
 * single entry point into that real functionality (reached from
 * Profile > Admin Tools, gated to admin/manager there), each tile wired
 * to the same backend endpoints the web console already uses - no mock
 * data, no placeholder counts.
 *
 * Master Data and full user create/edit are ADMIN-only at the API layer
 * (require_role(Role.ADMIN) in master_data_router.py / user_management_
 * router.py) - a manager can open those screens to look, but write
 * actions there will 403, so those two tiles are hidden for managers
 * rather than showing a button that always fails.
 */
export default function AdminHomeScreen({ navigation }: any) {
  const role = apiClient.getCurrentUser()?.role ?? '';
  const isAdmin = role === 'admin';

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.intro}>
        Tools for managing officers, approvals, and reference data - the same records the web admin console uses.
      </Text>

      <Tile
        icon="🗓️"
        title="Leave Approvals"
        desc="Approve or reject pending leave requests"
        onPress={() => navigation.navigate('AdminLeaveApprovals')}
      />
      <Tile
        icon="✅"
        title="Task Management"
        desc="Review submitted work, assign new tasks"
        onPress={() => navigation.navigate('AdminTasks')}
      />
      <Tile
        icon="📋"
        title="Day Closure Overview"
        desc="See who hasn't closed today, review past closures"
        onPress={() => navigation.navigate('AdminDayClosure')}
      />
      <Tile
        icon="🧑‍🤝‍🧑"
        title="Users"
        desc="View all officers, activate/deactivate accounts"
        onPress={() => navigation.navigate('AdminUsers')}
      />
      <Tile
        icon="🌾"
        title="Daily Visit Reports"
        desc="Browse every officer's submitted visits"
        onPress={() => navigation.navigate('AdminVisitReports')}
      />
      <Tile
        icon="🏪"
        title="Dealers"
        desc="Approve new dealers, see every order"
        onPress={() => navigation.navigate('AdminDealers')}
      />
      <Tile
        icon="📦"
        title="Stock Reconciliation"
        desc="Allocated, given, sold and on-hand per officer"
        onPress={() => navigation.navigate('AdminStock')}
      />
      {isAdmin && (
        <Tile
          icon="🗂️"
          title="Master Data"
          desc="Crops, pests, diseases, chemicals and more"
          onPress={() => navigation.navigate('AdminMasterData')}
        />
      )}
    </ScrollView>
  );
}

function Tile({ icon, title, desc, onPress }: { icon: string; title: string; desc: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <Text style={styles.tileIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDesc}>{desc}</Text>
      </View>
      <Text style={styles.chevron}>{'>'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  intro: {
    fontSize: font.body,
    color: color.textSecondary,
    marginBottom: spacing.lg,
  },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.cardBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  tileIcon: {
    fontSize: font.heading,
    marginRight: spacing.lg,
  },
  tileTitle: {
    fontSize: font.subtitle,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  tileDesc: {
    fontSize: font.caption,
    color: color.textSecondary,
    marginTop: 2,
  },
  chevron: {
    fontSize: font.subtitle,
    color: color.textDisabled,
    marginLeft: spacing.sm,
  },
});
