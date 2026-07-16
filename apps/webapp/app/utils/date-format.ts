/**
 * Pure, locale-leak-free date/time formatting core.
 *
 * The fix for PR #2654's locale-baggage bug: we NEVER swap the Intl locale to
 * change day/month/year order. Instead we (1) convert the UTC instant to the
 * user's timezone with a FIXED `"en-US"` `Intl.formatToParts` call — Intl is
 * used only for its correct timezone math and English month/weekday names —
 * then (2) REASSEMBLE the numeric parts in the user's `dateFormat` order with
 * their `timeFormat` (hour12). Output is deterministic and byte-identical on
 * client and server.
 *
 * Detection maps browser hints (locale + timeZone) to concrete enum values,
 * stored on the User row at creation and lazily backfilled thereafter.
 *
 * @see {@link file://./client-hints.tsx} ClientHint / getClientHint
 * @see {@link file://./date-format.server.ts} resolveUserFormatPrefsById
 * @see {@link file://../components/shared/date.tsx} DateS (Phase 3 consumer)
 */
import type {
  DateFormatPreference,
  TimeFormatPreference,
  WeekStartPreference,
} from "@prisma/client";
import type { ClientHint } from "~/utils/client-hints";

/** Raw, possibly-unset user prefs (mirrors the nullable DB columns). */
export type RawFormatPrefs = {
  dateFormat: DateFormatPreference | null;
  timeFormat: TimeFormatPreference | null;
  weekStart: WeekStartPreference | null;
  timeZone: string | null;
};

/** Fully-resolved concrete prefs the formatter consumes. */
export type ResolvedFormatPrefs = {
  dateFormat: DateFormatPreference;
  timeFormat: TimeFormatPreference;
  /** react-day-picker convention: Sun=0, Mon=1, Sat=6. */
  weekStartsOn: 0 | 1 | 6;
  timeZone: string;
};

/** Concrete prefs detected from browser hints, ready to STORE on a User row. */
export type DetectedFormatPrefs = {
  dateFormat: DateFormatPreference;
  timeFormat: TimeFormatPreference;
  weekStart: WeekStartPreference;
  timeZone: string;
};

/**
 * The hardcoded backstop for no-user / no-hints contexts (cron, invites to
 * unregistered emails). US-ish per the locked design decision.
 */
export const HARDCODED_DEFAULT_PREFS: ResolvedFormatPrefs = {
  dateFormat: "MM_DD_YYYY",
  timeFormat: "H12",
  weekStartsOn: 0,
  timeZone: "UTC",
};

/**
 * True when `tz` is an IANA zone `Intl` accepts. Used to reject unvalidated
 * client-hint timezones before they are stored on a User row, and to guard the
 * read path so a corrupted stored value can never throw a `RangeError`.
 *
 * @param tz - a candidate IANA timezone name
 * @returns whether `Intl.DateTimeFormat` accepts it
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Superset of the option shapes DateS callers pass today (facts-02 §C). */
export type DateFormatOptions = {
  weekday?: "long" | "short" | "narrow";
  year?: "numeric" | "2-digit";
  month?: "numeric" | "2-digit" | "short" | "long";
  day?: "numeric" | "2-digit";
  hour?: "numeric" | "2-digit";
  minute?: "numeric" | "2-digit";
  dateStyle?: "short" | "medium" | "long";
  timeStyle?: "short" | "long";
  includeTime?: boolean;
  onlyTime?: boolean;
  /** Absolute date, no timezone conversion (working-hours overrides). */
  localeOnly?: boolean;
};

/** Unambiguous reference date (day 3 ≠ month 4) for reading part order. */
const DATE_ORDER_REF_DATE = new Date(Date.UTC(2026, 3, 3));

/**
 * Detect the day/month/year ordering of a locale's short numeric date.
 *
 * @param locale - BCP-47 locale (e.g. "en-GB")
 * @returns the matching {@link DateFormatPreference}
 */
