/**
 * `@shelf/datetime` — pure, locale-leak-free date/time formatting core shared
 * by the webapp and the companion (Expo/React Native) app so their date
 * rendering never drifts. Zero runtime dependencies: it uses only `Intl`, which
 * both Node (webapp SSR) and Hermes (companion) provide. The webapp re-exports
 * this module from `apps/webapp/app/utils/date-format.ts`; the companion
 * consumes it directly.
 *
 * The fix for PR #2654's locale-baggage bug: we NEVER swap the Intl locale to
 * change day/month/year order. Instead we (1) convert the UTC instant to the
 * user's timezone with a FIXED `"en-US"` `Intl.formatToParts` call — Intl is
 * used only for its correct timezone math and English month/weekday names —
 * then (2) REASSEMBLE the numeric parts in the user's `dateFormat` order with
 * their `timeFormat` (hour12). Output is deterministic and byte-identical on
 * client and server.
 *
 * Detection maps browser/runtime hints (locale + timeZone) to concrete enum
 * values, stored on the User row at creation and lazily backfilled thereafter.
 *
 * The three preference unions below mirror the Prisma enums of the same name
 * member-for-member. They are declared locally (not imported from
 * `@prisma/client`) so this package stays free of any webapp/Prisma dependency
 * and bundles cleanly under Metro. Because Prisma generates those enums as
 * string-literal unions, the local unions are structurally identical and stay
 * mutually assignable with the generated types across the webapp re-export.
 */

/** Date-format preference — day/month/year order + month style. Mirrors Prisma. */
export type DateFormatPreference =
  | "DD_MM_YYYY"
  | "MM_DD_YYYY"
  | "YYYY_MM_DD"
  | "MMM_DD_YYYY"
  | "DD_MMM_YYYY";

/** Time-format preference — 12-hour (AM/PM) vs 24-hour clock. Mirrors Prisma. */
export type TimeFormatPreference = "H12" | "H24";

/** Start-of-week preference for calendar/date-picker rendering. Mirrors Prisma. */
export type WeekStartPreference = "MONDAY" | "SUNDAY" | "SATURDAY";

/**
 * Browser/runtime-derived hints the detector maps to concrete prefs. Replaces
 * the webapp's `ClientHint` type so this package carries no webapp import; both
 * apps build the same `{ locale, timeZone }` shape from
 * `Intl.DateTimeFormat().resolvedOptions()`.
 */
export type FormatHints = { locale: string; timeZone: string };

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
  /**
   * Nullable for PERSISTENCE. The timezone comes from the `CH-time-zone` COOKIE,
   * which is absent on a user's first authenticated request (and on
   * server-established sessions like SSO/OAuth callbacks that never render
   * `ClientHintCheck` first). Persisting the "UTC" fallback then is
   * indistinguishable from a real UTC and permanently blocks the lazy backfill
   * from ever writing the true zone — so the webapp's persistence path
   * (`detectFormatPrefsForPersistence` in `client-hints`) sets this to null when
   * the cookie is absent, leaving the column null for a later retry. The
   * in-package read path ({@link detectFormatPrefsFromHints}) always yields a
   * concrete zone.
   */
  timeZone: string | null;
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

/** The valid members of each preference enum, for narrowing untrusted values. */
const DATE_FORMAT_VALUES: readonly DateFormatPreference[] = [
  "DD_MM_YYYY",
  "MM_DD_YYYY",
  "YYYY_MM_DD",
  "MMM_DD_YYYY",
  "DD_MMM_YYYY",
];
const TIME_FORMAT_VALUES: readonly TimeFormatPreference[] = ["H12", "H24"];
const WEEK_START_VALUES: readonly WeekStartPreference[] = [
  "MONDAY",
  "SUNDAY",
  "SATURDAY",
];

