import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Card padding. "md" (default) matches the app's established p-4/p-6 rhythm. */
  padding?: "sm" | "md" | "lg";
}

const PADDING = {
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

// The ONE card style for the whole app (design-system spec item 3):
// white surface, 1px light border, restrained shadow (not "heavy"),
// consistent radius. Every page's ad-hoc
// `bg-white p-6 rounded-xl shadow-sm border border-slate-100` should
// become `<Card>` instead, so a future radius/shadow/border change
// happens in one place, not by re-editing every page.
export function Card({ children, padding = "md", className = "", ...rest }: CardProps) {
  return (
    <div
      className={`bg-white border border-slate-100 rounded-xl shadow-sm ${PADDING[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
