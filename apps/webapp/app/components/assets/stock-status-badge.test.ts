/**
 * Tests for the Stock status badge text.
 *
 * @see {@link file://./stock-status-badge.tsx}
 */
import { describe, expect, it } from "vitest";

import {
  stockStatusText,
  type StockStatusBreakdown,
} from "./stock-status-badge";

/** A pool of 10 with nothing claimed. Override only what a case is about. */
function figures(
  overrides: Partial<StockStatusBreakdown> = {}
): StockStatusBreakdown {
  return {
    total: 10,
    available: 10,
    inCustody: 0,
    inKits: 0,
    checkedOut: 0,
    peakBooked: 0,
    minQuantity: null,
    ...overrides,
  };
}

describe("stockStatusText", () => {
  it("says how many units a short pool is short by", () => {
    // 12 booked at the busiest point against 10 owned.
    expect(stockStatusText("SHORT", figures({ peakBooked: 12 }))).toBe(
      "Short by 2"
    );
  });

  it("counts custody and kits into the shortfall", () => {
    expect(
      stockStatusText(
        "SHORT",
        figures({ peakBooked: 4, inCustody: 5, inKits: 3 })
      )
    ).toBe("Short by 2");
  });

  it("says Short alone when there are no figures, as in the column legend", () => {
    expect(stockStatusText("SHORT")).toBe("Short");
  });

  it("uses the plain label for every other verdict", () => {
    expect(stockStatusText("NONE_FREE", figures())).toBe("None free");
    expect(stockStatusText("LOW", figures())).toBe("Running low");
    expect(stockStatusText("ENOUGH", figures())).toBe("Enough");
  });
});
