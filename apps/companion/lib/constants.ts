/**
 * Shared design tokens — matched to the Shelf webapp's Tailwind config.
 * Typography from Inter font scale.
 *
 * COLORS: Moved to theme-colors.ts — use `useTheme()` from theme-context.tsx
 * to get the current theme's colors. The re-exports below exist only for
 * backward-compat during migration and will be removed.
 */

import {
  ASSET_STATUS_LABELS,
  ASSET_QTY_STATUS_LABELS,
  ASSET_BOOKING_PSEUDO_STATUS_LABELS,
  BOOKING_STATUS_LABELS,
} from "@shelf/labels";

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

/**
 * Format status enums into user-facing labels IDENTICAL to the webapp.
 *
 * All asset + booking status strings come from the shared `@shelf/labels`
 * package (the single source of truth both apps import), so the phone can
 * never drift from the website's wording. This mirrors the web
 * `userFriendlyAssetStatus()` enum path, including the booking-context
 * "partially checked in/out" pseudo-statuses that previously fell through to
 * the default branch and rendered as raw text like "Partially checked out qty".
 *
 * Note: the quantity-aware badge labels ("Partial custody", "Partially
 * reserved") are NOT enum values — they are derived from a quantity breakdown,
 * not this map. Use {@link getQuantityStatusLabel} for those.
 *
 * @param status - an asset/booking/audit status enum string from the API
 * @returns the user-facing label
 */
