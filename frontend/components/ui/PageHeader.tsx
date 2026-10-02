import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

// Same page-header pattern everywhere (design-system spec item 3): title
// + optional subtitle, optional single right-aligned primary action.
// Every page's own bespoke header block (dashboard, field-network,
// products, marketing, master-data, daily-visits all currently build
// this by hand slightly differently) should render `<PageHeader>` instead.
export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
