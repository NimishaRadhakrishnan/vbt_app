/**
 * Shared theme - fix #4 from the audit fix pass.
 *
 * Previously every one of the app's 15 screens + 2 components defined its
 * own StyleSheet from scratch: 44 unique hex color literals and 17
 * distinct font sizes (8 through 36) with no shared source, so near-
 * identical intents (three different "light background" grays, three
 * different ad hoc action-button colors) had each drifted independently.
 *
 * This file is the single source for both. Screens import `theme` and
 * reference `theme.color.*` / `theme.font.*` instead of hex/number
 * literals. Existing hex values below were chosen by picking the most-
 * used literal for each real distinct intent found in the app (see the
 * audit's frequency count), not invented from scratch - e.g. `#1b5e20`
 * (70 occurrences) is obviously primary; `#f5f5f5` (18) beat `#f9f9f9`
 * (7) for screenBg since more call sites already agreed on it.
 */

export const color = {
  // Brand / primary actions.
  //
  // BUG FIX: this was green (#1b5e20) for the mobile app's entire
  // history, but the web admin console's real brand color - what
  // frontend/tailwind.config.js actually calls `primary-700`, used on
  // every header/button there - is maroon (#9f1d1d). The green was
  // never the brand color; nothing in this codebase's history explains
  // where it came from, it just never got reconciled against the web
  // app. Pulled directly from the web's own Tailwind config rather than
  // re-eyeballing a color: primary=primary-700, primaryLight=
  // primary-300, primaryPale=primary-100 (web's own choice for light
  // text on a primary-colored surface - see its `text-primary-100`
  // usage). Changing this one token set re-themes every screen, since
  // all of them already reference color.primary/* rather than hex
  // literals (see this file's own history) - no per-screen edits needed.
  primary: '#9f1d1d',
  primaryLight: '#f0a2a2', // used for pressed/active states, e.g. switches
  primaryPale: '#fbe4e4', // subtitle text on a primary-colored background

  // Semantic status colors - the app already had a fairly consistent set
  // for these; kept as-is rather than inventing new ones.
  success: '#2e7d32',
  warning: '#ef6c00',
  // Was #e65100 - measured 3.48:1/3.79:1 against this app's actual
  // backgrounds (screenBg/white), under WCAG AA's 4.5:1 minimum for
  // normal-size text even though every real usage (FetchStates.tsx,
  // WeeklyPlanScreen.tsx, TasksScreen.tsx) pairs it correctly with a
  // light background - the token itself just wasn't dark enough.
  // Darkened within the same orange hue to the point it actually passes
  // both backgrounds, with a small safety margin rather than sitting
  // right at the threshold.
  warningText: '#bf3f00',
  warningBg: '#fff3e0',
  warningBorder: '#ffcc80',
  error: '#c62828',
  errorText: '#d84315',
  info: '#1565c0',
  // warningText (#e65100) was designed as warning text on a light
  // background (warningBg) - it only measures 2.08:1 against the dark
  // primary header, well under WCAG AA's 4.5:1 minimum. This is the
  // same amber family, tuned for use as text/icon color on a dark
  // primary-colored surface instead (5.32:1 against primary).
  warningOnDark: '#ffcc80',

  // Neutrals - the app had #f5f5f5/#f9f9f9/#efebe9 competing for "light
  // background" and #333/#333333/#666/#666666 competing for "body text".
  // Collapsed to one value per real role.
  screenBg: '#f5f5f5',
  cardBg: '#ffffff',
  border: '#e0e0e0',
  borderLight: '#f0f0f0',
  textPrimary: '#333333',
  textSecondary: '#666666',
  // Design-pass contrast audit (item 5): was #999999, which measures
  // 2.61:1 against screenBg and 2.85:1 against white - both well under
  // WCAG AA's 4.5:1 minimum for text, and this token is used for
  // secondary/muted text across most screens. Darkened to the lightest
  // gray that actually passes both backgrounds (4.82:1 / 5.25:1) rather
  // than picking an arbitrary darker value - a single-token fix here
  // corrects every screen using it, which is the whole point of this
  // being a shared token instead of per-screen literals.
  textMuted: '#6c6c6c',
  textDisabled: '#bbbbbb',
  white: '#ffffff',
  black: '#000000',
  // Modal/sheet backdrop - same intent used in 3 places (MyLeaveScreen's
  // apply-leave modal, QuickActionSheet, DayClosureGateModal) that had
  // each independently picked 0.4 vs 0.5 opacity for the identical
  // "darken behind a modal" purpose. Standardized on the more common 0.4.
  overlay: 'rgba(0,0,0,0.4)',
} as const;

// 5 sizes, replacing the 17 ad hoc values previously in use. Existing
// screens land on whichever of these is closest to their old value when
// migrated - exact pixel-for-pixel preservation wasn't the goal, a real
// reduced scale was.
export const font = {
  caption: 12,
  body: 14,
  subtitle: 16,
  title: 20,
  heading: 24,
} as const;

export const fontWeight = {
  regular: '400' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

// Spacing scale - the brief flagged padding/margin as likely similarly ad
// hoc; a 4px base unit covers the values actually seen across screens
// (8, 12, 16, 20, 24 all appear constantly; oddities like 18, 22 do not
// need their own token, screens should round to the nearest step below).
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const theme = { color, font, fontWeight, spacing, radius };
export default theme;