export function formatStatus(status: string) {
  switch (status) {
    // ── Asset statuses (shared with web userFriendlyAssetStatus) ──
    case "IN_CUSTODY":
      return ASSET_STATUS_LABELS.IN_CUSTODY;
    case "CHECKED_OUT":
      return ASSET_STATUS_LABELS.CHECKED_OUT;
    case "AVAILABLE":
      return ASSET_STATUS_LABELS.AVAILABLE;
    // ── Booking-context pseudo-statuses (web userFriendlyAssetStatus) ──
    // Previously missing -> the default branch mangled them (stray "qty").
    case "PARTIALLY_CHECKED_IN":
      return ASSET_BOOKING_PSEUDO_STATUS_LABELS.ALREADY_CHECKED_IN;
    case "PARTIALLY_CHECKED_IN_QTY":
      return ASSET_BOOKING_PSEUDO_STATUS_LABELS.PARTIALLY_CHECKED_IN;
    case "PARTIALLY_CHECKED_OUT_QTY":
    case "PARTIALLY_CHECKED_OUT_QTY_PENDING_RETURN":
      return ASSET_BOOKING_PSEUDO_STATUS_LABELS.PARTIALLY_CHECKED_OUT;
    // ── Booking statuses (shared with web booking-status-badge) ──
    case "DRAFT":
      return BOOKING_STATUS_LABELS.DRAFT;
    case "RESERVED":
      return BOOKING_STATUS_LABELS.RESERVED;
    case "ONGOING":
      return BOOKING_STATUS_LABELS.ONGOING;
    case "OVERDUE":
      return BOOKING_STATUS_LABELS.OVERDUE;
    case "COMPLETE":
      return BOOKING_STATUS_LABELS.COMPLETE;
    case "ARCHIVED":
      return BOOKING_STATUS_LABELS.ARCHIVED;
    case "CANCELLED":
      return BOOKING_STATUS_LABELS.CANCELLED;
    // ── Audit statuses (companion-only; no web asset-badge equivalent) ──
    case "PENDING":
      return "Pending";
    case "ACTIVE":
      return "Active";
    case "COMPLETED":
      return "Completed";
    // Fallback: sentence-case (capitalize first word only)
    default: {
      const words = status.replace(/_/g, " ").toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
  }
}

/**
 * Quantity-aware status label for a QUANTITY_TRACKED asset, IDENTICAL to the
 * web `getQuantityBadgeLabelAndColor` (asset-status-badge/quantity-data.ts).
 *
 * A quantity-tracked asset whose units span states shows a derived badge (e.g.
 * "Partial custody" when some units are held and some are still available),
 * NOT the raw enum. Labels come from the shared `@shelf/labels` package.
 *
 * Precedence mirrors web exactly: checked-out, then in-custody, then reserved,
 * each "Partial…" when units remain available.
 *
 * @param breakdown - the per-status unit counts from the asset detail endpoint
 * @returns the label, or null when there is no breakdown (caller falls back to
 *          {@link formatStatus} on the raw enum)
 */
export function getQuantityStatusLabel(
  breakdown:
    | {
        available: number;
        inCustody: number;
        reserved: number;
        checkedOut: number;
      }
    | null
    | undefined
): string | null {
  if (!breakdown) return null;
  const { available, inCustody, reserved, checkedOut } = breakdown;
  if (checkedOut > 0) {
    return available <= 0
      ? ASSET_QTY_STATUS_LABELS.CHECKED_OUT
      : ASSET_QTY_STATUS_LABELS.PARTIALLY_CHECKED_OUT;
  }
  if (inCustody > 0) {
    return available <= 0
      ? ASSET_QTY_STATUS_LABELS.IN_CUSTODY
      : ASSET_QTY_STATUS_LABELS.PARTIAL_CUSTODY;
  }
  if (reserved > 0) {
    return available <= 0
      ? ASSET_QTY_STATUS_LABELS.RESERVED
      : ASSET_QTY_STATUS_LABELS.PARTIALLY_RESERVED;
  }
  return ASSET_QTY_STATUS_LABELS.AVAILABLE;
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

/**
 * Compact magnitude for a millisecond span — "30m", "6h", "2d", "3w".
 * Used by the booking countdown so a field tech reads "Due in 3h" at a glance.
 *
 * @param ms - A duration in milliseconds (negative values are clamped to 0).
 * @returns The largest sensible unit as a short string.
 */
export function formatDurationShort(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

/**
 * At-a-glance timing for a booking, derived purely from its dates + status.
 * Returns null for states where a countdown is meaningless (DRAFT being built,
 * or terminal complete/archived/cancelled). RESERVED bookings already past
 * their window read "Was due …" (muted) rather than "Overdue", since they were
 * never checked out — only ONGOING/OVERDUE bookings are truly overdue.
 *
 * @param from - Booking start ISO date string.
 * @param to - Booking end ISO date string.
 * @param status - Booking status.
 * @param now - Current epoch ms (injectable for tests; defaults to Date.now()).
 * @returns `{ text, urgent }` or null.
 */
export function bookingCountdown(
  from: string,
  to: string,
  status: string,
  now: number = Date.now()
): { text: string; urgent: boolean } | null {
  if (["DRAFT", "COMPLETE", "ARCHIVED", "CANCELLED"].includes(status)) {
    return null;
  }
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;

  if (status === "OVERDUE" || (status === "ONGOING" && now > toMs)) {
    return {
      text: `Overdue by ${formatDurationShort(now - toMs)}`,
      urgent: true,
    };
  }
  if (status === "ONGOING") {
    return {
      text: `Due in ${formatDurationShort(toMs - now)}`,
      urgent: toMs - now < 24 * 60 * 60 * 1000,
    };
  }
  // RESERVED
  if (now < fromMs) {
    return {
      text: `Starts in ${formatDurationShort(fromMs - now)}`,
      urgent: false,
    };
  }
  if (now > toMs) {
    return {
      text: `Was due ${formatDurationShort(now - toMs)} ago`,
      urgent: false,
    };
  }
  return {
    text: `Due in ${formatDurationShort(toMs - now)}`,
    urgent: toMs - now < 24 * 60 * 60 * 1000,
  };
}

/**
 * Formats a numeric amount as currency, falling back to "<CODE> <amount>" when
 * the runtime can't resolve the currency (e.g. an unknown ISO code).
 *
 * @param value - The amount to format.
 * @param currency - ISO 4217 currency code (e.g. "USD").
 * @returns The localized currency string.
 */
export function formatCurrency(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
