/**
 * Tests for the audit unit-count helpers shared by the scan drawer, the
 * overview and the receipt.
 *
 * @see {@link file://./quantity.ts}
 */
import { describe, expect, it } from "vitest";
import {
  expectedQuantityFor,
  formatAuditQuantity,
  totalAuditUnits,
} from "./quantity";

describe("expectedQuantityFor", () => {
  it("snapshots the stock of a quantity-tracked asset", () => {
    expect(
      expectedQuantityFor({ type: "QUANTITY_TRACKED", quantity: 14 })
    ).toBe(14);
  });

  it("treats an unset stock on a quantity-tracked asset as zero", () => {
    expect(
      expectedQuantityFor({ type: "QUANTITY_TRACKED", quantity: null })
    ).toBe(0);
  });

  it("gives an individual asset no snapshot", () => {
    expect(expectedQuantityFor({ type: "INDIVIDUAL", quantity: null })).toBe(
      null
    );
  });
});

describe("formatAuditQuantity", () => {
  it("reads found of expected, with the unit", () => {
    expect(
      formatAuditQuantity({ expectedQuantity: 14, foundQuantity: 8 }, "pcs")
    ).toBe("8 of 14 pcs");
  });

  it("says a quantity row is not counted yet", () => {
    expect(
      formatAuditQuantity({ expectedQuantity: 14, foundQuantity: null })
    ).toBe("Not counted (14 expected)");
  });

  it("returns null for an individual row", () => {
    expect(
      formatAuditQuantity({ expectedQuantity: null, foundQuantity: null })
    ).toBeNull();
  });
});

describe("totalAuditUnits", () => {
  it("returns null when the audit holds no quantity rows", () => {
    expect(
      totalAuditUnits([
        { expected: true, expectedQuantity: null, foundQuantity: null },
      ])
    ).toBeNull();
  });

  it("sums expected rows and counts the uncounted ones", () => {
    expect(
      totalAuditUnits([
        { expected: true, expectedQuantity: 14, foundQuantity: 8 },
        { expected: true, expectedQuantity: 6, foundQuantity: null },
        { expected: true, expectedQuantity: null, foundQuantity: null },
      ])
    ).toEqual({
      quantityRows: 2,
      expectedUnits: 20,
      foundUnits: 8,
      uncountedRows: 1,
    });
  });

  it("keeps units the audit never expected out of the comparison", () => {
    expect(
      totalAuditUnits([
        { expected: true, expectedQuantity: 14, foundQuantity: 14 },
        { expected: false, expectedQuantity: 5, foundQuantity: 5 },
      ])
    ).toEqual({
      quantityRows: 2,
      expectedUnits: 14,
      foundUnits: 14,
      uncountedRows: 0,
    });
  });
});
