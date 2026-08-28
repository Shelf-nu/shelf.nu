/**
 * Advanced filters whose VALUE contains a colon.
 *
 * The parameter grammar is `operator:value`, and the value is user data. Colons
 * are legal in Code128, DataMatrix and ExternalQR codes, and a URL custom field
 * is mostly colon — so a value carrying one is ordinary input, not a malformed
 * parameter.
 *
 * Three layers read that grammar and each one is pinned here, because a colon
 * fails differently at each: validation removes the parameter outright, the
 * server parser truncates the value, and the browser rebuilds the filter row
 * showing the truncation back to the user.
 *
 * @see {@link file://./filter-param.ts} the shared split
 */
import { describe, expect, it } from "vitest";

import { parseFilters } from "./filter-parsing";
import type { Column } from "../asset-index-settings/helpers";

// @vitest-environment node

// why: prevent DB connections — `utils.server` transitively reaches the
// location descendants helper at import time.
vitest.mock("~/modules/location/descendants.server", () => ({
  getLocationDescendantIds: vitest.fn().mockResolvedValue([]),
}));

const { validateAdvancedFilterParams } = await import("./utils.server");

/** A barcode column, the case where colons arrive most often. */
const COLUMNS: Column[] = [
  { name: "barcode_Code128" as Column["name"], visible: true, position: 0 },
  { name: "status" as Column["name"], visible: true, position: 1 },
];

/** A Code128 payload with an embedded colon — legal, and not unusual. */
const CODE_WITH_COLON = "ABC:123";

describe("advanced filters with a colon in the value", () => {
  describe("validateAdvancedFilterParams", () => {
    it("keeps a filter whose value contains a colon", () => {
      // Counting colon-separated fields rejects this, and anything rejected is
      // stripped from the URL — so the filter does not merely mismatch, it
      // disappears and the user is shown unfiltered results.
      const params = new URLSearchParams({
        barcode_Code128: `is:${CODE_WITH_COLON}`,
      });

      const result = validateAdvancedFilterParams(params, COLUMNS);

      expect(result.get("barcode_Code128")).toBe(`is:${CODE_WITH_COLON}`);
    });

    it("still keeps an ordinary single-colon filter", () => {
      const params = new URLSearchParams({ status: "is:AVAILABLE" });

      expect(validateAdvancedFilterParams(params, COLUMNS).get("status")).toBe(
        "is:AVAILABLE"
      );
    });

    it("still drops a parameter with no operator separator at all", () => {
      // The relaxation is about colons INSIDE the value; a parameter carrying
      // no separator has no value and is still malformed.
      const params = new URLSearchParams({ status: "AVAILABLE" });

      expect(validateAdvancedFilterParams(params, COLUMNS).has("status")).toBe(
        false
      );
    });

    it("still drops a parameter whose operator is not a real one", () => {
      const params = new URLSearchParams({ status: "notAnOperator:AVAILABLE" });

      expect(validateAdvancedFilterParams(params, COLUMNS).has("status")).toBe(
        false
      );
    });
  });

  describe("parseFilters", () => {
    it("carries the whole value through, colons included", () => {
      const [filter] = parseFilters(
        `barcode_Code128=is:${CODE_WITH_COLON}`,
        COLUMNS
      );

      expect(filter.operator).toBe("is");
      expect(filter.value).toBe(CODE_WITH_COLON);
    });

    it("keeps a URL value intact", () => {
      const url = "https://example.com/a:b";
      const [filter] = parseFilters(`barcode_Code128=is:${url}`, COLUMNS);

      expect(filter.value).toBe(url);
    });

    it("skips a parameter carrying no value at all", () => {
      // `splitFilterParam` reports the missing value rather than inventing an
      // empty one, so this never reaches `parseFilterValue` — which takes a
      // string and would read straight off `undefined`.
      expect(parseFilters("status=AVAILABLE", COLUMNS)).toEqual([]);
    });

    it("keeps a parameter whose value is deliberately empty", () => {
      // A trailing colon IS a value: the empty string. It is a different thing
      // from no separator, and only one of the two is malformed.
      const [filter] = parseFilters("status=is:", COLUMNS);

      expect(filter?.value).toBe("");
    });

    it("still splits an ordinary value on its single colon", () => {
      const [filter] = parseFilters("status=is:AVAILABLE", COLUMNS);

      expect(filter.operator).toBe("is");
      expect(filter.value).toBe("AVAILABLE");
    });
  });
});
