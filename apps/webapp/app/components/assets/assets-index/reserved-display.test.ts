/**
 * Tests for the `Reserved` cell display rule.
 *
 * The cases that matter are the healthy busy rows: many upcoming bookings whose
 * SUM dwarfs the pool while they never overlap, and a pool that is out today
 * and booked again after it returns. Both are normal data, and earlier versions
 * of this cell flagged both as shortages.
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
    peakBooked: 0,
    inCustody: 0,
    inKits: 0,
    unitOfMeasure: "pcs",
    ...overrides,
  };
}

describe("resolveReservedDisplay", () => {
  it("does not flag a busy asset whose bookings never overlap", () => {
    const result = resolveReservedDisplay(
      pool({ reserved: 50, peakBooked: 1, stockStatus: "ENOUGH" })
    );
    expect(result.isOversold).toBe(false);
    expect(result.text).toBe("50 pcs");
    expect(result.title).toBeNull();
  });

  it("does not flag a pool that is out today and booked again after it returns", () => {
    // 8 out this week, 5 reserved next month: the peak is 8, not 13.
    const result = resolveReservedDisplay(
      pool({ reserved: 5, peakBooked: 8, stockStatus: "ENOUGH" })
    );
    expect(result.isOversold).toBe(false);
    expect(result.text).toBe("5 pcs");
  });

  it("flags the asset when one single booking exceeds the pool", () => {
    const result = resolveReservedDisplay(
      pool({ reserved: 12, peakBooked: 12, stockStatus: "SHORT" })
    );
    expect(result.isOversold).toBe(true);
    expect(result.text).toBe("12 pcs · 2 short");
    expect(result.title).toContain("short by 2");
  });

  it("flags two overlapping bookings that only exceed the pool together", () => {
    const result = resolveReservedDisplay(
      pool({ reserved: 12, peakBooked: 12, stockStatus: "SHORT" })
    );
    expect(result.text).toBe("12 pcs · 2 short");
    expect(result.title).toContain("need 12 pcs at once");
  });

  it("reports the shortfall, never a 'X of Y' ratio", () => {
    const result = resolveReservedDisplay(
      pool({ reserved: 12, peakBooked: 12, stockStatus: "SHORT" })
    );
    expect(result.text).not.toContain("of 10");
  });

  it("keeps the sum visible alongside the shortfall at the peak", () => {
    const result = resolveReservedDisplay(
      pool({ reserved: 40, quantity: 10, peakBooked: 12, stockStatus: "SHORT" })
    );
    expect(result.text).toBe("40 pcs · 2 short");
    expect(result.title).toContain("40 promised across all upcoming bookings");
  });

  it("does not blame Reserved when the shortfall comes from custody", () => {
    const result = resolveReservedDisplay(
      pool({
        reserved: 0,
        quantity: 10,
        inCustody: 11,
        peakBooked: 0,
        stockStatus: "SHORT",
      })
    );
    expect(result.isOversold).toBe(false);
    expect(result.text).toBe("0 pcs");
  });

  it("counts custody and kits toward the shortfall it reports, and names them", () => {
    const result = resolveReservedDisplay(
      pool({
        reserved: 6,
        quantity: 10,
        inCustody: 4,
        inKits: 2,
        peakBooked: 6,
        stockStatus: "SHORT",
      })
    );
    expect(result.text).toBe("6 pcs · 2 short");
    expect(result.title).toContain("plus 4 in custody and 2 in kits");
  });

  it("renders a bare count for an individually-tracked asset", () => {
    const result = resolveReservedDisplay(
      pool({
        reserved: 3,
        quantity: null,
        stockStatus: null,
        unitOfMeasure: null,
      })
    );
    expect(result.text).toBe("3");
    expect(result.isOversold).toBe(false);
  });

  it("omits the unit when the asset has no unit of measure", () => {
    const result = resolveReservedDisplay(
      pool({ reserved: 3, unitOfMeasure: null })
    );
    expect(result.text).toBe("3");
  });
});