export function detectDateFormat(locale: string): DateFormatPreference {
  let order: string;
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(DATE_ORDER_REF_DATE);
    order = parts
      .filter(
        (p) => p.type === "year" || p.type === "month" || p.type === "day"
      )
      .map((p) => p.type[0]) // "y" | "m" | "d"
      .join("");
  } catch {
    return HARDCODED_DEFAULT_PREFS.dateFormat;
  }
  if (order[0] === "y") return "YYYY_MM_DD";
  if (order.indexOf("d") < order.indexOf("m")) return "DD_MM_YYYY";
  return "MM_DD_YYYY";
}

/**
 * Detect 12h vs 24h from the locale's resolved `hour12`.
 *
 * @param locale - BCP-47 locale
 * @returns "H12" or "H24"
 */
export function detectTimeFormat(locale: string): TimeFormatPreference {
  try {
    const hour12 = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
    }).resolvedOptions().hour12;
    return hour12 ? "H12" : "H24";
  } catch {
    return HARDCODED_DEFAULT_PREFS.timeFormat;
  }
}

/** Locale-region fallback: regions whose calendars start on Sunday. */
const SUNDAY_START_REGIONS = new Set([
  "US",
  "CA",
  "AU",
  "JP",
  "IL",
  "MX",
  "ZA",
  "BR",
  "PH",
  "KR",
  "IN",
  "HK",
  "TW",
]);

/**
 * Read `Intl.Locale#weekInfo.firstDay` (ISO 1..7, Mon..Sun) where the engine
 * supports it. Returns null if unsupported/invalid so the caller can fall back.
 *
 * @param locale - BCP-47 locale
 * @returns firstDay (1..7) or null when unavailable
 */
function getLocaleFirstDay(locale: string): number | null {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      weekInfo?: { firstDay?: number };
      getWeekInfo?: () => { firstDay?: number };
    };
    const info =
      typeof loc.getWeekInfo === "function" ? loc.getWeekInfo() : loc.weekInfo;
    return info?.firstDay ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect the locale's start-of-week, with a region-table fallback when the
 * engine lacks `weekInfo`.
 *
 * @param locale - BCP-47 locale
 * @returns the matching {@link WeekStartPreference}
 */
export function detectWeekStart(locale: string): WeekStartPreference {
  const firstDay = getLocaleFirstDay(locale);
  if (firstDay === 7) return "SUNDAY";
  if (firstDay === 6) return "SATURDAY";
  if (firstDay != null) return "MONDAY"; // 1 (Mon) or the uncommon 2..5
  // weekInfo unsupported → region table (default MONDAY).
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).region ?? undefined;
  } catch {
    region = undefined;
  }
  return region && SUNDAY_START_REGIONS.has(region) ? "SUNDAY" : "MONDAY";
}

/**
 * Map browser hints to the four concrete prefs to STORE on a User row
 * (user creation + lazy backfill).
 *
 * @param hints - `{ locale, timeZone }`
 * @returns concrete {@link DetectedFormatPrefs}
 */
export function detectFormatPrefsFromHints(
  hints: ClientHint
): DetectedFormatPrefs {
  return {
    dateFormat: detectDateFormat(hints.locale),
    timeFormat: detectTimeFormat(hints.locale),
    weekStart: detectWeekStart(hints.locale),
    // The CH-time-zone cookie is user-controlled and can be forged; never store
    // an invalid IANA zone (a bad value throws RangeError at every format call,
    // and would silently break email fan-outs). Fall back to UTC.
    timeZone: isValidTimeZone(hints.timeZone)
      ? hints.timeZone
      : HARDCODED_DEFAULT_PREFS.timeZone,
  };
}

/** Map the WeekStartPreference enum to react-day-picker's day index. */
function weekStartEnumToIndex(weekStart: WeekStartPreference): 0 | 1 | 6 {
  switch (weekStart) {
    case "MONDAY":
      return 1;
    case "SATURDAY":
      return 6;
    case "SUNDAY":
    default:
      return 0;
  }
}

/**
 * Resolve raw (possibly-null) user prefs against optional browser hints into
 * fully concrete prefs. This is the ONLY place a `null` field is interpreted:
 * per field, stored value → detect-from-hints → {@link HARDCODED_DEFAULT_PREFS}.
 *
 * @param userPrefs - the user's raw prefs, or null (no session)
 * @param hints - browser hints, or null (no request context)
 * @returns concrete {@link ResolvedFormatPrefs}
 */
