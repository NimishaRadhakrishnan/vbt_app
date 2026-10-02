import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useNavigation } from '@react-navigation/native';

import DashboardScreen from '../screens/DashboardScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import WeeklyPlanScreen from '../screens/WeeklyPlanScreen';
import KpiSummaryScreen from '../screens/KpiSummaryScreen';
import TasksScreen from '../screens/TasksScreen';
import FieldNetworkScreen from '../screens/FieldNetworkScreen';
import DailyVisitTrackerScreen from '../screens/DailyVisitTrackerScreen';
import MyVisitsScreen from '../screens/MyVisitsScreen';
import MyVisitDetailScreen from '../screens/MyVisitDetailScreen';
import DraftVisitsScreen from '../screens/DraftVisitsScreen';
import MyLeaveScreen from '../screens/MyLeaveScreen';import VisitScreen from '../screens/VisitScreen';
import FarmerScreen from '../screens/FarmerScreen';
import DealerScreen from '../screens/DealerScreen';
import CropIssueScreen from '../screens/CropIssueScreen';
import SalesDayClosureScreen from '../screens/SalesDayClosureScreen';
import MyTrackingScreen from '../screens/MyTrackingScreen';
import ProfileScreen from '../screens/ProfileScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import PreferencesScreen from '../screens/PreferencesScreen';
import AdminHomeScreen from '../screens/admin/AdminHomeScreen';
import AdminLeaveApprovalsScreen from '../screens/admin/AdminLeaveApprovalsScreen';
import AdminTasksScreen from '../screens/admin/AdminTasksScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import AdminDayClosureScreen from '../screens/admin/AdminDayClosureScreen';
import AdminMasterDataScreen from '../screens/admin/AdminMasterDataScreen';
import AdminVisitReportsScreen from '../screens/admin/AdminVisitReportsScreen';
import AdminVisitDetailScreen from '../screens/admin/AdminVisitDetailScreen';
import AdminDealersScreen from '../screens/admin/AdminDealersScreen';
import AdminStockScreen from '../screens/admin/AdminStockScreen';
import HelpScreen from '../screens/HelpScreen';
import QuickActionSheet from '../components/QuickActionSheet';
import { apiClient } from '../services/api';
import { dbService } from '../services/db';
import { color, fontWeight } from '../theme';

const Tab = createBottomTabNavigator();
const DashboardStack = createStackNavigator();
const TasksStack = createStackNavigator();
const FieldNetworkStack = createStackNavigator();
const ProfileStack = createStackNavigator();

// Design pass item 4: show who's logged in somewhere consistent across
// every screen, not just on the Profile tab - a small role badge in the
// header's right side, present via the one shared `headerOptions` object
// every stack navigator below already uses, so it's automatically on
// every screen without adding it to each one individually.
//
// Design pass item 6: paired with a small sync-status line underneath -
// now that db.ts (see that file) actually persists the offline queue
// instead of losing it, this makes that honest instead of silent: an
// officer can always see "Saved on device (N)" vs "All synced" no
// matter which screen they're on, reusing apiClient.getOnlineStatus()
// (the same online/offline source of truth ProfileScreen's own toggle
// already uses) rather than adding a second, competing notion of
// "online." Polls every 6s since queue state can change from any
// screen, not just the one currently focused, and a header component
// doesn't get navigation focus events for free.
function HeaderUserBadge() {
  const user = apiClient.getCurrentUser();
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(apiClient.getOnlineStatus());

  useEffect(() => {
    const refresh = () => {
      setIsOnline(apiClient.getOnlineStatus());
      dbService.getQueuedItems().then((items) => setPendingCount(items.length));
    };
    refresh();
    const interval = setInterval(refresh, 6000);
    return () => clearInterval(interval);
  }, []);

  if (!user) return null;
  const roleLabel = (user.role ?? '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const syncLabel = pendingCount > 0
    ? `Saved on device (${pendingCount})`
    : isOnline
      ? 'All synced'
      : 'Offline';
  const syncColor = pendingCount > 0 || !isOnline ? color.warningOnDark : color.primaryPale;

  return (
    <View style={headerBadgeStyles.container}>
      <Text style={headerBadgeStyles.name} numberOfLines={1}>{user.fullName}</Text>
      <Text style={headerBadgeStyles.role} numberOfLines={1}>{roleLabel}</Text>
      <Text style={[headerBadgeStyles.sync, { color: syncColor }]} numberOfLines={1}>{syncLabel}</Text>
    </View>
  );
}

const headerBadgeStyles = StyleSheet.create({
  container: {
    marginRight: 12,
    alignItems: 'flex-end',
  },
  name: {
    color: color.white,
    fontWeight: fontWeight.semibold,
    fontSize: 13,
    maxWidth: 120,
  },
  role: {
    color: color.white,
    opacity: 0.8,
    fontSize: 11,
  },
  sync: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    marginTop: 1,
  },
});

