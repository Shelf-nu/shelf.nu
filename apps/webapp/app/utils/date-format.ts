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

/**
 * Builds the final `Intl.DateTimeFormatOptions` for a DateS render, folding in
 * the resolved numeric defaults for explicit formats.
 *
 * CRITICAL: `Intl.DateTimeFormat` throws a TypeError when the `dateStyle` /
 * `timeStyle` shortcuts are combined with granular component fields
 * (`year`/`month`/`day`/`hour`/…). Many call sites pass `dateStyle`/`timeStyle`
 * (e.g. the audits index, asset columns), so the numeric defaults must be
 * skipped whenever the caller opts into a style shortcut — otherwise those
 * pages crash for any workspace on a non-AUTO date format.
 *
 * @param params.callerOptions - Options passed to the DateS component (if any)
 * @param params.numericDefaults - Resolved numeric defaults, or undefined (AUTO)
 * @param params.includeTime - Whether the date should include a time portion
 * @param params.onlyTime - Whether to render only the time
 * @returns Options safe to pass to getDateTimeFormatFromHints / Intl
 */
export function mergeDateDisplayOptions({
  callerOptions,
  numericDefaults,
  includeTime,
  onlyTime,
}: {
  callerOptions?: Intl.DateTimeFormatOptions;
  numericDefaults: Intl.DateTimeFormatOptions | undefined;
  includeTime: boolean;
  onlyTime: boolean;
}): Intl.DateTimeFormatOptions {
  if (onlyTime) {
    // Time-only: never inject date fields. timeStyle here is intentional.
    return { timeStyle: "short", ...callerOptions };
  }

  // Skip the granular numeric defaults when the caller uses a style shortcut,
  // to avoid the Intl granular-vs-style TypeError. The resolved locale (applied
  // by the caller via hints) still fixes the day/month/year ORDER, so a
  // dateStyle:"short" under e.g. en-GB still renders day-first.
  const hasStyleShortcut = Boolean(
    callerOptions?.dateStyle || callerOptions?.timeStyle
  );
  const dateDefaults = hasStyleShortcut ? undefined : numericDefaults;

  if (includeTime) {
    return {
      ...dateDefaults,
      // Granular hour/minute only on the non-shortcut path. With a dateStyle or
      // timeStyle shortcut, add the time via the `timeStyle` shortcut instead.
      // Mixing granular component fields (hour/minute) with a style shortcut
      // makes Intl.DateTimeFormat throw a TypeError.
      ...(hasStyleShortcut
        ? { timeStyle: "short" as const }
        : { hour: "numeric" as const, minute: "numeric" as const }),
      ...callerOptions,
    };
  }

  return { ...dateDefaults, ...callerOptions };
}
