/**
 * Tests for the `Reserved` cell display rule.
 *
 * The case that matters is the busy workspace: many upcoming bookings whose SUM
 * dwarfs the pool while no single booking exceeds it. That is normal, healthy
 * data, and an earlier version of this cell flagged it as a shortage.
 *
 * @see {@link file://./reserved-display.ts}
 */

import { describe, expect, it } from "vitest";
import { resolveReservedDisplay } from "./reserved-display";
import type { ReservedDisplayInput } from "./reserved-display";

/** A quantity pool with nothing claimed. Override only what a case is about. */
function pool(
  overrides: Partial<ReservedDisplayInput> = {}
): ReservedDisplayInput {
  return {
    reserved: 0,
    quantity: 10,
    stockStatus: "ENOUGH",
    largestUpcomingBooking: 0,
    inCustody: 0,
    inKits: 0,
    checkedOut: 0,
    unitOfMeasure: "pcs",
    ...overrides,
  };
}

describe("resolveReservedDisplay", () => {
  it("does not flag a busy asset whose bookings never overlap", () => {
    // why: THE regression. Fifty bookings of one unit each against a pool of
    // ten sums to fifty, but peak demand is one. Comparing the sum to the pool
    // painted "40 short" on a healthy row. The verdict is what decides.
    const result = resolveReservedDisplay(
      pool({ reserved: 50, largestUpcomingBooking: 1, stockStatus: "ENOUGH" })
    );

    expect(result.isOversold).toBe(false);
    expect(result.text).toBe("50 pcs");
    expect(result.title).toBeNull();
  });

  it("flags the asset when one single booking exceeds the pool", () => {
    const result = resolveReservedDisplay(
      pool({ reserved: 12, largestUpcomingBooking: 12, stockStatus: "SHORT" })
    );

    expect(result.isOversold).toBe(true);
    expect(result.text).toBe("12 pcs · 2 short");
    expect(result.title).toContain("short by 2");
  });

  it("reports the shortfall, never a 'X of Y' ratio", () => {
    // why: "12 of 10" invites a part-of-whole reading, which is meaningless
    // once the first number exceeds the second. The gap is also the only
    // number anybody can act on.
    const result = resolveReservedDisplay(
      pool({ reserved: 12, largestUpcomingBooking: 12, stockStatus: "SHORT" })
    );

    expect(result.text).not.toContain("of 10");
  });

  it("keeps the sum visible alongside the per-booking shortfall", () => {
    // why: with many bookings the two numbers are different things. The cell
    // shows the sum; the shortfall comes from the largest single booking. The
    // accessible description has to hold both so they cannot be conflated.
    const result = resolveReservedDisplay(
      pool({
        reserved: 40,
        quantity: 10,
        largestUpcomingBooking: 12,
        stockStatus: "SHORT",
      })
    );

    expect(result.text).toBe("40 pcs · 2 short");
    expect(result.title).toContain("40 promised across all upcoming bookings");
  });

  it("does not blame Reserved when the shortfall comes from custody", () => {
    // why: custody + kits can push a pool over on their own. The verdict is
    // SHORT and rightly so, but this column is not the culprit and must not
    // claim to be.
    const result = resolveReservedDisplay(
      pool({
        reserved: 0,
        quantity: 10,
        inCustody: 11,
        largestUpcomingBooking: 0,
        stockStatus: "SHORT",
      })
    );

    expect(result.isOversold).toBe(false);
    expect(result.text).toBe("0 pcs");
  });

  it("counts custody and kits toward the shortfall it reports", () => {
    // why: the figure quoted must be the one `classifyStockStatus` used, or the
    // cell and the pill's own tooltip would state different numbers for the
    // same row. 4 custody + 2 kits + 6 largest booking = 12 against 10 owned.
    const result = resolveReservedDisplay(
      pool({
        reserved: 6,
        quantity: 10,
        inCustody: 4,
        inKits: 2,
        largestUpcomingBooking: 6,
        stockStatus: "SHORT",
      })
    );

    expect(result.text).toBe("6 pcs · 2 short");
  });

  it("renders a bare count for an individually-tracked asset", () => {
    // why: no pool, no unit of measure, and it can never oversell — a booked
    // camera simply reads 1.
    const result = resolveReservedDisplay(
      pool({
        reserved: 1,
        quantity: null,
        stockStatus: null,
        unitOfMeasure: null,
      })
    );

    expect(result.text).toBe("1");
    expect(result.isOversold).toBe(false);
  });

  it("omits the unit when the asset has no unit of measure", () => {
    const result = resolveReservedDisplay(
      pool({ reserved: 3, unitOfMeasure: null })
    );

    expect(result.text).toBe("3");
  });
});
