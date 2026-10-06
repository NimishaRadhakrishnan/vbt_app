import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useNavigation } from '@react-navigation/native';

import DashboardScreen from '../screens/DashboardScreen';
import AttendanceScreen from '../screens/AttendanceScreen';
import WeeklyPlanScreen from '../screens/WeeklyPlanScreen';
import KpiSummaryScreen from '../screens/KpiSummaryScreen';
import DailyVisitTrackerScreen from '../screens/DailyVisitTrackerScreen';
import MyVisitsScreen from '../screens/MyVisitsScreen';
import MyVisitDetailScreen from '../screens/MyVisitDetailScreen';
import DraftVisitsScreen from '../screens/DraftVisitsScreen';
import VisitScreen from '../screens/VisitScreen';
import FarmerScreen from '../screens/FarmerScreen';
import DealerScreen from '../screens/DealerScreen';
import CropIssueScreen from '../screens/CropIssueScreen';
import SalesDayClosureScreen from '../screens/SalesDayClosureScreen';
import MyTrackingScreen from '../screens/MyTrackingScreen';
import MoreScreen from '../screens/ProfileScreen';
import PrivacyPolicyScreen from '../screens/PrivacyPolicyScreen';
import PreferencesScreen from '../screens/PreferencesScreen';
import AdminSalesClosuresScreen from '../screens/admin/AdminSalesClosuresScreen';
import AdminVisitDetailScreen from '../screens/admin/AdminVisitDetailScreen';
import AdminFileClosureScreen from '../screens/admin/AdminFileClosureScreen';
import HelpScreen from '../screens/HelpScreen';
import SectionScreen from '../screens/SectionScreen';
import { Ionicons } from '@expo/vector-icons';
import { findSection } from './navConfig';
import QuickActionSheet from '../components/QuickActionSheet';
import { apiClient } from '../services/api';
import { useTrackingWatchdog } from '../hooks/useTrackingWatchdog';
import { dbService } from '../services/db';
import { color, fontWeight } from '../theme';

const Tab = createBottomTabNavigator();
const HomeStack = createStackNavigator();
const WorkStack = createStackNavigator();
const FieldStack = createStackNavigator();
const MoreStack = createStackNavigator();

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

// Screens that open on top of a section (forms, details, flows). Every tab's
// stack registers the same set, so a section can open any of them by name
// without hopping between tabs. Role gates are the same as before: the
// visit tracker family is for field officers and oversight, the closure
// admin screens for oversight only. The API enforces all of this anyway.
function usePushedScreens() {
  const role = apiClient.getCurrentUser()?.role ?? '';
  const isOversight = role === 'admin' || role === 'manager';
  const isFieldOrOversight = role === 'field_officer' || isOversight;
  return { role, isOversight, isFieldOrOversight };
}

function renderPushedScreens(Stack: ReturnType<typeof createStackNavigator>, access: ReturnType<typeof usePushedScreens>) {
  const { isOversight, isFieldOrOversight, role } = access;
  const isSalesOrOversight = role === 'sales_officer' || isOversight;
  return (
    <>
      <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Shift Check-In' }} />
      <Stack.Screen name="WeeklyPlan" component={WeeklyPlanScreen} options={{ title: 'Weekly Plan' }} />
      <Stack.Screen name="KpiSummary" component={KpiSummaryScreen} options={{ title: 'My KPIs' }} />
      <Stack.Screen name="Visit" component={VisitScreen} options={{ title: 'Quick Check-In' }} />
      {isFieldOrOversight && <Stack.Screen name="Farmer" component={FarmerScreen} options={{ title: 'Register Farmer' }} />}
      {isSalesOrOversight && <Stack.Screen name="Dealer" component={DealerScreen} options={{ title: 'Dealer Audit' }} />}
      {isFieldOrOversight && <Stack.Screen name="CropIssue" component={CropIssueScreen} options={{ title: 'Report Crop Issue' }} />}
      {isSalesOrOversight && <Stack.Screen name="SalesDayClosure" component={SalesDayClosureScreen} options={{ title: 'Day Closure' }} />}
      {isFieldOrOversight && (
        <>
          {/* DailyVisitTracker doubles as the field officer's day closure
              (dayClosureMode) and, with adminOfficerId, as an admin
              filing a missed closure. */}
          <Stack.Screen name="DailyVisitTracker" component={DailyVisitTrackerScreen} options={{ title: 'Daily Visit Tracker' }} />
          <Stack.Screen name="MyVisits" component={MyVisitsScreen} options={{ title: 'My Visits' }} />
          <Stack.Screen name="MyVisitDetail" component={MyVisitDetailScreen} options={{ title: 'Visit Detail' }} />
          <Stack.Screen name="DraftVisits" component={DraftVisitsScreen} options={{ title: 'Draft Visits' }} />
        </>
      )}
      {isOversight && (
        <>
          <Stack.Screen name="AdminVisitDetail" component={AdminVisitDetailScreen} options={{ title: 'Visit Detail' }} />
          <Stack.Screen name="AdminSalesClosures" component={AdminSalesClosuresScreen} options={{ title: 'Sales Day Closures' }} />
          {role === 'admin' && (
            <Stack.Screen name="AdminFileClosure" component={AdminFileClosureScreen} options={{ title: 'File Missed Closure' }} />
          )}
        </>
      )}
      <Stack.Screen name="Preferences" component={PreferencesScreen} options={{ title: 'My Preferences' }} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'Help & Getting Started' }} />
    </>
  );
}