const headerOptions = {
  headerStyle: { backgroundColor: color.primary },
  headerTintColor: color.white,
  headerTitleStyle: { fontWeight: fontWeight.bold },
  headerRight: () => <HeaderUserBadge />,
};

// Dashboard keeps the 2 tiles that aren't part of Field Network
// (Attendance, WeeklyPlan) - the other 4 (Visit/Farmer/Dealer/CropIssue)
// moved into the Field Network tab below.
function DashboardStackScreen() {
  return (
    <DashboardStack.Navigator screenOptions={headerOptions}>
      <DashboardStack.Screen name="DashboardHome" component={DashboardScreen} options={{ title: 'VBT One' }} />
      <DashboardStack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Shift Check-In' }} />
      <DashboardStack.Screen name="WeeklyPlan" component={WeeklyPlanScreen} options={{ title: 'Weekly Plans' }} />
      <DashboardStack.Screen name="KpiSummary" component={KpiSummaryScreen} options={{ title: 'My KPIs' }} />
    </DashboardStack.Navigator>
  );
}

function TasksStackScreen() {
  return (
    <TasksStack.Navigator screenOptions={headerOptions}>
      <TasksStack.Screen name="TasksHome" component={TasksScreen} options={{ title: 'Tasks' }} />
    </TasksStack.Navigator>
  );
}

// Role gate for the Field Network stack (0c / section 2-3 role
// boundaries): Field Officers get the Daily Visit Tracker workflow +
// farmer registration + crop issue reporting, but never Dealer/Stock/
// Marketing. Sales Officers get Dealer + Marketing, but never the Daily
// Visit Tracker, Crop Health/Diagnosis, or Farmer Enquiry. Admin/Manager
// see everything, matching their oversight role elsewhere in the app.
// "Visit" (the older quick GPS check-in/out, distinct from the Daily
// Visit Tracker) stays available to both officer roles - nothing in the
// spec restricts it, and section 0b explicitly says that kind of GPS
// capture doesn't change.
function useFieldNetworkAccess() {
  const role = apiClient.getCurrentUser()?.role ?? '';
  const isFieldOfficer = role === 'field_officer';
  const isSalesOfficer = role === 'sales_officer';
  const isOversight = role === 'admin' || role === 'manager';
  return {
    showFieldOfficerScreens: isFieldOfficer || isOversight,
    showSalesOfficerScreens: isSalesOfficer || isOversight,
  };
}

function FieldNetworkStackScreen() {
  const { showFieldOfficerScreens, showSalesOfficerScreens } = useFieldNetworkAccess();

  return (
    <FieldNetworkStack.Navigator screenOptions={headerOptions}>
      <FieldNetworkStack.Screen
        name="FieldNetworkHome"
        component={FieldNetworkScreen}
        options={{ title: 'Field Network' }}
      />
      <FieldNetworkStack.Screen name="Visit" component={VisitScreen} options={{ title: 'Field Visit Log' }} />
      {showFieldOfficerScreens && (
        <FieldNetworkStack.Screen name="Farmer" component={FarmerScreen} options={{ title: 'Register Farmer' }} />
      )}
      {showSalesOfficerScreens && (
        <FieldNetworkStack.Screen name="Dealer" component={DealerScreen} options={{ title: 'Dealer Audit' }} />
      )}
      {showFieldOfficerScreens && (
        <FieldNetworkStack.Screen name="CropIssue" component={CropIssueScreen} options={{ title: 'Report Crop Issue' }} />
      )}
      {showSalesOfficerScreens && (
        <>
          {/* Sales Officers previously had no reachable day-closure
              screen at all - the logout gate pointed them at
              DailyVisitTracker, which is field-officer-only and builds
              a payload they cannot validly submit. */}
          <FieldNetworkStack.Screen
            name="SalesDayClosure"
            component={SalesDayClosureScreen}
            options={{ title: 'Day Closure' }}
          />
        </>
      )}
      {showFieldOfficerScreens && (
        <>
          <FieldNetworkStack.Screen
            name="DailyVisitTracker"
            component={DailyVisitTrackerScreen}
            options={{ title: 'Daily Visit Tracker' }}
          />
          <FieldNetworkStack.Screen name="MyVisits" component={MyVisitsScreen} options={{ title: 'My Visits' }} />
          <FieldNetworkStack.Screen name="MyVisitDetail" component={MyVisitDetailScreen} options={{ title: 'Visit Detail' }} />
          <FieldNetworkStack.Screen name="DraftVisits" component={DraftVisitsScreen} options={{ title: 'Draft Visits' }} />
        </>
      )}
    </FieldNetworkStack.Navigator>
  );
}

