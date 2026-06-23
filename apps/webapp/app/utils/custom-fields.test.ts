import type { CustomField } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildCustomFieldValue } from "./custom-fields";

/**
 * Tests for DATE custom-field coercion in {@link buildCustomFieldValue}.
 *
 * Regression guard for the silent import-corruption bug: non-ISO date input
 * (notably dash-separated "03-04-2026") used to be positionally split and
 * stored as a wildly wrong date (~1908) with no error, because the resulting
 * JS Date was technically valid. Import dates are an ISO YYYY-MM-DD contract;
 * anything else must fail loudly rather than corrupt the queryable valueDate.
 */
describe("buildCustomFieldValue — DATE", () => {
  const dateField = {
    id: "cf_date",
    name: "Purchase date",
    type: "DATE",
  } as unknown as CustomField;

  it("accepts a valid ISO YYYY-MM-DD date and stores UTC-midnight valueDate", () => {
    const result = buildCustomFieldValue({ raw: "2026-04-03" }, dateField);

    expect(result).toEqual({
      raw: "2026-04-03",
      valueDate: "2026-04-03T00:00:00.000Z",
    });
  });

  it("rejects dash-separated non-ISO input instead of silently storing a wrong year", () => {
    // why: the original bug — "03-04-2026" → [3,4,2026] → Date.UTC(3,3,2026) ≈ 1908.
    expect(() =>
      buildCustomFieldValue({ raw: "03-04-2026" }, dateField)
    ).toThrowError(/YYYY-MM-DD/);
  });

  it("rejects slash-separated input", () => {
    expect(() =>
      buildCustomFieldValue({ raw: "03/04/2026" }, dateField)
    ).toThrowError(/YYYY-MM-DD/);
  });

  it("rejects an impossible calendar date that JS Date would otherwise roll over", () => {
    // 2026-02-31 would normalize to 2026-03-03 without the round-trip check.
    expect(() =>
      buildCustomFieldValue({ raw: "2026-02-31" }, dateField)
    ).toThrowError(/real calendar date/);
  });

  it("rejects a 13th month", () => {
    expect(() =>
      buildCustomFieldValue({ raw: "2026-13-01" }, dateField)
    ).toThrowError();
  });

  it("returns undefined for an empty value (unchanged skip behavior)", () => {
    expect(buildCustomFieldValue({ raw: "" }, dateField)).toBeUndefined();
  });

  it("trims surrounding whitespace before validating", () => {
    const result = buildCustomFieldValue({ raw: "  2026-04-03  " }, dateField);

    expect(result).toEqual({
      raw: "2026-04-03",
      valueDate: "2026-04-03T00:00:00.000Z",
    });
  });
});
