/**
 * Timeframe Resolution Utilities
 *
 * Pure functions for resolving timeframe presets to actual dates.
 * This module runs on both client and server (no .server suffix).
 *
 * @see {@link file://./types.ts}
 */

import type { TimeframePreset, ResolvedTimeframe } from "./types";

/**
 * Resolve a timeframe preset to actual dates.
 *
 * @param preset - The timeframe preset
 * @param customFrom - Custom start date (required if preset is "custom")
 * @param customTo - Custom end date (required if preset is "custom")
 * @returns Resolved timeframe with actual dates and label
 */
export function resolveTimeframe(
  preset: TimeframePreset,
  customFrom?: Date,
  customTo?: Date
): ResolvedTimeframe {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case "today":
      return {
        preset,
        from: today,
        to: now,
        label: "Today",
      };

    case "last_7d": {
      // 7 days = today + 6 days before = subtract 6
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return {
        preset,
        from,
        to: now,
        label: "Last 7 days",
      };
    }

    case "last_30d": {
      // 30 days = today + 29 days before = subtract 29
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return {
        preset,
        from,
        to: now,
        label: "Last 30 days",
      };
    }

    case "last_90d": {
      // 90 days = today + 89 days before = subtract 89
      const from = new Date(today);
      from.setDate(from.getDate() - 89);
      return {
        preset,
        from,
        to: now,
        label: "Last 90 days",
      };
    }

    case "this_month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        preset,
        from,
        to: now,
        label: formatMonthLabel(from),
      };
    }

    case "last_month": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return {
        preset,
        from,
        to,
        label: formatMonthLabel(from),
      };
    }

    case "this_quarter": {
      const quarter = Math.floor(now.getMonth() / 3);
      const from = new Date(now.getFullYear(), quarter * 3, 1);
      return {
        preset,
        from,
        to: now,
        label: `Q${quarter + 1} ${now.getFullYear()}`,
      };
    }

    case "this_year": {
      const from = new Date(now.getFullYear(), 0, 1);
      return {
        preset,
        from,
        to: now,
        label: `${now.getFullYear()}`,
      };
    }

    case "all_time": {
      // Use a far past date - organization creation date would be ideal
      // but we use 2020 as a reasonable start for most organizations
      const from = new Date(2020, 0, 1);
      return {
        preset,
        from,
        to: now,
        label: "All time",
      };
    }

    case "custom": {
      if (!customFrom || !customTo) {
        // Return a default if custom dates not provided
        return resolveTimeframe("last_30d");
      }
      return {
        preset,
        from: customFrom,
        to: customTo,
        label: `${formatDateShort(customFrom)} – ${formatDateShort(customTo)}`,
      };
    }

    default:
      // Default to last 30 days
      return resolveTimeframe("last_30d");
  }
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Get the default timeframe (last 30 days).
 */
export function getDefaultTimeframe(): ResolvedTimeframe {
  return resolveTimeframe("last_30d");
}

/**
 * Parse timeframe from URL search params.
 */
export function parseTimeframeFromParams(
  searchParams: URLSearchParams
): ResolvedTimeframe {
  const preset =
    (searchParams.get("timeframe") as TimeframePreset) || "last_30d";
  const customFrom = searchParams.get("from");
  const customTo = searchParams.get("to");

  return resolveTimeframe(
    preset,
    customFrom ? new Date(customFrom) : undefined,
    customTo ? new Date(customTo) : undefined
  );
}
