import { describe, expect, it } from "vitest";
import {
  NUMERIC_DATE_OPTIONS,
  dateFormatToLocale,
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
