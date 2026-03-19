/**
 * Shared design tokens — matched to the Shelf webapp's Tailwind config.
 * Typography from Inter font scale.
 *
 * COLORS: Moved to theme-colors.ts — use `useTheme()` from theme-context.tsx
 * to get the current theme's colors. The re-exports below exist only for
 * backward-compat during migration and will be removed.
 */

// ── Deprecated re-exports (use useTheme() instead) ─────────────────────────
export { lightColors as colors } from "./theme-colors";
export { lightShadows as shadows } from "./theme-colors";
export { lightStatusBadge as STATUS_BADGE } from "./theme-colors";
export { lightBookingStatusBadge as BOOKING_STATUS_BADGE } from "./theme-colors";
export { lightStatusColors as STATUS_COLORS } from "./theme-colors";

// ── Layout tokens (theme-independent) ──────────────────────────────────────

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Matched to webapp's Tailwind text scale (Inter font) */
export const fontSize = {
  xs: 12, // text-xs (0.75rem)
  sm: 13, // between xs and sm
  base: 14, // text-sm (0.875rem) — webapp default body
  md: 15, // slightly larger
  lg: 16, // text-md (1rem)
  xl: 18, // text-lg / text-xl (1.125rem)
  xxl: 20,
  xxxl: 24, // display-xs (1.5rem)
  hero: 30, // display-sm (1.875rem)
} as const;

export const borderRadius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 9999,
} as const;

/**
 * Pre-allocated hitSlop objects to avoid creating new objects on every render.
 * Used across multiple touch targets (clear buttons, filter pills, etc.)
 */
export const hitSlop = {
  sm: { top: 6, bottom: 6, left: 2, right: 2 },
  md: { top: 10, bottom: 10, left: 10, right: 10 },
  lg: { top: 12, bottom: 12, left: 12, right: 12 },
} as const;

// ── Utility functions ──────────────────────────────────────────────────────

export function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
