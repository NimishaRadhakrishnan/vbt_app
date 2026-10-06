"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth-context";
import { findActive, hrefFor, navForRole } from "@/lib/navigation";
import type { NavSection, NavTab } from "@/lib/navigation";

/** Where a tab lives when it is a /dashboard state tab and we are on another page. */
export function dashboardHref(tab: NavTab): string | null {
  if (tab.target.kind !== "tab") return null;
  const params = new URLSearchParams({ tab: tab.target.id });
  if (tab.target.openFormBuilder) params.set("builder", "1");
  return `/dashboard?${params.toString()}`;
}

const PAGE_TAB_EVENT = "vbt-pagetab";

/** Current ?tab= of a separate page. Updates when SectionTabs switches it. */
export function usePageTab(): string | null {
  const pathname = usePathname();
  const [tab, setTab] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setTab(new URLSearchParams(window.location.search).get("tab"));
    read();
    window.addEventListener(PAGE_TAB_EVENT, read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener(PAGE_TAB_EVENT, read);
      window.removeEventListener("popstate", read);
    };
  }, [pathname]);
  return tab;
}

interface Props {
  /** On /dashboard: the current in-page tab and how to switch to one. */
  dashboardTab?: string;
  onSelectDashboardTab?: (tab: NavTab) => void;
  /** Show the seven section pills above the tabs (separate pages have no sidebar). */
  showSections?: boolean;
}

/**
 * The tab strip for whichever section you are in. Used on the dashboard
 * (under the sidebar) and on the separate pages (stock, knowledge, field
 * network ...) so you always see where you are and where else you can go.
 */
export default function SectionTabs({ dashboardTab, onSelectDashboardTab, showSections }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const pageTab = usePageTab();

  const sections = useMemo(() => navForRole(user?.role), [user?.role]);
  const active = findActive(sections, { dashboardTab: dashboardTab ?? null, pathname, pageTab });
  const [pickedSectionId, setPickedSectionId] = useState<string | null>(null);

  if (!user || sections.length === 0) return null;

  const section: NavSection | undefined =
    sections.find((s) => s.id === pickedSectionId) ?? active?.section ?? sections[0];

  const go = (tab: NavTab) => {
    if (tab.target.kind === "tab") {
      if (onSelectDashboardTab) onSelectDashboardTab(tab);
      else {
        const href = dashboardHref(tab);
        if (href) router.push(href);
      }
    } else {
      const href = hrefFor(tab.target);
      if (!href) return;
      if (tab.target.path === pathname) {
        // Same page, different sub-tab: no reload.
        window.history.pushState(null, "", href);
        window.dispatchEvent(new Event(PAGE_TAB_EVENT));
      } else {
        router.push(href);
      }
    }
  };

  const goSection = (s: NavSection) => {
    setPickedSectionId(s.id);
    const first = s.tabs[0];
    if (first) go(first);
  };

  return (
    <div className="mb-4 space-y-2">
      {showSections && (
        <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Sections">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => goSection(s)}
              className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-md whitespace-nowrap transition ${
                s.id === section?.id ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      {section && section.tabs.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label={`${section.label} tabs`}>
          {section.tabs.map((tab) => {
            const isActive = active?.tab.id === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                title={tab.aliases.length ? `Also called: ${tab.aliases.join(", ")}` : undefined}
                onClick={() => go(tab)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${
                  isActive
                    ? "border-green-700 text-green-800"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
