/**
 * `DateS` — the single client date-display primitive.
 *
 * Renders a date/time per the acting user's resolved formatting prefs
 * (`useDateFormatter()` → `requestInfo.formatPrefs`), delegating all assembly to
 * the pure `formatDate`. Order/separator, zero-padding, month name-vs-number, and
 * 12/24h all come from the user's prefs — never from the browser locale — so every
 * surface agrees. Timezone conversion is handled inside `formatDate` (skipped when
 * `localeOnly` is set, for absolute dates like working-hours overrides).
 *
 * Always assumes `date` may be a string (loader-serialized) or a `Date`.
 *
 * @see {@link file://../../hooks/use-date-formatter.ts}
 * @see {@link file://../../utils/date-format.ts} formatDate
 */
import { useDateFormatter } from "~/hooks/use-date-formatter";
import type { DateFormatOptions } from "~/utils/date-format";

/**
 * Props for {@link DateS}. `options` is a superset of the Intl option shapes the
 * app passes today; extra branches are handled by `formatDate`.
 */
type DateSProps = {
  /** The value to render. `null` renders nothing (with a dev warning). */
  date: string | Date | null;
  /**
   * Formatting options (weekday/year/month/day/hour/minute or dateStyle/timeStyle).
   * Defaults inside `formatDate` are numeric year/month/day per the user's order.
   */
  options?: DateFormatOptions;
  /** Append the time portion to the date. */
  includeTime?: boolean;
  /** Render only the time portion (no date). */
  onlyTime?: boolean;
  /**
   * Format as an absolute date with NO timezone conversion (use for real-world,
   * location-specific dates like working-hours overrides that must not shift with
   * the viewer's timezone). Still honors the user's order/format prefs.
   */
  localeOnly?: boolean;
};

/**
 * Renders a date/time string using the current user's resolved formatting prefs.
 *
 * @param props - See {@link DateSProps}.
 * @returns A `<span>` with the formatted value, or `null` for a null `date`.
 */
export const DateS = ({
  date,
  options,
  includeTime,
  onlyTime,
  localeOnly,
}: DateSProps) => {
  const { formatDate } = useDateFormatter();

  // Resolve each formatting flag so an explicit prop wins, then a matching key
  // inside `options`, then the `false` default. Without this, a `false` default
  // spread after `...options` would silently overwrite a flag the caller passed
  // via `options` (e.g. `options={{ onlyTime: true }}`).
  const resolvedIncludeTime = includeTime ?? options?.includeTime ?? false;
  const resolvedOnlyTime = onlyTime ?? options?.onlyTime ?? false;
  const resolvedLocaleOnly = localeOnly ?? options?.localeOnly ?? false;

  if (!date) {
    // eslint-disable-next-line no-console
    console.warn("DateS component received null date:", date);
    return null;
  }

  if (resolvedLocaleOnly && resolvedIncludeTime) {
    // eslint-disable-next-line no-console
    console.warn("includeTime is not supported with localeOnly formatting");
  }

  const formattedDate = formatDate(date, {
    ...options,
    includeTime: resolvedIncludeTime,
    onlyTime: resolvedOnlyTime,
    localeOnly: resolvedLocaleOnly,
  });

  return <span>{formattedDate}</span>;
};
