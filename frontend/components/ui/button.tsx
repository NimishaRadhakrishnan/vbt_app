import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  isLoading?: boolean;
  variant?: "default" | "outline";
}

// The one button style for the whole app. Two fixes made here as part
// of the design-system pass: (1) default variant now uses the app's
// actual primary accent (primary-700, the maroon color every page
// already uses via bg-green-700) instead of a one-off slate-900 that
// matched nothing else, and (2) min-h-[44px] + visible focus ring added
// to meet spec item 6's touch-target and keyboard-focus requirements -
// the previous py-4/py-2 padding alone landed under 44px.
export function Button({
  isLoading,
  variant = "default",
  children,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const baseStyle =
    "inline-flex items-center justify-center min-h-[44px] rounded-md px-4 py-2 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2";
  const defaultStyle =
    "bg-primary-700 text-white hover:bg-primary-800";
  const outlineStyle =
    "bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-100";
  const variantStyle = variant === "outline" ? outlineStyle : defaultStyle;

  return (
    <button
      disabled={disabled || isLoading}
      className={`${baseStyle} ${variantStyle} ${className ?? ""}`}
      {...rest}
    >
      {isLoading ? "Please wait…" : children}
    </button>
  );
}
