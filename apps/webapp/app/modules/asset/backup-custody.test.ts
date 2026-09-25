import { describe, expect, it } from "vitest";
import { custodyForRestore } from "./backup-custody";

/** A Custody row as the backup export writes it (nulls become ""). */
const custodyRow = (
  name: string,
  quantity: unknown = 1,
  kitCustodyId = ""
) => ({
  id: `custody-${name}`,
  kitCustodyId,
  quantity,
  custodian: {
    id: `tm-${name}`,
    name,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "",
  },
});

describe("custodyForRestore", () => {
  it("keeps a pool's operator rows with their units and leaves kit rows out", () => {
    expect(
      custodyForRestore({
        type: "QUANTITY_TRACKED",
        custody: [
          custodyRow("Ana", 30),
          custodyRow("Kit Holder", 5, "kc-1"),
          custodyRow("Ben", 20),
        ],
      })
    ).toEqual([
      {
        custodian: {
          key: "id:tm-Ana",
          name: "Ana",
          createdAt: new Date("2026-08-01T10:00:00.000Z"),
          updatedAt: undefined,
        },
        quantity: 30,
      },
      {
        custodian: {
          key: "id:tm-Ben",
          name: "Ben",
          createdAt: new Date("2026-08-01T10:00:00.000Z"),
          updatedAt: undefined,
        },
        quantity: 20,
      },
    ]);
  });

  it("gives an individual asset its first operator custodian, at 1", () => {
    const restored = custodyForRestore({
      type: "INDIVIDUAL",
      custody: [custodyRow("Kit Holder", 1, "kc-1"), custodyRow("Ana", 3)],
    });

    expect(
      restored.map(({ custodian, quantity }) => [custodian.name, quantity])
    ).toEqual([["Ana", 1]]);
  });

  it("reads a single custody object, and a missing type, as an individual asset", () => {
    const restored = custodyForRestore({
      type: undefined,
      custody: custodyRow("Ana"),
    });

    expect(restored.map(({ custodian }) => custodian.name)).toEqual(["Ana"]);
  });

  it("tells custodians apart by their source id, or by name without one", () => {
    const { id: _id, ...withoutId } = custodyRow("Ben").custodian;

    const restored = custodyForRestore({
      type: "QUANTITY_TRACKED",
      custody: [
        custodyRow("Ana"),
        { ...custodyRow("Ben"), custodian: withoutId },
      ],
    });

    expect(restored.map(({ custodian }) => custodian.key)).toEqual([
      "id:tm-Ana",
      "name:Ben",
    ]);
  });

  it("gives a pool row without a whole quantity above zero 1 unit", () => {
    const restored = custodyForRestore({
      type: "QUANTITY_TRACKED",
      custody: [custodyRow("Ana", "7"), custodyRow("Ben", 0)],
    });

    expect(restored.map(({ quantity }) => quantity)).toEqual([1, 1]);
  });

  it("restores nothing from an empty cell or a row without a custodian name", () => {
    expect(
      custodyForRestore({ type: "INDIVIDUAL", custody: undefined })
    ).toEqual([]);
    expect(custodyForRestore({ type: "INDIVIDUAL", custody: [] })).toEqual([]);
    expect(
      custodyForRestore({
        type: "QUANTITY_TRACKED",
        custody: [custodyRow("  "), { quantity: 2, custodian: null }],
      })
    ).toEqual([]);
  });
});