export function resolveFormatPrefs(
  userPrefs: RawFormatPrefs | null,
  hints: ClientHint | null
): ResolvedFormatPrefs {
  // Detect once; each field falls back to its detected value independently.
  const detected = hints ? detectFormatPrefsFromHints(hints) : null;

  const weekStartEnum = userPrefs?.weekStart ?? detected?.weekStart ?? null;

  // Rows written before timezone validation existed (or via any other path)
  // may hold an invalid zone; never resolve to one — it would throw at format
  // time. `detected` is already validated in detectFormatPrefsFromHints.
  const candidateTimeZone =
    userPrefs?.timeZone ??
    detected?.timeZone ??
    HARDCODED_DEFAULT_PREFS.timeZone;

  return {
    dateFormat:
      userPrefs?.dateFormat ??
      detected?.dateFormat ??
      HARDCODED_DEFAULT_PREFS.dateFormat,
    timeFormat:
      userPrefs?.timeFormat ??
      detected?.timeFormat ??
      HARDCODED_DEFAULT_PREFS.timeFormat,
    weekStartsOn: weekStartEnum
      ? weekStartEnumToIndex(weekStartEnum)
      : HARDCODED_DEFAULT_PREFS.weekStartsOn,
    timeZone: isValidTimeZone(candidateTimeZone)
      ? candidateTimeZone
      : HARDCODED_DEFAULT_PREFS.timeZone,
  };
}

/** Order + numeric separator for each date-format preference. */
const DATE_ORDER: Record<
  DateFormatPreference,
  {
    order: [
      "day" | "month" | "year",
      "day" | "month" | "year",
      "day" | "month" | "year",
    ];
    separator: string;
  }
> = {
  DD_MM_YYYY: { order: ["day", "month", "year"], separator: "/" },
  MM_DD_YYYY: { order: ["month", "day", "year"], separator: "/" },
  YYYY_MM_DD: { order: ["year", "month", "day"], separator: "-" },
};

/** dateStyle preset → explicit fields. `short` is zero-padded, 4-digit year. */
const DATE_STYLE_PRESETS: Record<
  NonNullable<DateFormatOptions["dateStyle"]>,
  Pick<DateFormatOptions, "year" | "month" | "day">
> = {
  short: { year: "numeric", month: "2-digit", day: "2-digit" },
  medium: { year: "numeric", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
};

/** timeStyle preset → explicit fields (`long` adds a short tz name). */
const TIME_STYLE_PRESETS: Record<
  NonNullable<DateFormatOptions["timeStyle"]>,
  { hour: "numeric"; minute: "2-digit"; timeZoneName?: "short" }
> = {
  short: { hour: "numeric", minute: "2-digit" },
  long: { hour: "numeric", minute: "2-digit", timeZoneName: "short" },
};

/** Zero-pad a numeric string part to two digits. */
function pad2(value: string): string {
  return value.length >= 2 ? value : `0${value}`.slice(-2);
}

/**
 * Run a fixed-"en-US" formatToParts against the instant and return a
 * type→value map (literals dropped). `timeZone` undefined ⇒ no conversion.
 *
 * @param date - the instant to format
 * @param timeZone - IANA tz to convert into, or undefined for no conversion
 * @param intlOptions - the Intl field set to request
 * @returns a `type → value` map with `literal` parts removed
 */
function partsFor(
  date: Date,
  timeZone: string | undefined,
  intlOptions: Intl.DateTimeFormatOptions
): Record<string, string> {
  const options: Intl.DateTimeFormatOptions = { ...intlOptions };
  if (timeZone) options.timeZone = timeZone;
  // Defense-in-depth: an invalid timeZone makes the constructor throw a
  // RangeError. resolveFormatPrefs already rejects bad zones, but this is on the
  // hot path for every recipient in email fan-outs — one corrupted row must
  // never throw mid-loop and drop everyone else's notifications. Fall back to UTC.
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", options);
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", {
      ...intlOptions,
      timeZone: "UTC",
    });
  }
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

