/**
 * Tests for the audit unit-count helpers shared by the scan drawer, the
 * overview and the receipt.
 *
 * @see {@link file://./quantity.ts}
 */
import { describe, expect, it } from "vitest";
import {
  describeAuditUnits,
  expectedQuantityFor,
  scopedLocationIds,
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

  it("counts a MISSING row as zero found, not as uncounted", () => {
    expect(
      totalAuditUnits([
        {
          expected: true,
          status: "MISSING",
          expectedQuantity: 14,
          foundQuantity: null,
        },
        {
          expected: true,
          status: "FOUND",
          expectedQuantity: 14,
          foundQuantity: 8,
        },
      ])
    ).toEqual({
      quantityRows: 2,
      expectedUnits: 28,
      foundUnits: 8,
      uncountedRows: 0,
    });
  });
});

describe("describeAuditUnits", () => {
  it("words the totals, naming rows not counted yet", () => {
    expect(
      describeAuditUnits({
        quantityRows: 2,
        expectedUnits: 20,
        foundUnits: 8,
        uncountedRows: 1,
      })
    ).toBe(
      "Units counted: 8 of 20 across 2 quantity-tracked assets, 1 not counted yet."
    );
  });

  it("uses the singular for one asset", () => {
    expect(
      describeAuditUnits({
        quantityRows: 1,
        expectedUnits: 14,
        foundUnits: 8,
        uncountedRows: 0,
      })
    ).toBe("Units counted: 8 of 14 across 1 quantity-tracked asset.");
  });
});

describe("scopedLocationIds", () => {
  it("reads the locations of a location audit", () => {
    expect(scopedLocationIds({ locationIds: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("returns null for an audit without locations", () => {
    expect(scopedLocationIds(null)).toBeNull();
    expect(scopedLocationIds({ contextType: "KIT" })).toBeNull();
    expect(scopedLocationIds({ locationIds: [] })).toBeNull();
  });
});
