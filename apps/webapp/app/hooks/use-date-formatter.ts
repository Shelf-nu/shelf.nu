/**
 * Client hook returning date-formatting functions bound to the acting user's
 * resolved prefs. Thin wrapper over the pure `formatDate` (identical output on
 * server and client) so components never thread prefs manually.
 *
 * The returned object is memoized on `prefs` identity for render stability
 * (root loader data is stable across a navigation), so callers can safely put
 * these functions in dependency arrays.
 *
 * @see {@link file://./use-format-prefs.ts}
 * @see {@link file://../utils/date-format.ts} formatDate — the pure formatter
 */
import { useMemo } from "react";

import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";
import { formatDate as formatDatePure } from "~/utils/date-format";

import { useFormatPrefs } from "./use-format-prefs";

/** The bound formatter surface returned by {@link useDateFormatter}. */
export type BoundDateFormatter = {
  /** The resolved prefs the formatters are bound to. */
  prefs: ResolvedFormatPrefs;
  /** Format a date (date part per prefs; add time via `opts.includeTime`). */
  formatDate: (value: string | Date, opts?: DateFormatOptions) => string;
  /** Format only the time part per the user's time-format pref. */
  formatTime: (value: string | Date, opts?: DateFormatOptions) => string;
  /** Format date + time per the user's prefs. */
  formatDateTime: (value: string | Date, opts?: DateFormatOptions) => string;
};

/**
 * @returns `{ prefs, formatDate, formatTime, formatDateTime }` bound to the
 *   current user's resolved formatting prefs.
 */
export function useDateFormatter(): BoundDateFormatter {
  const prefs = useFormatPrefs();

  return useMemo(
    () => ({
      prefs,
      formatDate: (value: string | Date, opts?: DateFormatOptions) =>
        formatDatePure(value, prefs, opts),
      formatTime: (value: string | Date, opts?: DateFormatOptions) =>
        formatDatePure(value, prefs, { ...opts, onlyTime: true }),
      formatDateTime: (value: string | Date, opts?: DateFormatOptions) =>
        formatDatePure(value, prefs, { ...opts, includeTime: true }),
    }),
    [prefs]
  );
}