/** Normalized, assembly-ready view of the caller's DateFormatOptions. */
type NormalizedOptions = {
  wantDate: boolean;
  wantTime: boolean;
  includeYear: boolean;
  includeMonth: boolean;
  includeDay: boolean;
  weekday?: "long" | "short" | "narrow";
  monthStyle: "numeric" | "2-digit" | "short" | "long";
  yearStyle: "numeric" | "2-digit";
  dayStyle: "numeric" | "2-digit";
  hourStyle: "numeric" | "2-digit";
  timeZoneName?: "short";
};

/**
 * Fold dateStyle/timeStyle presets + granular fields into one explicit spec,
 * deciding which date/time pieces to render. Defaults (no explicit fields) =
 * canonical zero-padded numeric date, matching the DateFormatPreference token
 * (e.g. MM/dd/yyyy) so dateStyle:short and the plain path agree (bug #2).
 *
 * @param opts - the caller's DateFormatOptions
 * @returns a fully-resolved {@link NormalizedOptions}
 */
function normalizeOptions(opts: DateFormatOptions): NormalizedOptions {
  const fromDateStyle = opts.dateStyle
    ? DATE_STYLE_PRESETS[opts.dateStyle]
    : {};
  const fromTimeStyle: {
    hour?: "numeric";
    minute?: "2-digit";
    timeZoneName?: "short";
  } = opts.timeStyle ? TIME_STYLE_PRESETS[opts.timeStyle] : {};
  const granular: Pick<
    DateFormatOptions,
    "weekday" | "year" | "month" | "day" | "hour" | "minute"
  > = {};
  for (const key of [
    "weekday",
    "year",
    "month",
    "day",
    "hour",
    "minute",
  ] as const) {
    if (opts[key] != null) granular[key] = opts[key] as never;
  }
  const merged = { ...fromDateStyle, ...fromTimeStyle, ...granular };
  const anyExplicit =
    Object.keys(merged).length > 0 ||
    Boolean(opts.dateStyle) ||
    Boolean(opts.timeStyle);

  const wantTime =
    opts.onlyTime === true ||
    Boolean(opts.timeStyle) ||
    merged.hour != null ||
    merged.minute != null ||
    (opts.includeTime === true && !opts.dateStyle);

  const wantDate = opts.onlyTime
    ? false
    : Boolean(opts.dateStyle) ||
      merged.weekday != null ||
      merged.year != null ||
      merged.month != null ||
      merged.day != null ||
      !anyExplicit; // bare call ⇒ full numeric date

  // Field inclusion: explicit ⇒ only requested date fields; bare ⇒ all three.
  const includeYear =
    wantDate &&
    (merged.year != null || Boolean(opts.dateStyle) || !anyExplicit);
  const includeMonth =
    wantDate &&
    (merged.month != null || Boolean(opts.dateStyle) || !anyExplicit);
  const includeDay =
    wantDate && (merged.day != null || Boolean(opts.dateStyle) || !anyExplicit);

  return {
    wantDate,
    wantTime,
    includeYear,
    includeMonth,
    includeDay,
    weekday: merged.weekday,
    monthStyle: merged.month ?? "2-digit",
    yearStyle: merged.year ?? "numeric",
    dayStyle: merged.day ?? "2-digit",
    hourStyle: merged.hour ?? "numeric",
    timeZoneName: fromTimeStyle.timeZoneName,
  };
}

/**
 * Render a date whose month is an English NAME, in the English convention for
 * the given ordering: "Jun 22, 2026" (M-D-Y), "22 Jun 2026" (D-M-Y),
 * "2026 Jun 22" (Y-M-D). Only fields flagged active are included.
 *
 * @param activeOrder - the ordered, filtered list of date fields to render
 * @param rendered - the pre-rendered string values for each date field
 * @param dateFormat - the user's date-format preference (drives the convention)
 * @returns the assembled name-month date string
 */
