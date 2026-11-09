/**
 * Tests for the audit unit-count helpers shared by the scan drawer, the
 * overview and the receipt.
 *
 * @see {@link file://./quantity.ts}
 */
import { describe, expect, it } from "vitest";
import type { AuditUnitGroup } from "./quantity";
import {
  describeAuditUnits,
  expectedQuantityFor,
  auditRowHeading,
  auditUnitScope,
  scopedExpectedUnits,
  totalAuditUnitGroups,
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
      unexpectedRows: 0,
      unexpectedUnits: 0,
      unexpectedUncountedRows: 0,
    });
  });

  it("totals units the audit never expected apart from the comparison", () => {
    expect(
      totalAuditUnits([
        { expected: true, expectedQuantity: 14, foundQuantity: 14 },
        { expected: false, expectedQuantity: 5, foundQuantity: 5 },
      ])
    ).toEqual({
      quantityRows: 1,
      expectedUnits: 14,
      foundUnits: 14,
      uncountedRows: 0,
      unexpectedRows: 1,
      unexpectedUnits: 5,
      unexpectedUncountedRows: 0,
    });
  });

  it("reports an audit whose only pool was not on the list", () => {
    expect(
      totalAuditUnits([
        { expected: false, expectedQuantity: 0, foundQuantity: 5 },
      ])
    ).toMatchObject({ quantityRows: 0, unexpectedRows: 1, unexpectedUnits: 5 });
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
      unexpectedRows: 0,
      unexpectedUnits: 0,
      unexpectedUncountedRows: 0,
    });
  });
});

describe("describeAuditUnits", () => {
  it("words the totals, naming rows not counted", () => {
    expect(
      describeAuditUnits({
        quantityRows: 2,
        expectedUnits: 20,
        foundUnits: 8,
        uncountedRows: 1,
        unexpectedRows: 0,
        unexpectedUnits: 0,
        unexpectedUncountedRows: 0,
      })
    ).toBe(
      "Units counted: 8 of 20 across 2 quantity-tracked assets, 1 not counted."
    );
  });

  it("uses the singular for one asset", () => {
    expect(
      describeAuditUnits({
        quantityRows: 1,
        expectedUnits: 14,
        foundUnits: 8,
        uncountedRows: 0,
        unexpectedRows: 0,
        unexpectedUnits: 0,
        unexpectedUncountedRows: 0,
      })
    ).toBe("Units counted: 8 of 14 across 1 quantity-tracked asset.");
  });

  it("adds units found on assets not on the list", () => {
    expect(
      describeAuditUnits({
        quantityRows: 1,
        expectedUnits: 4,
        foundUnits: 6,
        uncountedRows: 0,
        unexpectedRows: 1,
        unexpectedUnits: 3,
        unexpectedUncountedRows: 0,
      })
    ).toBe(
      "Units counted: 6 of 4 across 1 quantity-tracked asset; 3 more on 1 quantity-tracked asset not on the list."
    );
  });

  it("words an audit whose only counted pool was not on the list", () => {
    expect(
      describeAuditUnits({
        quantityRows: 0,
        expectedUnits: 0,
        foundUnits: 0,
        uncountedRows: 0,
        unexpectedRows: 1,
        unexpectedUnits: 5,
        unexpectedUncountedRows: 0,
      })
    ).toBe("Units counted: 5 on 1 quantity-tracked asset not on the list.");
  });
});

describe("unlisted pools without a count", () => {
  it("counts them as not counted, not as zero units", () => {
    const totals = totalAuditUnits([
      { expected: false, expectedQuantity: 14, foundQuantity: null },
    ]);
    expect(totals).toMatchObject({
      unexpectedRows: 1,
      unexpectedUnits: 0,
      unexpectedUncountedRows: 1,
    });
    expect(describeAuditUnits(totals!)).toBe(
      "Units counted: 0 on 1 quantity-tracked asset not on the list, 1 not counted."
    );
  });
});

