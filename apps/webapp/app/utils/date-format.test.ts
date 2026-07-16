import { describe, expect, it } from "vitest";
import {
  HARDCODED_DEFAULT_PREFS,
  detectDateFormat,
  detectFormatPrefsFromHints,
  detectTimeFormat,
  detectWeekStart,
  resolveFormatPrefs,
} from "./date-format";

describe("HARDCODED_DEFAULT_PREFS", () => {
  it("is the US-ish backstop used when there is no user + no hints", () => {
    expect(HARDCODED_DEFAULT_PREFS).toEqual({
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      weekStartsOn: 0,
      timeZone: "UTC",
    });
  });
});

describe("detectDateFormat", () => {
  it("reads day/month/year part ORDER from the locale", () => {
    expect(detectDateFormat("en-US")).toBe("MM_DD_YYYY"); // m d y
    expect(detectDateFormat("en-GB")).toBe("DD_MM_YYYY"); // d m y
    expect(detectDateFormat("de-DE")).toBe("DD_MM_YYYY"); // d m y
    expect(detectDateFormat("fr-FR")).toBe("DD_MM_YYYY"); // d m y
    expect(detectDateFormat("en-CA")).toBe("YYYY_MM_DD"); // y m d
    expect(detectDateFormat("ja-JP")).toBe("YYYY_MM_DD"); // y m d
  });
});

describe("detectTimeFormat", () => {
  it("maps hour12 → H12/H24", () => {
    expect(detectTimeFormat("en-US")).toBe("H12");
    expect(detectTimeFormat("en-CA")).toBe("H12");
    expect(detectTimeFormat("en-GB")).toBe("H24");
    expect(detectTimeFormat("de-DE")).toBe("H24");
    expect(detectTimeFormat("ja-JP")).toBe("H24");
    expect(detectTimeFormat("fr-FR")).toBe("H24");
  });
});

describe("detectWeekStart", () => {
  it("maps weekInfo.firstDay (ISO 1..7) to the enum", () => {
    expect(detectWeekStart("en-US")).toBe("SUNDAY"); // firstDay 7
    expect(detectWeekStart("en-CA")).toBe("SUNDAY"); // firstDay 7
    expect(detectWeekStart("ja-JP")).toBe("SUNDAY"); // firstDay 7
    expect(detectWeekStart("en-GB")).toBe("MONDAY"); // firstDay 1
    expect(detectWeekStart("de-DE")).toBe("MONDAY"); // firstDay 1
    expect(detectWeekStart("fr-FR")).toBe("MONDAY"); // firstDay 1
  });

  it("never throws on a junk locale (region/default fallback)", () => {
    expect(() => detectWeekStart("xx-INVALID")).not.toThrow();
    expect(["MONDAY", "SUNDAY", "SATURDAY"]).toContain(
      detectWeekStart("xx-INVALID")
    );
  });
});

describe("detectFormatPrefsFromHints", () => {
  it("produces all four concrete prefs from locale + timeZone", () => {
    expect(
      detectFormatPrefsFromHints({ locale: "en-GB", timeZone: "Europe/London" })
    ).toEqual({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Europe/London",
    });
    expect(
      detectFormatPrefsFromHints({
        locale: "en-US",
        timeZone: "America/New_York",
      })
    ).toEqual({
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      weekStart: "SUNDAY",
      timeZone: "America/New_York",
    });
  });

  it("carries the timeZone hint through verbatim", () => {
    expect(
      detectFormatPrefsFromHints({ locale: "ja-JP", timeZone: "Asia/Tokyo" })
        .timeZone
    ).toBe("Asia/Tokyo");
  });
});