function renderNameMonth(
  activeOrder: ("day" | "month" | "year")[],
  rendered: { day: string; month: string; year: string },
  dateFormat: DateFormatPreference
): string {
  if (dateFormat === "MM_DD_YYYY") {
    const hasYear = activeOrder.includes("year");
    const monthDay = activeOrder
      .filter((f) => f !== "year")
      .map((f) => rendered[f])
      .join(" ");
    return hasYear ? `${monthDay}, ${rendered.year}` : monthDay;
  }
  // D-M-Y and Y-M-D: space-separated, no comma.
  return activeOrder.map((f) => rendered[f]).join(" ");
}

/**
 * The pure formatter. Converts `value` (UTC instant) to `prefs.timeZone` and
 * reassembles the parts in `prefs.dateFormat` order using `prefs.timeFormat`.
 * Identical output on client and server; no locale leakage.
 *
 * @param value - a Date or an ISO/parseable date string (interpreted as UTC)
 * @param prefs - resolved user prefs (order, hour12, timezone)
 * @param opts - optional field/preset selection (DateS-compatible superset)
 * @returns the formatted string (date, time, or "date, time")
 */
export function formatDate(
  value: string | Date,
  prefs: ResolvedFormatPrefs,
  opts: DateFormatOptions = {}
): string {
  // A bare `YYYY-MM-DD` string is a calendar date with no instant. `new Date()`
  // parses it as UTC midnight, which shifts a day when rendered in a non-UTC
  // zone (e.g. "2026-06-22" → "06/21/2026" in America/New_York). Parse it as a
  // LOCAL date and never apply timezone conversion, so the calendar date renders
  // exactly as given — for custom-field DATE values, filter chips, etc.
  const dateOnlyMatch =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value.split("-").map(Number)
      : null;
  const date = dateOnlyMatch
    ? new Date(dateOnlyMatch[0], dateOnlyMatch[1] - 1, dateOnlyMatch[2])
    : value instanceof Date
    ? value
    : new Date(value);
  const timeZone =
    opts.localeOnly || dateOnlyMatch ? undefined : prefs.timeZone;
  const n = normalizeOptions(opts);

  // One conversion for all numeric parts (year/month/day/hour/minute) in tz.
  const numeric = partsFor(date, timeZone, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: prefs.timeFormat === "H12",
  });

  const out: string[] = [];

  if (n.wantDate) {
    const { order, separator } = DATE_ORDER[prefs.dateFormat];
    const isNameMonth = n.monthStyle === "short" || n.monthStyle === "long";

    const rendered = {
      year: n.yearStyle === "2-digit" ? numeric.year.slice(-2) : numeric.year,
      month: isNameMonth
        ? partsFor(date, timeZone, { month: n.monthStyle }).month // English name
        : n.monthStyle === "2-digit"
        ? pad2(numeric.month)
        : numeric.month,
      day: n.dayStyle === "2-digit" ? pad2(numeric.day) : numeric.day,
    };

    const include = {
      year: n.includeYear,
      month: n.includeMonth,
      day: n.includeDay,
    };
    const activeOrder = order.filter((field) => include[field]);

    let dateStr = isNameMonth
      ? renderNameMonth(activeOrder, rendered, prefs.dateFormat)
      : activeOrder.map((field) => rendered[field]).join(separator);

    if (n.weekday != null) {
      const weekday = partsFor(date, timeZone, {
        weekday: n.weekday,
      }).weekday;
      dateStr = dateStr ? `${weekday}, ${dateStr}` : weekday;
    }
    if (dateStr) out.push(dateStr);
  }

  if (n.wantTime) {
    let timeStr: string;
    if (prefs.timeFormat === "H12") {
      // Intl already yields "5", "05", "PM" for hour12 — read them directly.
      const dp = partsFor(date, timeZone, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      timeStr = `${dp.hour}:${dp.minute} ${dp.dayPeriod}`;
    } else {
      const hour =
        n.hourStyle === "2-digit" ? pad2(numeric.hour) : numeric.hour;
      timeStr = `${hour}:${numeric.minute}`;
    }
    if (n.timeZoneName) {
      const tzName = partsFor(date, timeZone, {
        hour: "numeric",
        timeZoneName: n.timeZoneName,
        hour12: prefs.timeFormat === "H12",
      }).timeZoneName;
      timeStr = `${timeStr} ${tzName}`;
    }
    out.push(timeStr);
  }

  return out.join(", ");
}
