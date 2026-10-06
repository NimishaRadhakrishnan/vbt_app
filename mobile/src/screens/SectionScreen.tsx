import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { apiClient } from '../services/api';
import { findSection, sectionsForRole } from '../navigation/navConfig';
import SegmentedTabs from '../components/SegmentedTabs';
import ActionList from '../components/ActionList';
import { color, font, fontWeight, spacing, radius } from '../theme';

import DashboardScreen from './DashboardScreen';
import KpiSummaryScreen from './KpiSummaryScreen';
import TasksScreen from './TasksScreen';
import WeeklyPlanScreen from './WeeklyPlanScreen';
import MyLeaveScreen from './MyLeaveScreen';
import FarmerScreen from './FarmerScreen';
import DealerScreen from './DealerScreen';
import CropIssueScreen from './CropIssueScreen';
import AdminTasksScreen from './admin/AdminTasksScreen';
import AdminLeaveApprovalsScreen from './admin/AdminLeaveApprovalsScreen';
import AdminDayClosureScreen from './admin/AdminDayClosureScreen';
import AdminVisitReportsScreen from './admin/AdminVisitReportsScreen';
import AdminDealersScreen from './admin/AdminDealersScreen';
import AdminLiveMapScreen from './admin/AdminLiveMapScreen';
import AdminLocationHistoryScreen from './admin/AdminLocationHistoryScreen';
import AdminUsersScreen from './admin/AdminUsersScreen';
import AdminStockScreen from './admin/AdminStockScreen';
import AdminMasterDataScreen from './admin/AdminMasterDataScreen';

/**
 * One screen for every section. The tabs along the top come from
 * navigation/navConfig.ts (filtered for the signed-in role); each tab shows
 * an existing screen. Nothing here has its own business logic.
 *
 * Route params: { sectionId, tabId? }. Changing tabId (for example from the
 * "+" sheet) switches the tab.
 */
export default function SectionScreen({ navigation, route }: any) {
  const role = apiClient.getCurrentUser()?.role ?? '';
  const sectionId: string = route?.params?.sectionId ?? 'home';
  const section = useMemo(
    () => sectionsForRole(role).find((s) => s.id === sectionId) ?? null,
    [role, sectionId],
  );
  const wanted: string | undefined = route?.params?.tabId;
  const firstId = section?.tabs[0]?.id ?? '';
  const [tabId, setTabId] = useState<string>(wanted ?? firstId);
  // Bumped when an embedded form finishes, so it comes back empty.
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    if (wanted && section?.tabs.some((t) => t.id === wanted)) setTabId(wanted);
  }, [wanted, section]);

  if (!section) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing here for your role</Text>
        <Text style={styles.emptyText}>{findSection(sectionId)?.label ?? 'This section'} is not available to your account.</Text>
      </View>
    );
  }

  const activeId = section.tabs.some((t) => t.id === tabId) ? tabId : firstId;

  return (
    <View style={styles.container}>
      <SegmentedTabs tabs={section.tabs} activeId={activeId} onSelect={setTabId} />
      <View style={{ flex: 1 }} key={`${activeId}-${resetKey}`}>
        <TabBody
          tabId={activeId}
          role={role}
          navigation={navigation}
          onDone={() => setResetKey((k) => k + 1)}
        />
      </View>
    </View>
  );
}

// The screens below were written to be pushed onto a stack, so most take no
// props. Cast once here instead of at every use.
const as = (c: unknown) => c as React.ComponentType<any>;