describe("resolveFormatPrefs", () => {
  const enGB = { locale: "en-GB", timeZone: "Europe/London" };

  it("prefers stored values over hints and defaults", () => {
    const r = resolveFormatPrefs(
      {
        dateFormat: "YYYY_MM_DD",
        timeFormat: "H24",
        weekStart: "SATURDAY",
        timeZone: "Asia/Tokyo",
      },
      enGB
    );
    expect(r).toEqual({
      dateFormat: "YYYY_MM_DD",
      timeFormat: "H24",
      weekStartsOn: 6,
      timeZone: "Asia/Tokyo",
    });
  });

  it("falls back per-null-field to hint detection", () => {
    const r = resolveFormatPrefs(
      { dateFormat: null, timeFormat: null, weekStart: null, timeZone: null },
      enGB
    );
    expect(r).toEqual({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStartsOn: 1, // MONDAY
      timeZone: "Europe/London",
    });
  });

  it("mixes stored + hint-detected fields independently", () => {
    const r = resolveFormatPrefs(
      {
        dateFormat: "MM_DD_YYYY",
        timeFormat: null,
        weekStart: null,
        timeZone: null,
      },
      enGB
    );
    expect(r.dateFormat).toBe("MM_DD_YYYY"); // stored
    expect(r.timeFormat).toBe("H24"); // detected from en-GB
    expect(r.weekStartsOn).toBe(1); // detected from en-GB
    expect(r.timeZone).toBe("Europe/London"); // hint
  });

  it("uses the hardcoded default when there is neither a user nor hints", () => {
    expect(resolveFormatPrefs(null, null)).toEqual(HARDCODED_DEFAULT_PREFS);
  });

  it("maps the weekStart enum to weekStartsOn (MONDAY→1, SUNDAY→0, SATURDAY→6)", () => {
    const base = {
      dateFormat: null,
      timeFormat: null,
      timeZone: null,
    } as const;
    expect(
      resolveFormatPrefs({ ...base, weekStart: "MONDAY" }, null).weekStartsOn
    ).toBe(1);
    expect(
      resolveFormatPrefs({ ...base, weekStart: "SUNDAY" }, null).weekStartsOn
    ).toBe(0);
    expect(
      resolveFormatPrefs({ ...base, weekStart: "SATURDAY" }, null).weekStartsOn
    ).toBe(6);
  });
});

import { formatDate, isValidTimeZone } from "./date-format";
import type {
  DateFormatOptions,
  RawFormatPrefs,
  ResolvedFormatPrefs,
} from "./date-format";

// Reference prefs across three orderings / time formats / timezones.
const US: ResolvedFormatPrefs = {
  dateFormat: "MM_DD_YYYY",
  timeFormat: "H12",
  weekStartsOn: 0,
  timeZone: "America/New_York",
};
const GB: ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H24",
  weekStartsOn: 1,
  timeZone: "Europe/Sofia",
};
const CA: ResolvedFormatPrefs = {
  dateFormat: "YYYY_MM_DD",
  timeFormat: "H24",
  weekStartsOn: 0,
  timeZone: "Asia/Tokyo",
};
// UTC 2026-06-22T21:05 → NY 17:05 (same day), Tokyo 06:05 (next day), Sofia 00:05 (next day).
const V = "2026-06-22T21:05:00Z";

describe("formatDate — reassembly + timezone conversion", () => {
  it("plain numeric is zero-padded 4-digit-year in the pref order", () => {
    expect(formatDate(V, US)).toBe("06/22/2026");
    expect(formatDate(V, GB)).toBe("23/06/2026"); // Sofia next day
    expect(formatDate(V, CA)).toBe("2026-06-23"); // Tokyo next day, ISO separator
  });

  it("converts the UTC instant to the pref timezone (cross-day boundaries)", () => {
    expect(formatDate(V, CA, { includeTime: true })).toBe("2026-06-23, 06:05");
    expect(formatDate(V, GB, { includeTime: true })).toBe("23/06/2026, 00:05");
  });

  it("honors H12 vs H24 for the time portion", () => {
    expect(formatDate(V, US, { onlyTime: true })).toBe("5:05 PM");
    expect(formatDate(V, GB, { onlyTime: true })).toBe("00:05");
  });

  it("localeOnly skips tz conversion (uses the wall-clock date as-is)", () => {
    // Date-only string: no shift regardless of the (America/New_York) tz.
    expect(formatDate("2026-06-22", US, { localeOnly: true })).toBe(
      "06/22/2026"
    );
  });

  it("handles a DST (winter) boundary correctly", () => {
    // UTC 05:30 in Jan → America/New_York (EST) 00:30 same day.
    expect(
      formatDate("2026-01-15T05:30:00Z", US, {
        dateStyle: "short",
        timeStyle: "short",
      })
    ).toBe("01/15/2026, 12:30 AM");
  });

  it("timeStyle:short maps to hour+minute; timeStyle:long appends the tz name", () => {
    expect(formatDate(V, US, { timeStyle: "short" })).toBe("5:05 PM");
    expect(formatDate(V, US, { dateStyle: "short", timeStyle: "long" })).toBe(
      "06/22/2026, 5:05 PM EDT"
    );
  });

  it("accepts a Date instance identically to an ISO string", () => {
    expect(formatDate(new Date(V), US)).toBe(formatDate(V, US));
  });
});

