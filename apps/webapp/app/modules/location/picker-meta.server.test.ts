/**
 * Location Picker Meta — Unit Tests
 *
 * Behaviour tests for `getLocationPickerMeta`. The MAX formula is the
 * **orthogonal placement model** (intentional deviation from
 * `getKitPickerMeta`):
 *
 *     spaceWithoutMe = Asset.quantity − sum(other locations' AssetLocation.quantity)
 *     max            = max(currentAtThisLocation, spaceWithoutMe)
 *
 * Each test pins one branch of that formula so a future tweak surfaces
 * here instead of in production.
 *
 * @see {@link file://./picker-meta.server.ts}
 */
import { AssetType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { getLocationPickerMeta } from "./picker-meta.server";

// why: getLocationPickerMeta hits db.asset.findMany; mock the singleton
// so tests can pin the fetched shape without spinning up Postgres.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
    },
  },
}));

const findManyMock = vi.mocked(db.asset.findMany);

/** Shape of a single qty-tracked row as `getLocationPickerMeta` fetches it. */
type FetchedRow = {
  id: string;
  quantity: number | null;
  unitOfMeasure: string | null;
  assetLocations: Array<{
    locationId: string;
    quantity: number;
    location: { id: string; name: string };
  }>;
};

/**
 * Reduce boilerplate at call sites. The cast to `never` widens the
 * narrow `FetchedRow` shape to whatever Prisma's typed `findMany`
 * return wants — the runtime only reads the fields we set here, so
 * the wider shape is irrelevant for the test.
 */
function row(overrides: Partial<FetchedRow> & { id: string }): never {
  return {
    quantity: 100,
    unitOfMeasure: null,
    assetLocations: [],
    ...overrides,
  } as never;
}

describe("getLocationPickerMeta", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("returns an empty map when assetIds is empty (no DB call)", async () => {
    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: [],
    });

    expect(result.size).toBe(0);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("scopes the fetch to QUANTITY_TRACKED only", async () => {
    findManyMock.mockResolvedValue([]);

    await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["a1", "a2"],
    });

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const args = findManyMock.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({
      id: { in: ["a1", "a2"] },
      organizationId: "org-1",
      type: AssetType.QUANTITY_TRACKED,
    });
  });

  it("returns an empty map when no qty-tracked rows match (INDIVIDUAL-only input)", async () => {
    findManyMock.mockResolvedValue([]);

    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["i1", "i2"],
    });

    expect(result.size).toBe(0);
  });

  it("max = Asset.quantity when asset is not placed anywhere", async () => {
    findManyMock.mockResolvedValue([
      row({ id: "a1", quantity: 80, assetLocations: [] }),
    ]);

    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["a1"],
    });

    expect(result.get("a1")).toMatchObject({
      assetQuantity: 80,
      currentAtThisLocation: 0,
      inOtherLocations: [],
      maxAllowedForThisLocation: 80,
    });
  });

  it("currentAtThisLocation is read from the row matching locationId", async () => {
    findManyMock.mockResolvedValue([
      row({
        id: "a1",
        quantity: 80,
        assetLocations: [
          {
            locationId: "loc-1",
            quantity: 30,
            location: { id: "loc-1", name: "Office" },
          },
        ],
      }),
    ]);

    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["a1"],
    });

    expect(result.get("a1")).toMatchObject({
      currentAtThisLocation: 30,
      // No other locations → spaceWithoutMe = 80 − 0 = 80; max = max(30, 80) = 80.
      maxAllowedForThisLocation: 80,
    });
  });

  it("max = Asset.quantity − sum(other locations) + currentAtThisLocation (orthogonal MAX)", async () => {
    // Pens (80 total): 30 at Office (this location), 25 at Warehouse, 10 at Field.
    // spaceWithoutMe = 80 − 25 − 10 = 45.
    // max = max(30, 45) = 45.
    findManyMock.mockResolvedValue([
      row({
        id: "pens",
        quantity: 80,
        assetLocations: [
          {
            locationId: "loc-1",
            quantity: 30,
            location: { id: "loc-1", name: "Office" },
          },
          {
            locationId: "loc-2",
            quantity: 25,
            location: { id: "loc-2", name: "Warehouse" },
          },
          {
            locationId: "loc-3",
            quantity: 10,
            location: { id: "loc-3", name: "Field" },
          },
        ],
      }),
    ]);

    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["pens"],
    });

    expect(result.get("pens")).toMatchObject({
      assetQuantity: 80,
      currentAtThisLocation: 30,
      maxAllowedForThisLocation: 45,
    });
    expect(result.get("pens")?.inOtherLocations).toEqual([
      { locationId: "loc-2", locationName: "Warehouse", quantity: 25 },
      { locationId: "loc-3", locationName: "Field", quantity: 10 },
    ]);
  });

  it("max holds the current slice when over-committed (max(current, spaceWithoutMe))", async () => {
    // Pathological state: 60 at this location + 50 elsewhere = 110, but
    // Asset.quantity is only 80. The DEFERRED constraint trigger should
    // have prevented this, but defensively the picker keeps the user's
    // current slice editable.
    // spaceWithoutMe = 80 − 50 = 30; max = max(60, 30) = 60.
    findManyMock.mockResolvedValue([
      row({
        id: "pens",
        quantity: 80,
        assetLocations: [
          {
            locationId: "loc-1",
            quantity: 60,
            location: { id: "loc-1", name: "Office" },
          },
          {
            locationId: "loc-2",
            quantity: 50,
            location: { id: "loc-2", name: "Warehouse" },
          },
        ],
      }),
    ]);

    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["pens"],
    });

    expect(result.get("pens")?.maxAllowedForThisLocation).toBe(60);
  });

  it("spaceWithoutMe floors at 0 when other locations alone exceed Asset.quantity", async () => {
    // Asset.quantity = 50, but other locations hold 60. spaceWithoutMe
    // would be negative; the helper floors it at 0. max stays at
    // currentAtThisLocation (5).
    findManyMock.mockResolvedValue([
      row({
        id: "pens",
        quantity: 50,
        assetLocations: [
          {
            locationId: "loc-1",
            quantity: 5,
            location: { id: "loc-1", name: "Office" },
          },
          {
            locationId: "loc-2",
            quantity: 60,
            location: { id: "loc-2", name: "Warehouse" },
          },
        ],
      }),
    ]);

    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["pens"],
    });

    expect(result.get("pens")?.maxAllowedForThisLocation).toBe(5);
  });

  it("passes unitOfMeasure through to the meta", async () => {
    findManyMock.mockResolvedValue([
      row({ id: "a1", quantity: 80, unitOfMeasure: "pcs" }),
    ]);

    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["a1"],
    });

    expect(result.get("a1")?.unitOfMeasure).toBe("pcs");
  });

  it("treats null Asset.quantity as 0 (defensive)", async () => {
    findManyMock.mockResolvedValue([
      row({ id: "a1", quantity: null, assetLocations: [] }),
    ]);

    const result = await getLocationPickerMeta({
      locationId: "loc-1",
      organizationId: "org-1",
      assetIds: ["a1"],
    });

    expect(result.get("a1")).toMatchObject({
      assetQuantity: 0,
      maxAllowedForThisLocation: 0,
    });
  });
});