/** Type guard: `v` is a known `DateFormatPreference` member. */
function isDateFormat(v: unknown): v is DateFormatPreference {
  return (
    typeof v === "string" &&
    (DATE_FORMAT_VALUES as readonly string[]).includes(v)
  );
}
/** Type guard: `v` is a known `TimeFormatPreference` member. */
function isTimeFormat(v: unknown): v is TimeFormatPreference {
  return (
    typeof v === "string" &&
    (TIME_FORMAT_VALUES as readonly string[]).includes(v)
  );
}
/** Type guard: `v` is a known `WeekStartPreference` member. */
function isWeekStart(v: unknown): v is WeekStartPreference {
  return (
    typeof v === "string" &&
    (WEEK_START_VALUES as readonly string[]).includes(v)
  );
}

/**
 * The calendar-day index of an instant AS SEEN in `timeZone`: whole days from
 * the Unix epoch to that instant's LOCAL calendar date in `timeZone`. Computed
 * identically for any two instants, so
 * `calendarDayIndex(a, tz) - calendarDayIndex(b, tz)` is the signed number of
 * calendar days between them in that zone — the correct basis for relative
 * "today / tomorrow / N days" labels that must agree with a `timeZone`-formatted
 * absolute date (a device-local day count disagrees near midnight when the
 * device zone differs from the preferred one).
 *
 * @param value - a Date or parseable date string (a UTC instant)
 * @param timeZone - the IANA zone the calendar day is measured in
 * @returns whole days since the epoch for that local calendar date
 */
export function calendarDayIndex(
  value: string | Date,
  timeZone: string
): number {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.floor(
    Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000
  );
}

/** An instant's wall-clock reading in some zone, as plain calendar numbers. */
export type WallClockParts = {
  /** Full year, e.g. 2026. */
  year: number;
  /** 1-12, NOT the 0-11 a `Date` constructor wants. */
  month: number;
  /** 1-31. */
  day: number;
  /** 0-23. */
  hour: number;
  /** 0-59. */
  minute: number;
};

/**
 * What a clock on the wall in `timeZone` reads at the given instant.
 *
 * The returned numbers carry no zone of their own — they are what a person
 * standing in `timeZone` would see, which is exactly what a naive wall-clock
 * wire string (`"2026-08-20T09:00"`) and a native date picker both deal in.
 * Pair them with the zone they were read in, or they mean nothing.
 *
 * `month` is 1-12 so the parts read like the wire format. Remember to subtract
 * one when feeding a `Date` constructor.
 *
 * @param value - a Date or parseable date string (a UTC instant)
 * @param timeZone - the IANA zone to read the clock in
 * @returns the calendar/clock fields as seen in that zone
 */
