/**
 * Companion binding for the shared `@shelf/datetime` formatter.
 *
 * The formatter itself is pure (`formatDate(value, prefs, opts)`), so it needs
 * the acting user's resolved format preferences on every call. Rather than
 * thread `prefs` through every screen, these hooks read the already-resolved
 * `formatPrefs` off `OrgContext` (computed once from `/api/mobile/me` + device
 * hints in `org-context.tsx`) and pre-bind it, giving components ergonomic
 * `formatDate(v)` / `formatDateTime(v)` calls that render in the user's chosen
 * date format, time format, and timezone.
 *
 * @see {@link file://./org-context.tsx} where `formatPrefs` is resolved
 * @see {@link file://../../../packages/datetime/src/index.ts} the formatter core
 */
import { useMemo } from "react";
import {
  formatDate as formatWithPrefs,
  type DateFormatOptions,
  type ResolvedFormatPrefs,
} from "@shelf/datetime";
import { useOrg } from "./org-context";

/**
 * The acting user's resolved format preferences (every field concrete, with a
 * device-hint fallback). Use directly when passing `prefs` to a non-component
 * helper (e.g. `formatDue(dueDate, isActive, prefs)`); prefer
 * {@link useDateFormatter} inside components.
 *
 * @returns the resolved {@link ResolvedFormatPrefs} for the current user
 */
export function useFormatPrefs(): ResolvedFormatPrefs {
  return useOrg().formatPrefs;
}

/**
 * Date/time formatters pre-bound to the acting user's resolved prefs.
 *
 * - `formatDate(v, opts?)` — date only, in the user's `dateFormat` + timezone.
 * - `formatDateTime(v, opts?)` — date + time, in the user's `timeFormat` too.
 *
 * `v` may be an ISO instant string, a bare `YYYY-MM-DD` calendar date (rendered
 * without timezone shift), or a `Date`. The returned object is memoized on
 * `prefs`, so it is stable across renders while the prefs are unchanged.
 *
 * @returns `{ prefs, formatDate, formatDateTime }`
 */
export function useDateFormatter(): {
  prefs: ResolvedFormatPrefs;
  formatDate: (v: string | Date, opts?: DateFormatOptions) => string;
  formatDateTime: (v: string | Date, opts?: DateFormatOptions) => string;
} {
  const prefs = useFormatPrefs();
  return useMemo(
    () => ({
      prefs,
      formatDate: (v: string | Date, opts?: DateFormatOptions) =>
        formatWithPrefs(v, prefs, opts),
      formatDateTime: (v: string | Date, opts?: DateFormatOptions) =>
        formatWithPrefs(v, prefs, { ...opts, includeTime: true }),
    }),
    [prefs]
  );
}
