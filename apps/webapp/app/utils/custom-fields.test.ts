import type { CustomField } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import {
  buildAssetOverviewCustomFields,
  buildCustomFieldValue,
  getCustomFieldDisplayValue,
} from "./custom-fields";

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

describe("getCustomFieldDisplayValue — DATE with prefs", () => {
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };

  it("renders a DATE value in the user's configured order when prefs are given", () => {
    const value = { raw: "2026-04-03", valueDate: "2026-04-03T00:00:00.000Z" };
    expect(getCustomFieldDisplayValue(value as never, prefs)).toMatch(
      /^0?3\D+0?4\D+2026$/
    );
  });

  it("falls back to PPP when no prefs are supplied", () => {
    const value = { raw: "2026-04-03", valueDate: "2026-04-03T00:00:00.000Z" };
    expect(getCustomFieldDisplayValue(value as never)).toBe("April 3rd, 2026");
  });
});

/**
 * Regression guard for the view-only blindness bug.
 *
 * The asset-overview loader only fetches the org's active custom-field
 * DEFINITIONS for users who can update the asset (a perf optimization). The
 * page then built its entire custom-fields list from that array, so BASE and
 * SELF_SERVICE users — who hold `asset: [read]` and never `asset: update` —
 * saw an empty definitions array and therefore NO custom fields at all, even
 * on assets where values were set.
 *
 * The stored values already carry their own definition, so the list must be
 * seeded from the values and only TOPPED UP with editable definitions.
 */
describe("buildAssetOverviewCustomFields", () => {
  const def = (id: string, name: string) => ({
    id,
    name,
    type: "TEXT" as const,
    options: [],
    helpText: null,
    required: false,
  });

  const storedValue = (id: string, name: string, raw: string) => ({
    value: { raw },
    customField: def(id, name),
  });

  it("shows fields that have values when there are no editable definitions", () => {
    // why: this is exactly the BASE / SELF_SERVICE payload — the loader sends
    // `allCustomFieldDefs: []` because they cannot update the asset.
    const result = buildAssetOverviewCustomFields({
      storedValues: [storedValue("cf1", "Serial number", "ABC-123")],
      editableDefinitions: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0].def.name).toBe("Serial number");
    expect(result[0].storedValue?.value).toEqual({ raw: "ABC-123" });
    // Visible, but not editable — they hold `asset: [read]`, not `update`.
    expect(result[0].isEditable).toBe(false);
  });

  it("adds definitions with no stored value so editors get 'Not set' rows", () => {
    const result = buildAssetOverviewCustomFields({
      storedValues: [storedValue("cf1", "Serial number", "ABC-123")],
      editableDefinitions: [
        def("cf1", "Serial number"),
        def("cf2", "Warranty"),
      ],
    });

    expect(result.map((r) => r.def.name)).toEqual([
      "Serial number",
      "Warranty",
    ]);
    expect(result[1].storedValue).toBeNull();
  });

  it("does not duplicate a field present in both sources", () => {
    const result = buildAssetOverviewCustomFields({
      storedValues: [storedValue("cf1", "Serial number", "ABC-123")],
      editableDefinitions: [def("cf1", "Serial number")],
    });

    expect(result).toHaveLength(1);
    expect(result[0].storedValue).not.toBeNull();
  });

  it("keeps a stored value whose definition is missing from the editable set", () => {
    // why: an uncategorized asset only gets UNCATEGORIZED definitions back, so
    // a value left behind by a category-scoped field would otherwise vanish —
    // for admins and owners too.
    const result = buildAssetOverviewCustomFields({
      storedValues: [storedValue("cf-orphan", "Lens mount", "EF")],
      editableDefinitions: [def("cf2", "Warranty")],
    });

    expect(result.map((r) => r.def.name)).toEqual(["Lens mount", "Warranty"]);
    expect(result[0].storedValue).not.toBeNull();
    // The route's action refuses writes for out-of-scope definitions, so the
    // row must render read-only rather than dead-end on a 400.
    expect(result[0].isEditable).toBe(false);
    expect(result[1].isEditable).toBe(true);
  });

  it("ignores stored rows with an empty value", () => {
    const result = buildAssetOverviewCustomFields({
      storedValues: [{ value: null, customField: def("cf1", "Serial number") }],
      editableDefinitions: [],
    });

    expect(result).toEqual([]);
  });

  it("sorts alphabetically without mutating the caller's arrays", () => {
    const editableDefinitions = [def("cf-z", "Zoom"), def("cf-a", "Aperture")];

    const result = buildAssetOverviewCustomFields({
      storedValues: [],
      editableDefinitions,
    });

    expect(result.map((r) => r.def.name)).toEqual(["Aperture", "Zoom"]);
    // The loader payload must stay untouched — `.sort()` in place would
    // reorder data React may re-render from.
    expect(editableDefinitions.map((d) => d.name)).toEqual([
      "Zoom",
      "Aperture",
    ]);
  });
});
