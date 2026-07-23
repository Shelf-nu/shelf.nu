/**
 * Timeframe Resolution Utilities
 *
 * Pure functions for resolving timeframe presets to actual dates.
 * This module runs on both client and server (no .server suffix).
 *
 * @see {@link file://./types.ts}
 */

import { DateTime } from "luxon";
import {
  formatDate,
  HARDCODED_DEFAULT_PREFS,
  type ResolvedFormatPrefs,
} from "~/utils/date-format";
import type { TimeframePreset, ResolvedTimeframe } from "./types";

/**
 * Resolve a timeframe preset to actual dates.
 *
 * Preset boundaries are anchored to wall-clock time in the user's pref
 * timezone (`prefs.timeZone`) via Luxon — so "this month" starts at midnight on
 * the 1st in the user's zone, not on the machine running the loader. The
 * returned `from`/`to` are `Date` instants (via `.toJSDate()`).
 *
 * @param preset - The timeframe preset
 * @param customFrom - Custom start date (required if preset is "custom")
 * @param customTo - Custom end date (required if preset is "custom")
 * @param prefs - Resolved user format prefs driving both the boundary timezone
 *   and label ordering. Optional; defaults to {@link HARDCODED_DEFAULT_PREFS}
 *   (UTC), which is acceptable for the internal error-path fallbacks below.
 * @returns Resolved timeframe with actual dates and label
 */
export function resolveTimeframe(
  preset: TimeframePreset,
  customFrom?: Date,
  customTo?: Date,
  prefs: ResolvedFormatPrefs = HARDCODED_DEFAULT_PREFS
): ResolvedTimeframe {
  const zone = prefs.timeZone ?? "UTC";
  const now = DateTime.now().setZone(zone);
  const startOfToday = now.startOf("day");

  switch (preset) {
    case "today":
      return {
        preset,
        from: startOfToday.toJSDate(),
        to: now.toJSDate(),
        label: "Today",
      };

    case "last_7d": {
      // 7 days = today + 6 days before = subtract 6
      return {
        preset,
        from: startOfToday.minus({ days: 6 }).toJSDate(),
        to: now.toJSDate(),
        label: "Last 7 days",
      };
    }

    case "last_30d": {
      // 30 days = today + 29 days before = subtract 29
      return {
        preset,
        from: startOfToday.minus({ days: 29 }).toJSDate(),
        to: now.toJSDate(),
        label: "Last 30 days",
      };
    }

    case "last_90d": {
      // 90 days = today + 89 days before = subtract 89
      return {
        preset,
        from: startOfToday.minus({ days: 89 }).toJSDate(),
        to: now.toJSDate(),
        label: "Last 90 days",
      };
    }

    case "this_month": {
      const from = now.startOf("month");
      return {
        preset,
        from: from.toJSDate(),
        to: now.toJSDate(),
        // formatMonthLabel is locale-only (no tz conversion) and reads the
        // machine-local components of the Date it receives — pass a local
        // wall-clock date built from the pref-tz month so the label names the
        // correct month regardless of the machine's timezone.
        label: formatMonthLabel(new Date(from.year, from.month - 1, 1), prefs),
      };
    }

    case "last_month": {
      const from = now.startOf("month").minus({ months: 1 });
      const to = now.startOf("month").minus({ seconds: 1 });
      return {
        preset,
        from: from.toJSDate(),
        to: to.toJSDate(),
        // See this_month: label date is a machine-local wall-clock proxy.
        label: formatMonthLabel(new Date(from.year, from.month - 1, 1), prefs),
      };
    }

    case "this_quarter": {
      const from = now.startOf("quarter");
      return {
        preset,
        from: from.toJSDate(),
        to: now.toJSDate(),
        label: `Q${now.quarter} ${now.year}`,
      };
    }

    case "this_year": {
      const from = now.startOf("year");
      return {
        preset,
        from: from.toJSDate(),
        to: now.toJSDate(),
        label: `${now.year}`,
      };
    }

    case "all_time": {
      // Use a far past date - organization creation date would be ideal
      // but we use 2020 as a reasonable start for most organizations
      const from = DateTime.fromObject(
        { year: 2020, month: 1, day: 1 },
        { zone }
      );
      return {
        preset,
        from: from.toJSDate(),
        to: now.toJSDate(),
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
        label: `${formatDateShort(customFrom, prefs)} – ${formatDateShort(
          customTo,
          prefs
        )}`,
      };
    }

    default:
      // Default to last 30 days
      return resolveTimeframe("last_30d");
  }
}

/**
 * Format a full month + year label (e.g. "April 2026") in the caller's
 * configured date-part order. Month/year names stay English by design; only
 * ORDER is prefs-driven.
 *
 * @param date - The month to label (first-of-month date)
 * @param prefs - Resolved user format prefs
 * @returns the assembled month label
 */
function formatMonthLabel(date: Date, prefs: ResolvedFormatPrefs): string {
  return formatDate(date, prefs, {
    month: "long",
    year: "numeric",
    localeOnly: true,
  });
}

/**
 * Format the custom-range indicator's date label in the user's own format.
 *
 * No `month`/`day`/`year` shape options are passed, so the pref alone decides
 * the rendering (numeric-vs-name, order, separator) — e.g. "06/07/2026" for a
 * DD_MM_YYYY user. `localeOnly` keeps the given wall-clock date absolute (no
 * timezone conversion), matching how the custom range is entered.
 *
 * @param date - The date to label (interpreted as a local wall-clock date)
 * @param prefs - Resolved user format prefs
 * @returns the assembled custom-range date label
 */
function formatDateShort(date: Date, prefs: ResolvedFormatPrefs): string {
  return formatDate(date, prefs, { localeOnly: true });
}

/**
 * Get the default timeframe (last 30 days).
 */
export function getDefaultTimeframe(): ResolvedTimeframe {
  return resolveTimeframe("last_30d");
}
