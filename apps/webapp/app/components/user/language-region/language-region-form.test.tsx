/**
 * LanguageRegionForm / FormatPrefsFormSchema — unit tests
 *
 * Verifies the Zod schema accepts the four concrete format-preference fields
 * (enum-validated + a valid IANA timezone string) and rejects invalid enum
 * members and empty/unknown time zones.
 *
 * @see {@link file://./language-region-form.tsx}
 */
import { describe, it, expect } from "vitest";
import { FormatPrefsFormSchema } from "./language-region-form";

describe("FormatPrefsFormSchema", () => {
  it("accepts valid concrete preferences", () => {
    const result = FormatPrefsFormSchema.safeParse({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Europe/London",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid date-format enum member", () => {
    const result = FormatPrefsFormSchema.safeParse({
      dateFormat: "AUTO",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Europe/London",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown time zone", () => {
    const result = FormatPrefsFormSchema.safeParse({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "Not/AZone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty time zone", () => {
    const result = FormatPrefsFormSchema.safeParse({
      dateFormat: "DD_MM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "",
    });
    expect(result.success).toBe(false);
  });
});
