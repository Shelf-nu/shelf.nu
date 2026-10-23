/**
 * Client hook exposing the acting user's fully-resolved formatting preferences.
 *
 * Reads `requestInfo.formatPrefs` — resolved once per request by the ROOT loader
 * (`app/root.tsx`), so this works everywhere, including pre-auth / onboarding
 * pages (unlike layout-scoped hooks such as `useCurrentOrganization`). No
 * prop-drilling: every date surface reads the same resolved prefs.
 *
 * @see {@link file://../root.tsx} — resolves requestInfo.formatPrefs
 * @see {@link file://./use-date-formatter.ts} — bound formatter built on top
 */
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { useRequestInfo } from "~/utils/request-info";

/**
 * @returns the resolved formatting prefs (date/time format, week start, timezone)
 *   for the current request.
 */
export function useFormatPrefs(): ResolvedFormatPrefs {
  return useRequestInfo().formatPrefs;
}
