/**
 * Single source of truth for web navigation.
 *
 * Seven sections - Home, Work, Field, Team, Stock, Library, Setup - each with
 * a few tabs. The sidebar, the tab strip and the role checks all come from
 * this file, so a feature is never listed twice and the web and the Android
 * app (mobile/src/navigation/navConfig.ts mirrors this file) use the same
 * names.
 *
 * Nothing here removes a feature. Every tab points at an existing dashboard
 * tab or an existing page; old URLs (/dashboard/stock, /dashboard/knowledge
 * and so on) keep working because those pages are untouched.
 *
 * Role rules follow the backend (require_role in backend/app/presentation/
 * api/v1/routers). If the API lets a role do something, that role gets the
 * tab; if the API says no, the tab is hidden.
 */

export type NavRole = "admin" | "manager" | "field_officer" | "sales_officer";

export type NavTarget =
  /** A tab inside /dashboard (state, not URL). */
  | { kind: "tab"; id: string; openFormBuilder?: boolean }
  /** A separate page. `tab` picks the page's own sub-tab (?tab=...). */
  | { kind: "route"; path: string; tab?: string };

export interface NavTab {
  id: string;
  label: string;
  /** Old names people already know. Used by search and tooltips. */
  aliases: string[];
  roles: NavRole[];
  target: NavTarget;
  /** Dashboard tab ids that should also light this tab up. */
  alsoActiveOn?: string[];
}

export interface NavSection {
  id: string;
  label: string;
  tabs: NavTab[];
}

const ALL: NavRole[] = ["admin", "manager", "field_officer", "sales_officer"];
const OVERSIGHT: NavRole[] = ["admin", "manager"];
const OFFICERS: NavRole[] = ["field_officer", "sales_officer"];

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "home",
    label: "Home",
    tabs: [
      { id: "today", label: "Today", aliases: ["Overview", "Dashboard"], roles: ALL, target: { kind: "tab", id: "overview" } },
      {
        id: "progress",
        label: "Progress",
        aliases: ["Productivity", "Momentum & Milestones", "KPIs"],
        roles: ALL,
        target: { kind: "tab", id: "productivity" },
        alsoActiveOn: ["momentum"],
      },
    ],
  },
  {
    id: "work",
    label: "Work",
    tabs: [
      { id: "tasks", label: "Tasks", aliases: ["My Tasks", "Assign Tasks", "Task Management"], roles: ALL, target: { kind: "tab", id: "tasks" } },
      { id: "plans", label: "Plans", aliases: ["Weekly Plans", "Weekly Plan Approval"], roles: ALL, target: { kind: "tab", id: "plans" } },
      { id: "closure-own", label: "Closure", aliases: ["Day Closure"], roles: OFFICERS, target: { kind: "tab", id: "work-doc" } },
      {
        id: "closure-review",
        label: "Closure",
        aliases: ["Day Closure Reports", "Day Closure Overview", "Sales Day Closures", "File Missed Closure"],
        roles: OVERSIGHT,
        target: { kind: "tab", id: "day-closures" },
      },
      { id: "leave", label: "Leave", aliases: ["My Leave", "Leave Approvals"], roles: ALL, target: { kind: "tab", id: "leave" } },
    ],
  },
  {
    id: "field",
    label: "Field",
    tabs: [
      {
        id: "visits",
        label: "Visits",
        aliases: ["Daily Visit Reports", "Daily Visit Tracker", "Field Visit Log", "My Visits"],
        roles: OVERSIGHT,
        target: { kind: "route", path: "/dashboard/daily-visits" },
      },
      {
        id: "farmers",
        label: "Farmers",
        aliases: ["Register Farmer", "Field Network"],
        roles: ["admin", "manager", "field_officer"],
        target: { kind: "route", path: "/dashboard/field-network", tab: "farmers" },
      },
      {
        id: "dealers",
        label: "Dealers",
        aliases: ["Dealer Audit", "Dealer orders", "Field Network"],
        roles: ["admin", "manager", "sales_officer"],
        target: { kind: "route", path: "/dashboard/field-network", tab: "dealers" },
      },
      {
        id: "issues",
        label: "Issues",
        aliases: ["Crop Disease Issues", "Report Crop Issue"],
        roles: ["admin", "manager", "field_officer"],
        target: { kind: "tab", id: "issues" },
      },
      {
        id: "enquiries",
        label: "Enquiries",
        aliases: ["Farmer Enquiry"],
        roles: ["admin", "manager", "field_officer"],
        target: { kind: "tab", id: "enquiry" },
      },
      {
        id: "my-stock",
        label: "My Stock",
        aliases: ["Stock in hand"],
        roles: OFFICERS,
        target: { kind: "route", path: "/dashboard/my-stock" },
      },
    ],
  },
  {
    id: "team",
    label: "Team",
    tabs: [
      { id: "live", label: "Live", aliases: ["Live Tracking Map", "Team's Live Location"], roles: OVERSIGHT, target: { kind: "tab", id: "map" } },
      { id: "history", label: "History", aliases: ["Movement History", "Historical Route Replay"], roles: OVERSIGHT, target: { kind: "tab", id: "route-history" } },
      { id: "attendance", label: "Attendance", aliases: ["Attendance Log"], roles: OVERSIGHT, target: { kind: "tab", id: "attendance" } },
      { id: "people", label: "People", aliases: ["User Management", "Users"], roles: ["admin"], target: { kind: "tab", id: "users" } },
    ],
  },
  {
    id: "stock",
    label: "Stock",
    tabs: [
      { id: "issue", label: "Issue", aliases: ["Admin Stock", "Issue Stock", "Stock Management"], roles: OVERSIGHT, target: { kind: "route", path: "/dashboard/stock", tab: "issue" } },
      { id: "with-officers", label: "With Officers", aliases: ["Stock with Officers", "Reconciliation"], roles: OVERSIGHT, target: { kind: "route", path: "/dashboard/stock", tab: "recon" } },
      { id: "stock-history", label: "History", aliases: ["Ledger", "Stock movement"], roles: OVERSIGHT, target: { kind: "route", path: "/dashboard/stock", tab: "ledger" } },
      { id: "products", label: "Products", aliases: ["Products and pricing"], roles: ["admin"], target: { kind: "route", path: "/dashboard/products" } },
    ],
  },
  {
    id: "library",
    label: "Library",
    tabs: [
      { id: "knowledge", label: "Knowledge", aliases: ["Knowledge Base"], roles: ALL, target: { kind: "route", path: "/dashboard/knowledge" } },
      { id: "policies", label: "Policies", aliases: ["HR Policies"], roles: ALL, target: { kind: "tab", id: "hrpolicy" } },
      { id: "reports", label: "Reports", aliases: ["Reports Generator"], roles: OVERSIGHT, target: { kind: "tab", id: "reports" } },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    tabs: [
      { id: "master-data", label: "Master Data", aliases: ["Option Lists", "Crops, pests, diseases"], roles: ["admin"], target: { kind: "route", path: "/dashboard/master-data" } },
      { id: "form-builder", label: "Form Builder", aliases: ["Day Closure Form Builder"], roles: ["admin"], target: { kind: "tab", id: "day-closures", openFormBuilder: true } },
      { id: "knowledge-review", label: "Knowledge Review", aliases: ["Knowledge Admin"], roles: ["admin"], target: { kind: "route", path: "/dashboard/knowledge-admin" } },
    ],
  },
];

