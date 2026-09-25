/**
 * @file Tests how `createAssetsFromBackupImport` restores placements.
 *
 * The restore creates its assets in parallel. Locations are therefore resolved
 * by name once, before the assets: resolving per asset would let two assets
 * that share a new location each try to create it. These tests pin that, and
 * the placements each asset is created with.
 *
 * @see {@link file://./service.server.ts} `createAssetsFromBackupImport`
 */
import { beforeEach, describe, expect, it, vitest } from "vitest";

const locationFindMany = vitest.fn();
const locationCreate = vitest.fn();
const assetCreate = vitest.fn();

// why: the restore's only reads and writes that matter here. The rest of
// `db` is left out: a call to it would throw and fail the test loudly.
vitest.mock("~/database/db.server", () => ({
  db: {
    location: { findMany: locationFindMany, create: locationCreate },
    asset: { create: assetCreate },
  },
}));

// why: the restore records an ASSET_CREATED event per asset; the event
// store is not what these tests are about.
vitest.mock("../activity-event/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "../activity-event/service.server"
  )),
  recordEvent: vitest.fn().mockResolvedValue(undefined),
}));

const { createAssetsFromBackupImport } = await import("./service.server");

/** A backup row as `extractCSVDataFromBackupImport` returns it. */
function row(overrides: Record<string, unknown>) {
  return {
    id: "source-id",
    title: "Asset",
    status: "AVAILABLE",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    tags: [],
    customFields: [],
    ...overrides,
  };
}

function restore(data: Record<string, unknown>[]) {
  return createAssetsFromBackupImport({
    // why: the rows are the parser's output shape, which the payload type
    // only partly describes.
    data: data as never,
    userId: "user-1",
    organizationId: "org-1",
  });
}

/** One placement row as the restore nests it under `db.asset.create`. */
type PlacementCreate = {
  locationId: string;
  organizationId: string;
  quantity: number;
};

/** The `assetLocations.create` each `db.asset.create` call received, by title. */
function placementsByTitle() {
  const calls = assetCreate.mock.calls as [
    { data: { title: string; assetLocations?: { create: PlacementCreate[] } } },
  ][];
  const byTitle: Record<string, PlacementCreate[] | undefined> = {};
  for (const [{ data }] of calls) {
    byTitle[data.title] = data.assetLocations?.create;
  }
  return byTitle;
}

describe("createAssetsFromBackupImport placements", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    locationFindMany.mockResolvedValue([]);
    locationCreate.mockImplementation(({ data }) =>
      Promise.resolve({ id: `new-${data.name}` })
    );
    assetCreate.mockImplementation(({ data }) =>
      Promise.resolve({ id: `asset-${data.title}` })
    );
  });

  it("recreates a pool's placements and an individual asset's placement", async () => {
    await restore([
      row({
        title: "Pens",
        type: "QUANTITY_TRACKED",
        quantity: "143",
        assetLocations: [
          { location: "Suite A", quantity: 99 },
          { location: "Suite B", quantity: 44 },
        ],
      }),
      row({
        title: "Tripod",
        type: "INDIVIDUAL",
        assetLocations: [{ location: "Studio", quantity: 1 }],
      }),
    ]);

    expect(placementsByTitle()).toEqual({
      Pens: [
        { locationId: "new-Suite A", organizationId: "org-1", quantity: 99 },
        { locationId: "new-Suite B", organizationId: "org-1", quantity: 44 },
      ],
      Tripod: [
        { locationId: "new-Studio", organizationId: "org-1", quantity: 1 },
      ],
    });
  });

  it("creates a location shared by several assets once", async () => {
    await restore([
      row({
        title: "Mic 1",
        assetLocations: [{ location: "Studio", quantity: 1 }],
      }),
      row({
        title: "Mic 2",
        assetLocations: [{ location: "Studio", quantity: 1 }],
      }),
      row({
        title: "Mic 3",
        assetLocations: [{ location: "studio", quantity: 1 }],
      }),
    ]);

    expect(locationCreate).toHaveBeenCalledTimes(1);
    expect(locationCreate).toHaveBeenCalledWith({
      data: { name: "Studio", organizationId: "org-1", userId: "user-1" },
      select: { id: true },
    });
    const studio = [
      { locationId: "new-Studio", organizationId: "org-1", quantity: 1 },
    ];
    expect(placementsByTitle()).toEqual({
      "Mic 1": studio,
      "Mic 2": studio,
      "Mic 3": studio,
    });
  });

  it("uses a workspace location whose name matches regardless of case", async () => {
    locationFindMany.mockResolvedValue([
      { id: "loc-existing", name: "STUDIO" },
    ]);

    await restore([
      row({
        title: "Tripod",
        assetLocations: [{ location: "Studio", quantity: 1 }],
      }),
    ]);

    expect(locationFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        name: { in: ["Studio"], mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    expect(locationCreate).not.toHaveBeenCalled();
    expect(placementsByTitle().Tripod).toEqual([
      { locationId: "loc-existing", organizationId: "org-1", quantity: 1 },
    ]);
  });

  it("restores a pre-placements backup's location as one placement", async () => {
    await restore([
      row({
        title: "Cable Ties",
        type: "QUANTITY_TRACKED",
        quantity: "40",
        location: { name: "Warehouse", createdAt: "", updatedAt: "" },
      }),
    ]);

    expect(placementsByTitle()["Cable Ties"]).toEqual([
      { locationId: "new-Warehouse", organizationId: "org-1", quantity: 40 },
    ]);
  });

  it("leaves an unplaced asset without placements and looks nothing up", async () => {
    await restore([row({ title: "Loose" })]);

    expect(locationFindMany).not.toHaveBeenCalled();
    expect(locationCreate).not.toHaveBeenCalled();
    expect(placementsByTitle()).toEqual({ Loose: undefined });
  });
});