function TabBody({ tabId, role, navigation, onDone }: { tabId: string; role: string; navigation: any; onDone: () => void }) {
  const isOversight = role === 'admin' || role === 'manager';
  const isAdmin = role === 'admin';
  const go = (screen: string, params?: object) => navigation.navigate(screen, params);

  switch (tabId) {
    // Home
    case 'today': {
      const C = as(DashboardScreen);
      return <C navigation={navigation} />;
    }
    case 'progress': {
      const C = as(KpiSummaryScreen);
      return <C navigation={navigation} />;
    }

    // Work
    case 'tasks': {
      const C = as(isOversight ? AdminTasksScreen : TasksScreen);
      return <C navigation={navigation} />;
    }
    case 'plans': {
      const C = as(WeeklyPlanScreen);
      return <C navigation={navigation} embedded onDone={onDone} />;
    }
    case 'closure': {
      if (!isOversight) {
        const isSales = role === 'sales_officer';
        return (
          <ActionList
            items={[
              {
                icon: 'document-text-outline',
                title: "Close today's work",
                subtitle: isSales ? 'Dealer visits and orders for the day' : 'Visits, farmers and results for the day',
                onPress: () => (isSales ? go('SalesDayClosure') : go('DailyVisitTracker', { dayClosureMode: true })),
              },
            ]}
          />
        );
      }
      const C = as(AdminDayClosureScreen);
      return (
        <View style={{ flex: 1 }}>
          <View style={styles.chips}>
            <Chip icon="receipt-outline" label="Sales closures" onPress={() => go('AdminSalesClosures')} />
            {isAdmin && <Chip icon="create-outline" label="File missed closure" onPress={() => go('AdminFileClosure')} />}
          </View>
          <C navigation={navigation} />
        </View>
      );
    }
    case 'leave': {
      const C = as(isOversight ? AdminLeaveApprovalsScreen : MyLeaveScreen);
      return <C navigation={navigation} />;
    }

    // Field
    case 'visits': {
      if (isOversight) {
        const C = as(AdminVisitReportsScreen);
        return <C navigation={navigation} />;
      }
      const items = [
        ...(role === 'field_officer'
          ? [
              { icon: 'add-circle-outline', title: 'New visit', subtitle: 'Full visit with farmer, crop and results', onPress: () => go('DailyVisitTracker') },
            ]
          : []),
        { icon: 'location-outline', title: 'Quick check-in / out', subtitle: 'Log arrival and departure with GPS', onPress: () => go('Visit') },
        ...(role === 'field_officer'
          ? [
              { icon: 'create-outline', title: 'Drafts', subtitle: 'Visits saved to finish later', onPress: () => go('DraftVisits') },
              { icon: 'list-outline', title: 'My visits', subtitle: 'Everything you have submitted', onPress: () => go('MyVisits') },
            ]
          : []),
      ];
      return <ActionList items={items} />;
    }
    case 'farmers': {
      const C = as(FarmerScreen);
      return <C navigation={navigation} embedded onDone={onDone} />;
    }
    case 'dealers': {
      const C = as(isOversight ? AdminDealersScreen : DealerScreen);
      return isOversight ? <C navigation={navigation} /> : <C navigation={navigation} embedded onDone={onDone} />;
    }
    case 'issues': {
      const C = as(CropIssueScreen);
      return <C navigation={navigation} embedded onDone={onDone} />;
    }

    // Team
    case 'live': {
      const C = as(AdminLiveMapScreen);
      return <C navigation={navigation} />;
    }
    case 'history': {
      const C = as(AdminLocationHistoryScreen);
      return <C navigation={navigation} />;
    }
    case 'people': {
      const C = as(AdminUsersScreen);
      return <C navigation={navigation} />;
    }

    // Stock
    case 'issue':
    case 'with-officers':
    case 'stock-history': {
      const C = as(AdminStockScreen);
      const initialTab = tabId === 'issue' ? 'issue' : tabId === 'with-officers' ? 'recon' : 'ledger';
      return <C initialTab={initialTab} hideTabs />;
    }

    // Setup
    case 'master-data': {
      const C = as(AdminMasterDataScreen);
      return <C navigation={navigation} />;
    }

    default:
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Coming soon</Text>
        </View>
      );
  }
}

function Chip({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon as any} size={16} color={color.primary} />
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.screenBg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: color.screenBg },
  emptyTitle: { fontSize: font.subtitle, fontWeight: fontWeight.semibold, color: color.textPrimary },
  emptyText: { fontSize: font.body, color: color.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: color.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primary,
  },
  chipText: { fontSize: font.body, color: color.primary, fontWeight: fontWeight.semibold },
});