/** Sections and tabs this role may see. Sections with no tabs are dropped. */
export function navForRole(role: string | undefined | null): NavSection[] {
  if (!role) return [];
  return NAV_SECTIONS.map((s) => ({
    ...s,
    tabs: s.tabs.filter((t) => t.roles.includes(role as NavRole)),
  })).filter((s) => s.tabs.length > 0);
}

export function hrefFor(target: NavTarget): string | null {
  if (target.kind !== "route") return null;
  return target.tab ? `${target.path}?tab=${target.tab}` : target.path;
}

/**
 * Which tab is showing right now. `dashboardTab` is the /dashboard state tab
 * (null on a separate page); `pathname`/`query` identify a separate page.
 */
export function findActive(
  sections: NavSection[],
  where: { dashboardTab?: string | null; pathname?: string; pageTab?: string | null },
): { section: NavSection; tab: NavTab } | null {
  for (const section of sections) {
    for (const tab of section.tabs) {
      const t = tab.target;
      if (t.kind === "tab") {
        if (where.dashboardTab && (t.id === where.dashboardTab || tab.alsoActiveOn?.includes(where.dashboardTab))) {
          // Setup > Form Builder shares the day-closures tab with Work >
          // Closure; the dashboard decides which one is lit via openFormBuilder.
          if (t.openFormBuilder) continue;
          return { section, tab };
        }
      } else if (where.pathname === t.path) {
        if (!t.tab || t.tab === (where.pageTab ?? defaultPageTab(t.path))) return { section, tab };
      }
    }
  }
  return null;
}

function defaultPageTab(path: string): string | undefined {
  if (path === "/dashboard/stock") return "issue";
  if (path === "/dashboard/field-network") return "farmers";
  return undefined;
}

/** Search by current or old name. Used by the sidebar search box. */
export function searchNav(sections: NavSection[], query: string): { section: NavSection; tab: NavTab }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: { section: NavSection; tab: NavTab }[] = [];
  for (const section of sections) {
    for (const tab of section.tabs) {
      const hay = [tab.label, section.label, ...tab.aliases].join(" ").toLowerCase();
      if (hay.includes(q)) out.push({ section, tab });
    }
  }
  return out;
}