describe("formatDate — previously-broken cases (bug regressions)", () => {
  it("bug #1: YYYY_MM_DD with a month NAME stays year-first (not month-first)", () => {
    expect(
      formatDate(V, CA, { month: "short", day: "numeric", year: "numeric" })
    ).toBe("2026 Jun 23");
  });

  it("bug #2: dateStyle:short matches the numeric path (padded, 4-digit year)", () => {
    expect(formatDate(V, US, { dateStyle: "short" })).toBe(formatDate(V, US));
    expect(formatDate(V, US, { dateStyle: "short" })).toBe("06/22/2026");
  });

  it("bug #3: a partial {month,day} adds NO year", () => {
    expect(formatDate(V, US, { month: "short", day: "numeric" })).toBe(
      "Jun 22"
    );
    expect(formatDate(V, GB, { month: "short", day: "numeric" })).toBe(
      "23 Jun"
    );
  });
});

describe("formatDate — DateS option-shape coverage (facts-02 §C)", () => {
  // C1 (13×): { dateStyle: "short", timeStyle: "short" }
  it("C1 date+time preset", () => {
    expect(formatDate(V, US, { dateStyle: "short", timeStyle: "short" })).toBe(
      "06/22/2026, 5:05 PM"
    );
    expect(formatDate(V, GB, { dateStyle: "short", timeStyle: "short" })).toBe(
      "23/06/2026, 00:05"
    );
  });

  // C2: { dateStyle: "short", timeStyle: "long" }
  it("C2 date + long-tz time preset", () => {
    expect(formatDate(V, US, { dateStyle: "short", timeStyle: "long" })).toBe(
      "06/22/2026, 5:05 PM EDT"
    );
  });

  // C3: { timeStyle: "short" }
  it("C3 time-only preset", () => {
    expect(formatDate(V, US, { timeStyle: "short" })).toBe("5:05 PM");
    expect(formatDate(V, GB, { timeStyle: "short" })).toBe("00:05");
  });

  // C4 (5×): { month: "short", day: "numeric" } — NO year
  it("C4 field-part, no year", () => {
    expect(formatDate(V, US, { month: "short", day: "numeric" })).toBe(
      "Jun 22"
    );
    expect(formatDate(V, GB, { month: "short", day: "numeric" })).toBe(
      "23 Jun"
    );
  });

  // C5: { month: "short", day: "numeric", year: "numeric" }
  it("C5 field-part with year", () => {
    expect(
      formatDate(V, US, { month: "short", day: "numeric", year: "numeric" })
    ).toBe("Jun 22, 2026");
    expect(
      formatDate(V, GB, { month: "short", day: "numeric", year: "numeric" })
    ).toBe("23 Jun 2026");
  });

  // C6: { month: "long", day: "numeric", year: "numeric" }
  it("C6 long month with year", () => {
    expect(
      formatDate(V, US, { month: "long", day: "numeric", year: "numeric" })
    ).toBe("June 22, 2026");
    expect(
      formatDate(V, GB, { month: "long", day: "numeric", year: "numeric" })
    ).toBe("23 June 2026");
  });

  // C7: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
  it("C7 mixed date + time fields", () => {
    expect(
      formatDate(V, US, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    ).toBe("Jun 22, 5:05 PM");
  });

  // C8: { weekday: "long", month: "long", day: "numeric", year: "numeric" }
  it("C8 full weekday + long date", () => {
    expect(
      formatDate(V, US, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    ).toBe("Monday, June 22, 2026");
  });

  // C9: key-order variant of C1 — must equal C1.
  it("C9 timeStyle/dateStyle key order is irrelevant", () => {
    expect(formatDate(V, US, { timeStyle: "short", dateStyle: "short" })).toBe(
      formatDate(V, US, { dateStyle: "short", timeStyle: "short" })
    );
  });

  // C10: dynamic {month:"short", day:"numeric", (year:"numeric")?} — both branches.
  it("C10 dynamically-built field-part options (with/without year)", () => {
    const withoutYear: DateFormatOptions = { month: "short", day: "numeric" };
    const withYear: DateFormatOptions = {
      month: "short",
      day: "numeric",
      year: "numeric",
    };
    expect(formatDate(V, US, withoutYear)).toBe("Jun 22");
    expect(formatDate(V, US, withYear)).toBe("Jun 22, 2026");
  });
});

describe("detectors — representative locale sweep", () => {
  const cases: Array<{
    locale: string;
    dateFormat: "DD_MM_YYYY" | "MM_DD_YYYY" | "YYYY_MM_DD";
    timeFormat: "H12" | "H24";
    weekStart: "MONDAY" | "SUNDAY" | "SATURDAY";
  }> = [
    {
      locale: "en-US",
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      weekStart: "SUNDAY",
    },
    {
      locale: "en-CA",
      dateFormat: "YYYY_MM_DD",
      timeFormat: "H12",
      weekStart: "SUNDAY",
    },
    {
      locale: "en-GB",
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
    },
    {
      locale: "de-DE",
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
    },
    {
      locale: "ja-JP",
      dateFormat: "YYYY_MM_DD",
      timeFormat: "H24",
      weekStart: "SUNDAY",
    },
    {
      locale: "fr-FR",
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
    },
  ];

  it.each(cases)(
    "$locale → $dateFormat / $timeFormat / $weekStart",
    ({ locale, dateFormat, timeFormat, weekStart }) => {
      expect(detectDateFormat(locale)).toBe(dateFormat);
      expect(detectTimeFormat(locale)).toBe(timeFormat);
      expect(detectWeekStart(locale)).toBe(weekStart);
    }
  );
});

describe("formatDate — date-only strings never shift a day (bug: PR review)", () => {
  // A bare YYYY-MM-DD is a calendar date with no instant. It must render as the
  // exact same day in every timezone — previously `new Date("2026-06-22")` was
  // parsed as UTC midnight and rendered "06/21/2026" under America/New_York (US).
  it("renders the given calendar date regardless of prefs.timeZone", () => {
    expect(formatDate("2026-06-22", US)).toBe("06/22/2026"); // NY, not 06/21
    expect(formatDate("2026-06-22", GB)).toBe("22/06/2026");
    expect(formatDate("2026-06-22", CA)).toBe("2026-06-22");
  });

  it("is stable under localeOnly and with a name-month option", () => {
    expect(formatDate("2026-06-22", US, { localeOnly: true })).toBe(
      "06/22/2026"
    );
    expect(
      formatDate("2026-01-01", US, { month: "short", day: "numeric" })
    ).toMatch(/Jan\s+1/);
  });
});

describe("timezone validation — corrupted/forged zones never throw", () => {
  const badRaw: RawFormatPrefs = {
    dateFormat: null,
    timeFormat: null,
    weekStart: null,
    timeZone: "Not/ARealZone",
  };

  it("isValidTimeZone accepts real zones and rejects junk", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Not/ARealZone")).toBe(false);
  });

  it("detectFormatPrefsFromHints falls back to UTC on an invalid zone", () => {
    expect(
      detectFormatPrefsFromHints({ locale: "en-US", timeZone: "Not/ARealZone" })
        .timeZone
    ).toBe("UTC");
  });

  it("resolveFormatPrefs never resolves to an invalid stored zone", () => {
    expect(resolveFormatPrefs(badRaw, null).timeZone).toBe("UTC");
  });

  it("formatDate never throws on an invalid prefs.timeZone (guards the email loop)", () => {
    const corrupted: ResolvedFormatPrefs = { ...US, timeZone: "Not/ARealZone" };
    expect(() => formatDate(V, corrupted)).not.toThrow();
    // Falls back to UTC: V = 2026-06-22T21:05Z → 06/22/2026 in UTC.
    expect(formatDate(V, corrupted)).toBe("06/22/2026");
  });
});