// The title is the section's name; the tabs inside it are in the strip.
const sectionTitle = ({ route }: any) => ({ title: findSection(route.params?.sectionId)?.label ?? 'VBT One' });

function HomeStackScreen() {
  const access = usePushedScreens();
  return (
    <HomeStack.Navigator screenOptions={headerOptions}>
      <HomeStack.Screen name="Section" component={SectionScreen} initialParams={{ sectionId: 'home' }} options={{ title: 'VBT One' }} />
      {renderPushedScreens(HomeStack, access)}
    </HomeStack.Navigator>
  );
}

function WorkStackScreen() {
  const access = usePushedScreens();
  return (
    <WorkStack.Navigator screenOptions={headerOptions}>
      <WorkStack.Screen name="Section" component={SectionScreen} initialParams={{ sectionId: 'work' }} options={sectionTitle} />
      {renderPushedScreens(WorkStack, access)}
    </WorkStack.Navigator>
  );
}

function FieldStackScreen() {
  const access = usePushedScreens();
  return (
    <FieldStack.Navigator screenOptions={headerOptions}>
      <FieldStack.Screen name="Section" component={SectionScreen} initialParams={{ sectionId: 'field' }} options={sectionTitle} />
      {renderPushedScreens(FieldStack, access)}
    </FieldStack.Navigator>
  );
}

// More: account + the sections that are not on the bottom bar. Team, Stock,
// Library and Setup open as ordinary Section screens from here.
function MoreStackScreen() {
  const access = usePushedScreens();
  return (
    <MoreStack.Navigator screenOptions={headerOptions}>
      <MoreStack.Screen name="MoreHome" component={MoreScreen} options={{ headerShown: false }} />
      <MoreStack.Screen name="Section" component={SectionScreen} options={sectionTitle} />
      {renderPushedScreens(MoreStack, access)}
    </MoreStack.Navigator>
  );
}

// Placeholder tab component for the center "+" slot - never actually
// rendered because the tab's own tabPress listener intercepts the press
// (see QuickAction below) and opens the sheet instead of navigating here.
function QuickActionPlaceholder() {
  return <View />;
}

const TAB_ICONS: Record<string, [string, string]> = {
  HomeTab: ['home', 'home-outline'],
  WorkTab: ['checkbox', 'checkbox-outline'],
  FieldTab: ['leaf', 'leaf-outline'],
  MoreTab: ['menu', 'menu-outline'],
};

const TAB_LABELS: Record<string, string> = {
  HomeTab: 'Home',
  WorkTab: 'Work',
  FieldTab: 'Field',
  MoreTab: 'More',
};

export default function TabNavigator() {
  const [sheetVisible, setSheetVisible] = useState(false);
  const role = apiClient.getCurrentUser()?.role;
  useTrackingWatchdog(role === 'field_officer' || role === 'sales_officer');

  return (
    <>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: color.primary,
          tabBarInactiveTintColor: '#757575',
          tabBarLabelStyle: { fontSize: 12, fontWeight: fontWeight.semibold },
          tabBarIcon: ({ focused, color: tint }) => {
            if (route.name === 'QuickAction') return null;
            const [on, off] = TAB_ICONS[route.name] ?? ['ellipse', 'ellipse-outline'];
            return <Ionicons name={(focused ? on : off) as any} size={24} color={tint} />;
          },
          tabBarLabel: route.name === 'QuickAction' ? () => null : TAB_LABELS[route.name],
        })}
      >
        <Tab.Screen name="HomeTab" component={HomeStackScreen} />
        <Tab.Screen name="WorkTab" component={WorkStackScreen} />
        <Tab.Screen
          name="QuickAction"
          component={QuickActionPlaceholder}
          options={{
            tabBarButton: (props) => (
              <TouchableOpacity
                {...props}
                style={styles.raisedButtonWrap}
                onPress={() => setSheetVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Quick actions"
              >
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
        <Tab.Screen name="FieldTab" component={FieldStackScreen} />
        <Tab.Screen name="MoreTab" component={MoreStackScreen} />
      </Tab.Navigator>

      <QuickActionSheetWithNav visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </>
  );
}

// TabNavigator's own screen components don't get a `navigation` prop for
// the tab navigator itself, so the sheet's cross-tab navigation is resolved
// here via useNavigation() instead.
function QuickActionSheetWithNav({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const navigation = useNavigation<any>();

  const onNavigate = (screen: string) => {
    if (screen === 'Visit' || screen === 'CropIssue') {
      navigation.navigate('FieldTab', { screen });
    } else if (screen === 'TasksTab') {
      navigation.navigate('WorkTab', { screen: 'Section', params: { sectionId: 'work', tabId: 'tasks' } });
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
