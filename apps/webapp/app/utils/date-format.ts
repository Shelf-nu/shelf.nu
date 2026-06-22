/**
 * Date-format preference resolver.
 *
 * Translates an organization's {@link DateFormat} preference into the inputs the
 * existing Intl-based date pipeline already understands: a BCP-47 locale (which
 * controls day/month/year ORDER) plus, for explicit formats, a zero-padded
 * numeric option set applied to plain date displays.
 *
 * Design: rather than introduce a parallel token-based formatter, we lean on the
 * one locale-aware spine the app already uses (`getDateTimeFormatFromHints` →
 * `Intl.DateTimeFormat`). The preference simply overrides the locale that spine
 * is keyed on. This means:
 * - numeric dates flip order (e.g. 04/03/2026 → 03/04/2026), and
 * - intentionally month-name dates reorder but keep the name (Apr 22, 2026 →
 *   22 Apr 2026),
 * which is the agreed behavior for the workspace setting.
 *
 * `AUTO` preserves the legacy behavior (locale derived from the browser
 * Accept-Language header), so existing workspaces see no change.
 *
 * @see {@link file://./client-hints.tsx} getDateTimeFormatFromHints
 * @see {@link file://../components/shared/date.tsx} DateS
 */
import type { DateFormat } from "@prisma/client";

/**
 * Maps an explicit {@link DateFormat} to the locale whose short-date ordering
 * matches it. Returns `null` for `AUTO` (or an unknown/absent value) so callers
 * fall back to the request/browser locale.
 *
 * @param dateFormat - The org preference, or null/undefined
 * @returns A BCP-47 locale string, or null to mean "use the fallback locale"
 */
export function dateFormatToLocale(
  dateFormat: DateFormat | null | undefined
): string | null {
  switch (dateFormat) {
    case "DD_MM_YYYY":
      return "en-GB"; // day/month/year
    case "MM_DD_YYYY":
      return "en-US"; // month/day/year
    case "YYYY_MM_DD":
      return "en-CA"; // year-month-day (ISO-style numeric)
    case "AUTO":
    default:
      return null;
  }
}

/**
 * Zero-padded numeric option set applied to plain date-only / date-time displays
 * when an explicit format is chosen, so "dd/mm/yyyy" renders canonically
 * (e.g. 03/04/2026 rather than the locale's bare 3/4/2026). The ORDER still
 * comes from the resolved locale — these options only control padding/fields.
 */
export const NUMERIC_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
};

/** Result of {@link resolveDateFormat}. */
export type ResolvedDateFormat = {
  /** The locale to format with (mapped preference, or the supplied fallback). */
  locale: string;
  /** True when an explicit (non-AUTO) preference is in effect. */
  isExplicit: boolean;
  /**
   * Default numeric options to apply to plain date displays for explicit
   * formats; `undefined` for AUTO so legacy formatting is untouched.
   */
  numericDefaults: Intl.DateTimeFormatOptions | undefined;
};

/**
 * Resolves an org date-format preference against a fallback locale.
 *
 * @param dateFormat - The organization's preference (AUTO/explicit/absent)
 * @param fallbackLocale - The locale to use when the preference is AUTO/absent
 *   (typically the Accept-Language-derived hints locale)
 * @returns The effective locale and default options for date rendering
 */
export function resolveDateFormat(
  dateFormat: DateFormat | null | undefined,
  fallbackLocale: string
): ResolvedDateFormat {
  const mapped = dateFormatToLocale(dateFormat);
  return {
    locale: mapped ?? fallbackLocale,
    isExplicit: mapped !== null,
    numericDefaults: mapped !== null ? NUMERIC_DATE_OPTIONS : undefined,
  };
}
