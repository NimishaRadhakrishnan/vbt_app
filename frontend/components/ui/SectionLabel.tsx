import type { ReactNode } from "react";

// One style for section labels app-wide (design-system spec item 3):
// small, uppercase, muted. Formalizes what most pages already do
// ad-hoc via `text-xs font-semibold text-slate-500 uppercase` inline -
// pulling it into one component means the typography scale actually
// has one definition, not N slightly-different copies of it.
export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{children}</p>;
}
