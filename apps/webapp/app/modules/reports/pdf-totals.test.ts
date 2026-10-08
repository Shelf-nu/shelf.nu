/**
 * Unit tests for the PDF total-value helpers.
 *
 * The PDF export is handed to third parties (insurers, finance), so its
 * totals must match the on-screen KPIs' quantity-aware arithmetic exactly.
 *
 * @see {@link file://./pdf-totals.ts}
 */
import { describe, expect, it } from "vitest";

import { sumQuantityAwareValue } from "./pdf-totals";

describe("sumQuantityAwareValue", () => {
  it("multiplies per-unit valuation by the row's quantity", () => {
    expect(
      sumQuantityAwareValue([
        { valuation: 100, quantity: 5 },
        { valuation: 7, quantity: null },
      ])
    ).toBe(507);
  });

  it("treats null valuation as zero and null quantity as one", () => {
    expect(
      sumQuantityAwareValue([
        { valuation: null, quantity: 10 },
        { valuation: 3, quantity: null },
      ])
    ).toBe(3);
  });

  it("returns zero for an empty set", () => {
    expect(sumQuantityAwareValue([])).toBe(0);
  });
});