describe("auditUnitScope", () => {
  it("reads the locations of a location audit", () => {
    expect(auditUnitScope({ locationIds: ["a", "b"] })).toEqual({
      kind: "locations",
      locationIds: ["a", "b"],
    });
  });

  it("reads the kits of a kit audit", () => {
    expect(auditUnitScope({ kitIds: ["k1"] })).toEqual({
      kind: "kits",
      kitIds: ["k1"],
    });
  });

  it("reads the person of a custody audit", () => {
    expect(auditUnitScope({ custodianUserId: "user-7" })).toEqual({
      kind: "custodian",
      custodianUserId: "user-7",
    });
  });

  it("returns null for an audit that counts whole pools", () => {
    expect(auditUnitScope(null)).toBeNull();
    expect(auditUnitScope({ contextType: "KIT" })).toBeNull();
    expect(auditUnitScope({ locationIds: [] })).toBeNull();
  });
});

describe("scopedExpectedUnits", () => {
  it("expects the units in scope", () => {
    expect(scopedExpectedUnits(4, 14)).toBe(4);
  });

  it("never expects more than the pool", () => {
    expect(scopedExpectedUnits(18, 14)).toBe(14);
  });

  it("expects the whole pool when none are in scope", () => {
    expect(scopedExpectedUnits(0, 14)).toBe(14);
  });
});

describe("auditRowHeading", () => {
  it("prefixes a counted expected row", () => {
    expect(
      auditRowHeading("8 of 14 pcs", { status: "FOUND", foundQuantity: 8 })
    ).toBe("Counted: 8 of 14 pcs • Notes and images");
  });

  it("shows the label alone for an uncounted row", () => {
    expect(
      auditRowHeading("Not counted", { status: "FOUND", foundQuantity: null })
    ).toBe("Not counted • Notes and images");
  });

  it("does not repeat 'counted' on an unexpected row", () => {
    expect(
      auditRowHeading("8 pcs counted", {
        status: "UNEXPECTED",
        foundQuantity: 8,
      })
    ).toBe("8 pcs counted • Notes and images");
  });

  it("has no count for an individual asset", () => {
    expect(
      auditRowHeading(null, { status: "FOUND", foundQuantity: null })
    ).toBe("Notes and images");
  });
});

describe("totalAuditUnitGroups", () => {
  it("gives the same totals as the row-by-row sum", () => {
    const rows = [
      {
        expected: true,
        status: "FOUND",
        expectedQuantity: 14,
        foundQuantity: 8,
      },
      {
        expected: true,
        status: "FOUND",
        expectedQuantity: 10,
        foundQuantity: null,
      },
      {
        expected: true,
        status: "MISSING",
        expectedQuantity: 5,
        foundQuantity: null,
      },
      {
        expected: true,
        status: "PENDING",
        expectedQuantity: 4,
        foundQuantity: null,
      },
      {
        expected: false,
        status: "UNEXPECTED",
        expectedQuantity: 9,
        foundQuantity: 3,
      },
      {
        expected: false,
        status: "UNEXPECTED",
        expectedQuantity: 2,
        foundQuantity: null,
      },
    ];
    const groups = new Map<string, AuditUnitGroup>();
    for (const row of rows) {
      const key = `${row.expected}:${row.status}`;
      const group = groups.get(key) ?? {
        expected: row.expected,
        status: row.status,
        rows: 0,
        countedRows: 0,
        expectedUnits: null,
        foundUnits: null,
      };
      group.rows += 1;
      group.expectedUnits = (group.expectedUnits ?? 0) + row.expectedQuantity;
      if (row.foundQuantity !== null) {
        group.countedRows += 1;
        group.foundUnits = (group.foundUnits ?? 0) + row.foundQuantity;
      }
      groups.set(key, group);
    }

    expect(totalAuditUnitGroups([...groups.values()])).toEqual(
      totalAuditUnits(rows)
    );
  });

  it("returns null when there are no groups", () => {
    expect(totalAuditUnitGroups([])).toBeNull();
  });
});