// Profile keeps its own stack too, so "My Leave" (section 7) can push as a
// sub-screen off Profile rather than needing a 6th tab.
function ProfileStackScreen() {
  return (
    <ProfileStack.Navigator screenOptions={headerOptions}>
      <ProfileStack.Screen name="ProfileHome" component={ProfileScreen} options={{ headerShown: false }} />
      <ProfileStack.Screen name="MyLeave" component={MyLeaveScreen} options={{ title: 'My Leave' }} />
      <ProfileStack.Screen name="Preferences" component={PreferencesScreen} options={{ title: 'My Preferences' }} />
      <ProfileStack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: 'Privacy Policy' }} />
      {/* Admin/manager-only screens (see ProfileScreen.tsx's isOversight
          gate on the "Admin Tools" row) - registering them here rather
          than adding a 6th tab keeps the 5-tab bottom nav from the
          original spec intact. */}
      <ProfileStack.Screen name="AdminHome" component={AdminHomeScreen} options={{ title: 'Admin Tools' }} />
      <ProfileStack.Screen name="AdminLeaveApprovals" component={AdminLeaveApprovalsScreen} options={{ title: 'Leave Approvals' }} />
      <ProfileStack.Screen name="AdminTasks" component={AdminTasksScreen} options={{ title: 'Task Management' }} />
      <ProfileStack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'Users' }} />
      <ProfileStack.Screen name="AdminDayClosure" component={AdminDayClosureScreen} options={{ title: 'Day Closure Overview' }} />
      <ProfileStack.Screen name="AdminMasterData" component={AdminMasterDataScreen} options={{ title: 'Master Data' }} />
      <ProfileStack.Screen name="AdminVisitReports" component={AdminVisitReportsScreen} options={{ title: 'Daily Visit Reports' }} />
      <ProfileStack.Screen name="AdminVisitDetail" component={AdminVisitDetailScreen} options={{ title: 'Visit Detail' }} />
      <ProfileStack.Screen name="AdminDealers" component={AdminDealersScreen} options={{ title: 'Dealers' }} />
      <ProfileStack.Screen name="AdminStock" component={AdminStockScreen} options={{ title: 'Stock Reconciliation' }} />
      <ProfileStack.Screen name="Help" component={HelpScreen} options={{ title: 'Help & Getting Started' }} />
    </ProfileStack.Navigator>
  );
}

// Placeholder tab component for the center "+" slot - never actually
// rendered because the tab's own tabPress listener intercepts the press
// (see QuickAction below) and opens the sheet instead of navigating here.
function QuickActionPlaceholder() {
  return <View />;
}

const TAB_ICONS: Record<string, string> = {
  DashboardTab: '🏠',
  TasksTab: '✅',
  FieldNetworkTab: '🌐',
  ProfileTab: '👤',
};

const TAB_LABELS: Record<string, string> = {
  DashboardTab: 'Dashboard',
  TasksTab: 'Tasks',
  FieldNetworkTab: 'Field Network',
  ProfileTab: 'Profile',
};

export default function TabNavigator() {
  const [sheetVisible, setSheetVisible] = useState(false);

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: color.primary,
          tabBarInactiveTintColor: '#9e9e9e',
          tabBarIcon: () =>
            route.name === 'QuickAction' ? null : <Text style={{ fontSize: 20 }}>{TAB_ICONS[route.name]}</Text>,
          tabBarLabel: route.name === 'QuickAction' ? () => null : TAB_LABELS[route.name],
        })}
      >
        <Tab.Screen name="DashboardTab" component={DashboardStackScreen} />
        <Tab.Screen name="TasksTab" component={TasksStackScreen} />
        <Tab.Screen
          name="QuickAction"
          component={QuickActionPlaceholder}
          options={{
            tabBarButton: (props) => (
              <TouchableOpacity {...props} style={styles.raisedButtonWrap} onPress={() => setSheetVisible(true)}>
                <View style={styles.raisedButton}>
                  <Text style={styles.raisedButtonText}>+</Text>
                </View>
              </TouchableOpacity>
            ),
          }}
          listeners={{
            // Belt-and-braces: the custom tabBarButton above already
            // intercepts the press, but this also blocks the default
            // "navigate to this tab" behavior if it ever fires.
            tabPress: (e) => e.preventDefault(),
          }}
        />
        <Tab.Screen name="FieldNetworkTab" component={FieldNetworkStackScreen} />
        <Tab.Screen name="ProfileTab" component={ProfileStackScreen} />
      </Tab.Navigator>

      <QuickActionSheetWithNav visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </>
  );
}

// TabNavigator's own screen components don't get a `navigation` prop for
// the tab navigator itself, so the sheet's cross-tab navigation (e.g. into
// FieldNetworkTab's nested stack) is resolved here via useNavigation()
// instead.
function QuickActionSheetWithNav({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const navigation = useNavigation<any>();

  const onNavigate = (screen: string) => {
    if (screen === 'Visit' || screen === 'CropIssue') {
      navigation.navigate('FieldNetworkTab', { screen });
    } else if (screen === 'TasksTab') {
      navigation.navigate('TasksTab');
    }
  };

  return <QuickActionSheet visible={visible} onClose={onClose} onNavigate={onNavigate} />;
}

const styles = StyleSheet.create({
  raisedButtonWrap: {
    top: -18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  raisedButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  raisedButtonText: {
    color: color.white,
    fontSize: 28,
    fontWeight: fontWeight.bold,
    marginTop: -2,
  },
});