export function wallClockPartsInZone(
  value: string | Date,
  timeZone: string
): WallClockParts {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/**
 * A `Date` whose LOCAL fields carry an instant's wall clock in `timeZone`.
 *
 * The result is deliberately NOT the instant you passed in, and comparing it to
 * one is meaningless. It is a carrier: `getFullYear()` … `getMinutes()` on it
 * return what a clock in `timeZone` reads, which is what a UI that can only
 * speak `Date` in the runtime's own zone needs in order to display and edit
 * another zone's wall clock. React Native's date picker is exactly that UI.
 *
 * Round-trip it with {@link wallClockWireString} to get the naive wire string,
 * and send the zone alongside — the pair is what carries the meaning. Never
 * hand one of these to anything expecting a real instant (an API that wants an
 * ISO timestamp, a duration subtraction, a sort against real instants).
 *
 * Day arithmetic on the result works in wall-clock terms, which is usually what
 * a form default wants: `d.setDate(d.getDate() + 1)` moves to the next calendar
 * day IN `timeZone`. The one caveat is the runtime's own DST — a wall clock the
 * runtime zone skips cannot be represented by a `Date`, so it lands an hour
 * off. That is inherent to picking dates through `Date` and affects the native
 * picker identically.
 *
 * @param value - a Date or parseable date string (a UTC instant)
 * @param timeZone - the IANA zone whose wall clock should be carried
 * @returns a `Date` whose local fields spell that wall clock
 */
export function wallClockDateInZone(
  value: string | Date,
  timeZone: string
): Date {
  const { year, month, day, hour, minute } = wallClockPartsInZone(
    value,
    timeZone
  );
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

/**
 * Serialise a wall-clock carrier to the naive wire format, `yyyy-MM-ddTHH:mm`.
 *
 * Reads the LOCAL fields, so it is the inverse of {@link wallClockDateInZone}
 * and inherits the same contract: the string alone is ambiguous, and the
 * receiver must be told which zone it was written in. Shelf's booking APIs take
 * that as a sibling `timeZone` field.
 *
 * @param wallClock - a carrier from {@link wallClockDateInZone}, or a `Date`
 *   whose local fields are already the wall clock you mean
 * @returns the naive `yyyy-MM-ddTHH:mm` string, no offset, no seconds
 */
export function wallClockWireString(wallClock: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${wallClock.getFullYear()}-${pad(wallClock.getMonth() + 1)}-` +
    `${pad(wallClock.getDate())}T${pad(wallClock.getHours())}:` +
    `${pad(wallClock.getMinutes())}`
  );
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
  /**
   * Prepend the (long) weekday to the FULL preference-formatted date, e.g.
   * "Friday, 2026-07-31". Additive: unlike the `weekday` field option — which,
   * like any explicit field, selects ONLY the named fields — this keeps the
   * whole date and still follows the user's `dateFormat` order/style. Used by
   * absolute-date surfaces like working-hours overrides.
   */
  includeWeekday?: boolean;
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
  hints: FormatHints
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
  hints: FormatHints | null
): ResolvedFormatPrefs {
  // Detect once; each field falls back to its detected value independently.
  const detected = hints ? detectFormatPrefsFromHints(hints) : null;

  // This is the single place a raw preference is interpreted, and `userPrefs`
  // may carry corrupted values or — on the companion, which feeds unvalidated
  // JSON from an independently-deployed server — untrusted ones. `??` only
  // short-circuits null/undefined, so a non-null-but-INVALID value would pass
  // straight through (and a bad timezone would resolve to "UTC" instead of the
  // device hint). Pick the FIRST VALID candidate per field: stored → detected →
  // hardcoded. `detected` values are already validated at detection.
  const rawDate = userPrefs?.dateFormat;
  const rawTime = userPrefs?.timeFormat;
  const rawWeek = userPrefs?.weekStart;
  const rawZone = userPrefs?.timeZone;

  const weekStartEnum: WeekStartPreference | null = isWeekStart(rawWeek)
    ? rawWeek
    : detected?.weekStart ?? null;

  const timeZone =
    rawZone && isValidTimeZone(rawZone)
      ? rawZone
      : detected?.timeZone && isValidTimeZone(detected.timeZone)
      ? detected.timeZone
      : HARDCODED_DEFAULT_PREFS.timeZone;

  return {
    dateFormat: isDateFormat(rawDate)
      ? rawDate
      : detected?.dateFormat ?? HARDCODED_DEFAULT_PREFS.dateFormat,
    timeFormat: isTimeFormat(rawTime)
      ? rawTime
      : detected?.timeFormat ?? HARDCODED_DEFAULT_PREFS.timeFormat,
    weekStartsOn: weekStartEnum
      ? weekStartEnumToIndex(weekStartEnum)
      : HARDCODED_DEFAULT_PREFS.weekStartsOn,
    timeZone,
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
  // Month-name formats. `separator` is only reached if a caller forces numeric
  // months (e.g. dateStyle:short) on a name-month preference; the default
  // name-month path uses renderNameMonth and ignores `separator`.
  MMM_DD_YYYY: { order: ["month", "day", "year"], separator: "/" },
  DD_MMM_YYYY: { order: ["day", "month", "year"], separator: "/" },
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
 * Bounded, module-level cache of `Intl.DateTimeFormat` instances.
 *
 * `formatDate` builds several formatters per call (numeric parts, month name,
 * weekday, time-zone name), so a large export (e.g. 10k rows) would otherwise
 * allocate tens of thousands of formatter objects. Constructing an
 * `Intl.DateTimeFormat` is comparatively expensive; memoizing by
 * `(locale, options)` lets repeated calls with the same shape reuse one
 * instance. This is a pure performance optimization — the same formatter yields
 * byte-identical output, so no caller output changes.
 *
 * `Map` preserves insertion order, so eviction below is FIFO.
 */
const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

/** Max cached formatters before the oldest entry is FIFO-evicted. */
const FORMATTER_CACHE_MAX = 200;

/**
 * Return a memoized `Intl.DateTimeFormat` for `(locale, options)`, constructing
 * one on first use. The cache key includes the locale and every option that
 * affects output (including `timeZone`, via `JSON.stringify`), so distinct
 * shapes never share an instance. Bounded to {@link FORMATTER_CACHE_MAX}
 * entries with FIFO eviction to prevent unbounded growth from many distinct
 * timezones/option shapes.
 *
 * @param locale - the BCP-47 locale (always "en-US" on the format path)
 * @param options - the Intl field set to request (incl. any `timeZone`)
 * @returns the memoized formatter instance
 * @throws {RangeError} if `Intl.DateTimeFormat` rejects the options (e.g. an
 *   invalid `timeZone`) — construction happens before caching, so a bad key is
 *   never stored.
 */
export function getCachedFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = FORMATTER_CACHE.get(key);
  if (cached) return cached;
  // Construct BEFORE mutating the cache so a throwing options set (bad timeZone)
  // never leaves a partially-populated/undefined entry behind.
  const formatter = new Intl.DateTimeFormat(locale, options);
  if (FORMATTER_CACHE.size >= FORMATTER_CACHE_MAX) {
    // Oldest key is first in insertion order — FIFO eviction.
    const oldestKey = FORMATTER_CACHE.keys().next().value;
    if (oldestKey !== undefined) FORMATTER_CACHE.delete(oldestKey);
  }
  FORMATTER_CACHE.set(key, formatter);
  return formatter;
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
    formatter = getCachedFormatter("en-US", options);
  } catch {
    formatter = getCachedFormatter("en-US", {
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

  // `includeWeekday` is ADDITIVE: it prepends the weekday to the FULL
  // pref-formatted date. Unlike the `weekday` FIELD option (an explicit field
  // that selects only the named fields and thus counts toward `anyExplicit`
  // above), the flag must NOT affect explicitness — it is resolved here, AFTER
  // `anyExplicit`, and defaults the weekday to "long" only when the caller
  // didn't already name one.
  const weekday = merged.weekday ?? (opts.includeWeekday ? "long" : undefined);

  const wantTime =
    opts.onlyTime === true ||
    Boolean(opts.timeStyle) ||
    merged.hour != null ||
    merged.minute != null ||
    // `includeTime` is ADDITIVE — it appends the time portion. It must hold even
    // alongside `dateStyle` (a `{ dateStyle, includeTime: true }` caller, e.g.
    // the companion's `formatDateTime` spreading opts, wants "date, time").
    opts.includeTime === true;

  const wantDate = opts.onlyTime
    ? false
    : Boolean(opts.dateStyle) ||
      weekday != null ||
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
    weekday,
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
  if (dateFormat === "MM_DD_YYYY" || dateFormat === "MMM_DD_YYYY") {
    const hasYear = activeOrder.includes("year");
    const monthDay = activeOrder
      .filter((f) => f !== "year")
      .map((f) => rendered[f])
      .join(" ");
    if (!hasYear) return monthDay;
    // A year-only request (`activeOrder === ["year"]`) leaves `monthDay` empty;
    // return the bare year rather than a leading-comma ", 2026".
    return monthDay ? `${monthDay}, ${rendered.year}` : rendered.year;
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

  // A month-NAME date-format preference (e.g. "Jul 20, 2026" / "20 Jul 2026")
  // renders the month as a short NAME by default. Explicit caller options
  // (`month` or a `dateStyle` preset) still win, so numeric prefs and callers
  // that pass e.g. `dateStyle: "short"` stay numeric.
  const prefWantsNameMonth =
    prefs.dateFormat === "MMM_DD_YYYY" || prefs.dateFormat === "DD_MMM_YYYY";
  const callerSpecifiedMonth = opts.month != null || opts.dateStyle != null;
  const callerSpecifiedDay = opts.day != null || opts.dateStyle != null;
  const effectiveMonthStyle =
    prefWantsNameMonth && !callerSpecifiedMonth ? "short" : n.monthStyle;
  // Name-month formats read more naturally with a non-padded day
  // ("Jul 3, 2026", not "Jul 03, 2026"); an explicit day/dateStyle still wins.
  const effectiveDayStyle =
    prefWantsNameMonth && !callerSpecifiedDay ? "numeric" : n.dayStyle;

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
    const isNameMonth =
      effectiveMonthStyle === "short" || effectiveMonthStyle === "long";

    const rendered = {
      year: n.yearStyle === "2-digit" ? numeric.year.slice(-2) : numeric.year,
      month: isNameMonth
        ? partsFor(date, timeZone, { month: effectiveMonthStyle }).month // name
        : effectiveMonthStyle === "2-digit"
        ? pad2(numeric.month)
        : numeric.month,
      day: effectiveDayStyle === "2-digit" ? pad2(numeric.day) : numeric.day,
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
      // Honour an explicit `hour: "2-digit"` so the H12 clock zero-pads like the
      // H24 branch below ("05:30 PM"), instead of the two disagreeing.
      const hour = n.hourStyle === "2-digit" ? pad2(dp.hour) : dp.hour;
      timeStr = `${hour}:${dp.minute} ${dp.dayPeriod}`;
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

/* ────────────────────────── Calendar range helpers ─────────────────────────
 * Day-level range maths for calendar surfaces. Formatting lives above; this is
 * about WHICH DAYS a booking touches, which is a different question and one
 * both apps will ask if web ever redraws its calendar from our own primitives.
 * Kept here rather than in the companion so the answer can never differ
 * between surfaces, and so it is testable without a React Native runtime.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * `YYYY-MM-DD` for a date, in the LOCAL timezone.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first, so
 * a booking at 22:00 on the 7th in UTC+3 would be keyed to the 8th and its band
 * would be drawn on the wrong day.
 *
 * @param date - the instant to key
 * @param timeZone - IANA zone to measure the calendar day in. Pass the user's
 *   preferred zone whenever the key will be shown next to a date rendered in
 *   that zone: with the device on a different zone, a booking near midnight
 *   otherwise gets marked on one day and displays as another.
 * @returns the calendar day in `timeZone` (or the device zone), zero padded
 */
export function calendarDayKey(date: Date, timeZone?: string): string {
  if (timeZone) {
    // Same mechanism as calendarDayIndex: the only way to ask what calendar
    // date an instant falls on in a zone that is not the device's.
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The inverse of {@link calendarDayKey}: a `YYYY-MM-DD` key back to a local Date
 * at midnight.
 *
 * Deliberately not `new Date(key)`. A bare `YYYY-MM-DD` is parsed as UTC
 * midnight by the ECMAScript date-only form, so anywhere west of UTC the Date
 * lands on the PREVIOUS day: `2026-09-01` in Los Angeles becomes 31 August.
 * Anything that then reads `getMonth()` gets the wrong month, and a calendar
 * built on that asks the server for the month before the one on screen. The
 * bug is invisible east of UTC, which is exactly why it needs its own function.
 *
 * @param key - a `YYYY-MM-DD` day key
 * @returns local midnight on that day, or an Invalid Date when unparseable
 */
export function calendarDayKeyToDate(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return new Date(NaN);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * The range a one-month calendar view loads: EXACTLY the weeks a month grid
 * draws, so a booking that began in the previous month still paints its band
 * into this one.
 *
 * why week-aligned and not a flat week either side: a month grid renders whole
 * weeks, so it shows at most six days of each neighbouring month. A flat
 * seven-day pad fetched a fringe the grid has no square for, and a booking
 * landing in it was drawn nowhere while still counting as INSIDE the window -
 * so the "N more outside this month" line stayed hidden too. It was invisible
 * with nothing to explain it. Fetching precisely what is rendered makes
 * "overlaps the window" and "is drawn" the same statement.
 *
 * The end is the LAST INSTANT of its day, not midnight. Consumers document an
 * inclusive window and filter on `from <= end`, so a midnight bound silently
 * dropped every booking starting later on the window's final day.
 *
 * @param monthKey - any `YYYY-MM-DD` day inside the month to show
 * @param weekStartsOn - first column of the grid, 0 = Sunday. Must match the
 *   `firstDay` the grid is rendered with, or the window and the squares drift.
 * @returns the inclusive window to request
 */
export function calendarMonthWindow(
  monthKey: string,
  weekStartsOn: number = 0
): {
  start: Date;
  end: Date;
} {
  const base = calendarDayKeyToDate(monthKey);
  const firstOfMonth = new Date(base.getFullYear(), base.getMonth(), 1);
  // Day 0 of the NEXT month is the last day of this one, leap years included.
  const lastOfMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0);

  // Tolerate any integer, including the negatives a bad preference could carry.
  const weekStart = ((Math.trunc(weekStartsOn) % 7) + 7) % 7;
  const weekEnd = (weekStart + 6) % 7;

  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - ((start.getDay() - weekStart + 7) % 7));

  const end = new Date(lastOfMonth);
  end.setDate(end.getDate() + ((weekEnd - end.getDay() + 7) % 7));
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * A `YYYY-MM-DD` key as an instant at UTC midnight, purely so day ranges can be
 * walked without the device's zone or its DST jumps entering into it. This is
 * NOT the same as {@link calendarDayKeyToDate}, which deliberately returns a
 * LOCAL date for callers that read month and day off it.
 */
function keyToUtcMidnight(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Upper bound on the days one range may enumerate. */
const MAX_RANGE_DAYS = 400;

/**
 * Every local day key a range covers, inclusive of both ends.
 *
 * A booking is a range, so a five-day job must be drawable as one continuous
 * run rather than five unrelated marks.
 *
 * @param from - ISO start instant
 * @param to - ISO end instant
 * @returns ordered day keys; empty when the range is reversed or unparseable,
 *   and capped so corrupt data cannot spin the caller
 */
export function calendarDaysCovered(
  from: string,
  to: string,
  clip?: { from: Date; to: Date },
  timeZone?: string
): string[] {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

  // Iterate pure calendar dates, anchored to UTC midnight so the walk cannot
  // drift across a DST boundary. Which date each instant belongs to is decided
  // by calendarDayKey, in `timeZone` when one is given.
  const cursor = keyToUtcMidnight(calendarDayKey(start, timeZone));
  const last = keyToUtcMidnight(calendarDayKey(end, timeZone));

  /**
   * With a clip, only the days inside it are enumerated. A caller drawing one
   * month does not need the other 900 days of a two-year booking, and without
   * this the MAX_RANGE_DAYS cap counts from the booking's own start - so a
   * booking longer than the cap produced no keys at all for the month on
   * screen, and simply vanished from it.
   */
  if (clip) {
    const clipFrom = keyToUtcMidnight(calendarDayKey(clip.from, timeZone));
    const clipTo = keyToUtcMidnight(calendarDayKey(clip.to, timeZone));
    if (cursor < clipFrom) cursor.setTime(clipFrom.getTime());
    if (last > clipTo) last.setTime(clipTo.getTime());
  }

  const keys: string[] = [];
  while (cursor <= last && keys.length < MAX_RANGE_DAYS) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}
