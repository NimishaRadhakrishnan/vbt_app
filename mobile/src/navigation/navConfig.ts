/**
 * Android navigation map. Mirrors frontend/lib/navigation.ts: same seven
 * sections, same tab names, same role rules (both follow the backend's
 * require_role checks). If you change one file, change the other.
 *
 * The bottom bar shows Home, Work, +, Field, More. Team, Stock, Library and
 * Setup live under More, listed only for roles that can use them.
 *
 * `ready: false` hides a tab until its screen exists, so nobody ever sees a
 * dead entry. Old names stay in `aliases` for one release (search + hints).
 */

export type NavRole = 'admin' | 'manager' | 'field_officer' | 'sales_officer';

export interface NavTab {
  id: string;
  label: string;
  aliases: string[];
  roles: NavRole[];
  ready: boolean;
}

export interface NavSection {
  id: string;
  label: string;
  icon: string; // Ionicons name
  tabs: NavTab[];
}

const ALL: NavRole[] = ['admin', 'manager', 'field_officer', 'sales_officer'];
const OVERSIGHT: NavRole[] = ['admin', 'manager'];
const OFFICERS: NavRole[] = ['field_officer', 'sales_officer'];

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home-outline',
    tabs: [
      { id: 'today', label: 'Today', aliases: ['Dashboard', 'Overview'], roles: ALL, ready: true },
      { id: 'progress', label: 'Progress', aliases: ['My KPIs', 'Productivity', 'Momentum'], roles: OFFICERS, ready: true },
      { id: 'tracking', label: 'Tracking', aliases: ['My location', 'Location tracking'], roles: OFFICERS, ready: true },
    ],
  },
  {
    id: 'work',
    label: 'Work',
    icon: 'checkbox-outline',
    tabs: [
      { id: 'tasks', label: 'Tasks', aliases: ['My Tasks', 'Task Management'], roles: ALL, ready: true },
      { id: 'plans', label: 'Plans', aliases: ['Weekly Plans', 'Weekly Plan'], roles: ALL, ready: true },
      { id: 'closure', label: 'Closure', aliases: ['Day Closure', 'Day Closure Overview', 'Sales Day Closures', 'File Missed Closure'], roles: ALL, ready: true },
      { id: 'leave', label: 'Leave', aliases: ['My Leave', 'Leave Approvals'], roles: ALL, ready: true },
    ],
  },
  {
    id: 'field',
    label: 'Field',
    icon: 'leaf-outline',
    tabs: [
      { id: 'visits', label: 'Visits', aliases: ['Daily Visit Tracker', 'Field Visit Log', 'My Visits', 'Draft Visits', 'Daily Visit Reports'], roles: ALL, ready: true },
      { id: 'farmers', label: 'Farmers', aliases: ['Register Farmer'], roles: ['admin', 'manager', 'field_officer'], ready: true },
      { id: 'dealers', label: 'Dealers', aliases: ['Dealer Audit'], roles: ['admin', 'manager', 'sales_officer'], ready: true },
      { id: 'issues', label: 'Issues', aliases: ['Crop Disease Issues', 'Report Crop Issue'], roles: ['admin', 'manager', 'field_officer'], ready: true },
      { id: 'enquiries', label: 'Enquiries', aliases: ['Farmer Enquiry'], roles: ['admin', 'manager', 'field_officer'], ready: true },
      { id: 'my-stock', label: 'My Stock', aliases: ['Stock in hand'], roles: OFFICERS, ready: true },
    ],
  },
  {
    id: 'team',
    label: 'Team',
    icon: 'people-outline',
    tabs: [
      { id: 'live', label: 'Live', aliases: ["Team's Live Location", 'Live Tracking Map'], roles: OVERSIGHT, ready: true },
      { id: 'history', label: 'History', aliases: ['Movement History'], roles: OVERSIGHT, ready: true },
      { id: 'alerts', label: 'Alerts', aliases: ['Location alerts', 'Territory alerts'], roles: OVERSIGHT, ready: true },
      { id: 'territories', label: 'Territories', aliases: ['Geofence', 'Territory areas'], roles: ['admin'], ready: true },
      { id: 'attendance', label: 'Attendance', aliases: ['Attendance Log'], roles: OVERSIGHT, ready: true },
      { id: 'people', label: 'People', aliases: ['Users', 'User Management'], roles: ['admin'], ready: true },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    icon: 'cube-outline',
    tabs: [
      { id: 'issue', label: 'Issue', aliases: ['Stock Management', 'Issue Stock'], roles: OVERSIGHT, ready: true },
      { id: 'with-officers', label: 'With Officers', aliases: ['Stock with Officers'], roles: OVERSIGHT, ready: true },
      { id: 'stock-history', label: 'History', aliases: ['Ledger', 'Stock movement'], roles: OVERSIGHT, ready: true },
      { id: 'products', label: 'Products', aliases: ['Products and pricing'], roles: ['admin'], ready: true },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    icon: 'book-outline',
    tabs: [
      { id: 'knowledge', label: 'Knowledge', aliases: ['Knowledge Base'], roles: ALL, ready: true },
      { id: 'policies', label: 'Policies', aliases: ['HR Policies'], roles: ALL, ready: true },
      { id: 'reports', label: 'Reports', aliases: ['Reports Generator'], roles: OVERSIGHT, ready: true },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    icon: 'settings-outline',
    tabs: [
      { id: 'master-data', label: 'Master Data', aliases: ['Option Lists'], roles: ['admin'], ready: true },
      { id: 'form-builder', label: 'Form Builder', aliases: ['Day Closure Form Builder'], roles: ['admin'], ready: true },
      { id: 'knowledge-review', label: 'Knowledge Review', aliases: ['Knowledge Admin'], roles: ['admin'], ready: true },
    ],
  },
];

/** Sections and tabs this role can use right now. Empty sections are dropped. */
export function sectionsForRole(role: string | undefined | null): NavSection[] {
  if (!role) return [];
  return NAV_SECTIONS.map((s) => ({
    ...s,
    tabs: s.tabs.filter((t) => t.ready && t.roles.includes(role as NavRole)),
  })).filter((s) => s.tabs.length > 0);
}

export function findSection(id: string): NavSection | undefined {
  return NAV_SECTIONS.find((s) => s.id === id);
}

/** Sections shown on the More screen (everything not on the bottom bar). */
export const MORE_SECTION_IDS = ['team', 'stock', 'library', 'setup'];
