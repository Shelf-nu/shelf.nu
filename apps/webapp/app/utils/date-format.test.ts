import { describe, expect, it } from "vitest";
import {
  NUMERIC_DATE_OPTIONS,
  dateFormatToLocale,
  mergeDateDisplayOptions,
  resolveDateFormat,
} from "./date-format";

describe("dateFormatToLocale", () => {
  it("maps explicit formats to ordering locales", () => {
    expect(dateFormatToLocale("DD_MM_YYYY")).toBe("en-GB");
    expect(dateFormatToLocale("MM_DD_YYYY")).toBe("en-US");
    expect(dateFormatToLocale("YYYY_MM_DD")).toBe("en-CA");
  });

  it("returns null for AUTO and unknown/absent values", () => {
    expect(dateFormatToLocale("AUTO")).toBeNull();
    expect(dateFormatToLocale(null)).toBeNull();
    expect(dateFormatToLocale(undefined)).toBeNull();
  });
});

describe("resolveDateFormat", () => {
  it("uses the fallback locale and applies no numeric defaults for AUTO", () => {
    const r = resolveDateFormat("AUTO", "fr-FR");
    expect(r).toEqual({
      locale: "fr-FR",
      isExplicit: false,
      numericDefaults: undefined,
    });
  });

  it("overrides locale and supplies numeric defaults for explicit formats", () => {
    const r = resolveDateFormat("DD_MM_YYYY", "en-US");
    expect(r.locale).toBe("en-GB");
    expect(r.isExplicit).toBe(true);
    expect(r.numericDefaults).toBe(NUMERIC_DATE_OPTIONS);
  });
});

/**
 * Load-bearing assumption: the mapped locales, with the zero-padded numeric
 * option set, actually produce the day/month/year ORDER the preference promises.
 * This guards against a locale mapping that silently renders the wrong order.
 */
describe("end-to-end ordering via Intl", () => {
  // April 3rd, 2026 — unambiguous because day (3) ≠ month (4).
  const date = new Date(Date.UTC(2026, 3, 3));

  const fmt = (locale: string) =>
    new Intl.DateTimeFormat(locale, {
      ...NUMERIC_DATE_OPTIONS,
      timeZone: "UTC",
    }).format(date);

  it("renders day-first for DD_MM_YYYY", () => {
    expect(fmt(dateFormatToLocale("DD_MM_YYYY")!)).toBe("03/04/2026");
  });

  it("renders month-first for MM_DD_YYYY", () => {
    expect(fmt(dateFormatToLocale("MM_DD_YYYY")!)).toBe("04/03/2026");
  });

  it("renders year-first for YYYY_MM_DD", () => {
    expect(fmt(dateFormatToLocale("YYYY_MM_DD")!)).toBe("2026-04-03");
  });
});

/**
 * Regression guard (PR #2654 review, Codex P1): combining numeric defaults with
 * the dateStyle/timeStyle shortcuts makes Intl.DateTimeFormat throw. Many call
 * sites pass those shortcuts, so for an explicit (non-AUTO) format the merger
 * must drop the numeric defaults rather than crash the page.
 */
describe("mergeDateDisplayOptions", () => {
  const explicit = NUMERIC_DATE_OPTIONS; // simulates a non-AUTO format

  it("does NOT add granular date fields when caller uses dateStyle/timeStyle", () => {
    const merged = mergeDateDisplayOptions({
      callerOptions: { dateStyle: "short", timeStyle: "short" },
      numericDefaults: explicit,
      includeTime: false,
      onlyTime: false,
    });

    expect(merged).toEqual({ dateStyle: "short", timeStyle: "short" });
    // The actual crash repro: feeding the merged options to Intl must not throw.
    expect(() =>
      new Intl.DateTimeFormat("en-GB", { ...merged, timeZone: "UTC" }).format(
        new Date(Date.UTC(2026, 3, 3))
      )
    ).not.toThrow();
  });

  it("applies numeric defaults for explicit format when no style shortcut", () => {
    const merged = mergeDateDisplayOptions({
      callerOptions: undefined,
      numericDefaults: explicit,
      includeTime: false,
      onlyTime: false,
    });

    expect(merged).toEqual(NUMERIC_DATE_OPTIONS);
  });

  it("reduces to legacy behavior for AUTO (no numeric defaults)", () => {
    expect(
      mergeDateDisplayOptions({
        callerOptions: { month: "short" },
        numericDefaults: undefined,
        includeTime: false,
        onlyTime: false,
      })
    ).toEqual({ month: "short" });
  });

  it("includeTime under a timeStyle shortcut stays Intl-safe (no granular fields)", () => {
    const merged = mergeDateDisplayOptions({
      callerOptions: { timeStyle: "short" },
      numericDefaults: explicit,
      includeTime: true,
      onlyTime: false,
    });

    expect(merged).not.toHaveProperty("day");
    expect(merged).not.toHaveProperty("month");
    // Granular hour/minute must NEVER be mixed with a style shortcut.
    expect(merged).not.toHaveProperty("hour");
    expect(merged).not.toHaveProperty("minute");
    // The merged options must be accepted by Intl (no granular-vs-style throw).
    expect(() => new Intl.DateTimeFormat("en-US", merged)).not.toThrow();
  });

  it("includeTime under a dateStyle shortcut adds timeStyle (not granular) and stays Intl-safe", () => {
    const merged = mergeDateDisplayOptions({
      callerOptions: { dateStyle: "short" },
      numericDefaults: explicit,
      includeTime: true,
      onlyTime: false,
    });

    expect(merged).not.toHaveProperty("hour");
    expect(merged).not.toHaveProperty("minute");
    expect(merged).toMatchObject({ dateStyle: "short", timeStyle: "short" });
    expect(() => new Intl.DateTimeFormat("en-US", merged)).not.toThrow();
  });

  it("returns only time fields for onlyTime", () => {
    expect(
      mergeDateDisplayOptions({
        callerOptions: undefined,
        numericDefaults: explicit,
        includeTime: false,
        onlyTime: true,
      })
    ).toEqual({ timeStyle: "short" });
  });
});
