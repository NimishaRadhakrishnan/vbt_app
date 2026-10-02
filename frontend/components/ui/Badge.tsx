import type { ReactNode } from "react";

type BadgeTone = "neutral" | "primary" | "success" | "warning" | "alert";

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Optional icon shown before the label - status should never be color-only (spec item 6). */
  icon?: ReactNode;
}

// Same shape, same font size, everywhere - only the fill color changes
// for state (design-system spec item 2). Every page's own one-off
// `px-2 py-0.5 text-xs bg-X-100 text-X-800 rounded...` badge should
// become `<Badge tone="...">` instead.
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  primary: "bg-primary-100 text-primary-800",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  alert: "bg-red-100 text-red-700",
};

export function Badge({ children, tone = "neutral", icon }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${TONE_CLASSES[tone]}`}>
      {icon}
      {children}
    </span>
  );
}
