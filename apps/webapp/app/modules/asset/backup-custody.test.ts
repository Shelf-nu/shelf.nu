/**
 * @file Tests which custody a restored asset gets from its backup row.
 *
 * @see {@link file://./backup-custody.ts}
 */
import { describe, expect, it } from "vitest";
import { custodiesForRestore } from "./backup-custody";

/** A custody row as the backup export writes it, ids included. */
function custodyRow(name: string, quantity = 1, kitCustodyId = "") {
  return {
    id: `custody-${name}`,
    teamMemberId: `source-${name}`,
    kitCustodyId,
    quantity,
    custodian: {
      id: `source-${name}`,
      name,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-01-02T03:04:05.000Z",
    },
  };
}

describe("custodiesForRestore", () => {
  it("keeps every custodian of a pool with the units each holds", () => {
    expect(
      custodiesForRestore({
        type: "QUANTITY_TRACKED",
        custody: [custodyRow("Ada", 5), custodyRow("Grace", 3)],
      })
    ).toEqual([
      {
        custodianName: "Ada",
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        updatedAt: new Date("2026-01-02T03:04:05.000Z"),
        quantity: 5,
      },
      {
        custodianName: "Grace",
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        updatedAt: new Date("2026-01-02T03:04:05.000Z"),
        quantity: 3,
      },
    ]);
  });

  it("adds up a pool's rows that name the same custodian, kit-driven included", () => {
    const [ada] = custodiesForRestore({
      type: "QUANTITY_TRACKED",
      custody: [custodyRow("Ada", 5), custodyRow("Ada", 2, "kit-custody-1")],
    });
    expect(ada.quantity).toBe(7);
  });

  it("gives an individual asset its first custodian, with one unit", () => {
    expect(
      custodiesForRestore({
        type: "INDIVIDUAL",
        custody: [custodyRow("Ada"), custodyRow("Grace")],
      }).map(({ custodianName, quantity }) => ({ custodianName, quantity }))
    ).toEqual([{ custodianName: "Ada", quantity: 1 }]);
  });

  it("treats a row without a type as individual", () => {
    expect(
      custodiesForRestore({ type: undefined, custody: [custodyRow("Ada", 4)] })
    ).toMatchObject([{ custodianName: "Ada", quantity: 1 }]);
  });

  it("reads a single custody object, as an older backup writes it", () => {
    expect(
      custodiesForRestore({ type: "INDIVIDUAL", custody: custodyRow("Ada") })
    ).toMatchObject([{ custodianName: "Ada", quantity: 1 }]);
  });

  it("gives an asset without custody none", () => {
    expect(
      custodiesForRestore({ type: "INDIVIDUAL", custody: undefined })
    ).toEqual([]);
    expect(custodiesForRestore({ type: "INDIVIDUAL", custody: [] })).toEqual(
      []
    );
  });

  it("skips rows without a custodian name and leaves bad dates unset", () => {
    expect(
      custodiesForRestore({
        type: "QUANTITY_TRACKED",
        custody: [
          { quantity: 2, custodian: { name: "" } },
          { quantity: 2 },
          { quantity: 0, custodian: { name: "Ada", createdAt: "not a date" } },
        ],
      })
    ).toEqual([
      {
        custodianName: "Ada",
        createdAt: undefined,
        updatedAt: undefined,
        quantity: 1,
      },
    ]);
  });
});
