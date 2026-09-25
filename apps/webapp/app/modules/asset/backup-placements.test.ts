import { describe, expect, it } from "vitest";
import { ShelfError } from "~/utils/error";
import {
  parseBackupPlacements,
  placementsForRestore,
  readLegacyBackupLocation,
  serializeBackupPlacements,
} from "./backup-placements";

/** An `assetLocations` row as `fetchAssetsForExport` loads it. */
const row = (
  locationName: string,
  quantity: number,
  assetKitId: string | null = null
) => ({
  id: `al-${locationName}`,
  assetId: "asset-1",
  locationId: `loc-${locationName}`,
  organizationId: "org-1",
  quantity,
  assetKitId,
  location: { id: `loc-${locationName}`, name: locationName },
});

describe("serializeBackupPlacements", () => {
  it("writes each placement of a pool by location name, with its quantity", () => {
    expect(
      serializeBackupPlacements(
        [row("Simulation Suite A", 99), row("Simulation Suite B", 44)],
        "QUANTITY_TRACKED"
      )
    ).toEqual([
      { location: "Simulation Suite A", quantity: 99 },
      { location: "Simulation Suite B", quantity: 44 },
    ]);
  });

  it("leaves a pool's kit slices out, which are a separate axis", () => {
    expect(
      serializeBackupPlacements(
        [row("Warehouse", 5), row("Van 2", 3, "asset-kit-1")],
        "QUANTITY_TRACKED"
      )
    ).toEqual([{ location: "Warehouse", quantity: 5 }]);
  });

  it("writes an individual asset's single placement as one entry of 1", () => {
    expect(serializeBackupPlacements([row("Studio", 1)], "INDIVIDUAL")).toEqual(
      [{ location: "Studio", quantity: 1 }]
    );
  });

  it("writes an individual asset's kit-driven placement when it has no other", () => {
    expect(
      serializeBackupPlacements([row("Van 2", 1, "asset-kit-1")], "INDIVIDUAL")
    ).toEqual([{ location: "Van 2", quantity: 1 }]);
  });

  it("writes no ids, only names and quantities", () => {
    const [placement] = serializeBackupPlacements(
      [row("Studio", 1)],
      "INDIVIDUAL"
    );
    expect(Object.keys(placement).sort()).toEqual(["location", "quantity"]);
  });

  it("writes nothing for an unplaced asset", () => {
    expect(serializeBackupPlacements([], "QUANTITY_TRACKED")).toEqual([]);
    expect(serializeBackupPlacements(null, "INDIVIDUAL")).toEqual([]);
  });
});

describe("parseBackupPlacements", () => {
  it("reads back what the export writes", () => {
    const placements = [
      { location: "Simulation Suite A", quantity: 99 },
      { location: "Simulation Suite B", quantity: 44 },
    ];
    expect(parseBackupPlacements(JSON.stringify(placements), 2)).toEqual(
      placements
    );
  });

  it.each([
    ["an entry without a location name", '[{"location":" ","quantity":1}]'],
    ["a quantity of zero", '[{"location":"Studio","quantity":0}]'],
    ["a fractional quantity", '[{"location":"Studio","quantity":1.5}]'],
    ["a quantity written as text", '[{"location":"Studio","quantity":"1"}]'],
    ["text that is not JSON", "Studio"],
  ])("rejects %s, naming the row", (_label, cell) => {
    let thrown: unknown;
    try {
      parseBackupPlacements(cell, 7);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ShelfError);
    expect((thrown as ShelfError).status).toBe(400);
    expect((thrown as ShelfError).message).toContain("Row 7");
  });

  it("reads a cell exported before placements were written as none", () => {
    expect(parseBackupPlacements("[object Object]", 3)).toEqual([]);
    expect(parseBackupPlacements("[object Object],[object Object]", 3)).toEqual(
      []
    );
  });
});

describe("readLegacyBackupLocation", () => {
  it("reads the name and the details a restore creates the location with", () => {
    expect(
      readLegacyBackupLocation({
        id: "old-loc",
        name: "Warehouse",
        description: "Back room",
        address: "1 Dock Road",
        createdAt: "2026-01-02T03:04:05.000Z",
        updatedAt: "not a date",
      })
    ).toEqual({
      name: "Warehouse",
      details: {
        description: "Back room",
        address: "1 Dock Road",
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        updatedAt: undefined,
      },
    });
  });

  it("returns nothing for a row without a location", () => {
    expect(readLegacyBackupLocation(undefined)).toBeNull();
    expect(readLegacyBackupLocation({})).toBeNull();
  });
});

describe("placementsForRestore", () => {
  const pool = [
    { location: "Simulation Suite A", quantity: 99 },
    { location: "Simulation Suite B", quantity: 44 },
  ];

  it("keeps every placement of a pool", () => {
    expect(
      placementsForRestore({
        type: "QUANTITY_TRACKED",
        quantity: "143",
        assetLocations: pool,
      })
    ).toEqual(pool);
  });

  it("places an individual asset once, with one unit", () => {
    expect(
      placementsForRestore({
        type: "INDIVIDUAL",
        quantity: "",
        assetLocations: [{ location: "Studio", quantity: 3 }, pool[0]],
      })
    ).toEqual([{ location: "Studio", quantity: 1 }]);
  });

  it("treats a row without a type as individual", () => {
    expect(
      placementsForRestore({
        type: undefined,
        quantity: undefined,
        assetLocations: [{ location: "Studio", quantity: 1 }],
      })
    ).toEqual([{ location: "Studio", quantity: 1 }]);
  });

  describe("a backup written before placements existed", () => {
    const location = { id: "old-loc", name: "Warehouse" };

    it("puts a pool's whole quantity at its one location", () => {
      expect(
        placementsForRestore({
          type: "QUANTITY_TRACKED",
          quantity: "40",
          location,
        })
      ).toEqual([{ location: "Warehouse", quantity: 40 }]);
    });

    it("puts an individual asset there with one unit", () => {
      expect(
        placementsForRestore({ type: "INDIVIDUAL", quantity: "", location })
      ).toEqual([{ location: "Warehouse", quantity: 1 }]);
    });
  });

  it("gives an unplaced asset no placements", () => {
    expect(
      placementsForRestore({ type: "QUANTITY_TRACKED", quantity: "5" })
    ).toEqual([]);
    expect(
      placementsForRestore({
        type: "INDIVIDUAL",
        quantity: "",
        location: {},
      })
    ).toEqual([]);
  });
});
