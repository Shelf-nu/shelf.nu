/**
 * @file Tests how `createAssetsFromBackupImport` restores placements, custody
 * and the relations an asset points at by name.
 *
 * Locations are resolved by name once, before any asset is created; the other
 * relations are found or created row by row, one asset at a time. These tests
 * pin what each asset is created with, and that a name shared by several
 * assets is created once.
 *
 * @see {@link file://./service.server.ts} `createAssetsFromBackupImport`
 */
import { beforeEach, describe, expect, it, vitest } from "vitest";

const locationFindMany = vitest.fn();
const locationCreate = vitest.fn();
const assetCreate = vitest.fn();
const assetUpdate = vitest.fn().mockResolvedValue({});
const assetModelFindFirst = vitest.fn();
const assetModelCreate = vitest.fn();
const categoryFindFirst = vitest.fn();
const categoryCreate = vitest.fn();
const tagFindFirst = vitest.fn();
const tagCreate = vitest.fn();
const teamMemberFindFirst = vitest.fn();
const teamMemberCreate = vitest.fn();

// why: the restore's only reads and writes that matter here. The rest of
// `db` is left out: a call to it would throw and fail the test loudly.
vitest.mock("~/database/db.server", () => ({
  db: {
    location: { findMany: locationFindMany, create: locationCreate },
    asset: { create: assetCreate, update: assetUpdate },
    assetModel: { findFirst: assetModelFindFirst, create: assetModelCreate },
    category: { findFirst: categoryFindFirst, create: categoryCreate },
    tag: { findFirst: tagFindFirst, create: tagCreate },
    teamMember: { findFirst: teamMemberFindFirst, create: teamMemberCreate },
  },
}));

// why: upserting a custom field writes definitions and asset index settings,
// which are covered by the custom-field module's own tests. The mock is typed
// by `upsertCustomField`'s return type, so the shape the restore reads from it
// stays compiler-checked.
vitest.mock("../custom-field/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "../custom-field/service.server"
  )),
  upsertCustomField: vitest.fn(),
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
const { upsertCustomField } = await import("../custom-field/service.server");

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
        location: {
          name: "Warehouse",
          description: "Back room",
          address: "1 Dock Road",
          createdAt: "2026-01-02T03:04:05.000Z",
          updatedAt: "2026-01-02T03:04:05.000Z",
        },
      }),
    ]);

    expect(placementsByTitle()["Cable Ties"]).toEqual([
      { locationId: "new-Warehouse", organizationId: "org-1", quantity: 40 },
    ]);
    // The backup describes the location, so the created one keeps it.
    expect(locationCreate).toHaveBeenCalledWith({
      data: {
        name: "Warehouse",
        description: "Back room",
        address: "1 Dock Road",
        createdAt: new Date("2026-01-02T03:04:05.000Z"),
        updatedAt: new Date("2026-01-02T03:04:05.000Z"),
        organizationId: "org-1",
        userId: "user-1",
      },
      select: { id: true },
    });
  });

  it("uses the location the database matches when JavaScript lower-cases the name differently", async () => {
    // Postgres folds `İ` to `i`, JavaScript to `i` plus a combining dot, so
    // the batch lookup finds a location the file's key does not recognise.
    locationFindMany.mockResolvedValue([
      { id: "loc-istanbul", name: "istanbul" },
    ]);

    await restore([
      row({
        title: "Map",
        assetLocations: [{ location: "İstanbul", quantity: 1 }],
      }),
    ]);

    expect(locationFindMany).toHaveBeenLastCalledWith({
      where: {
        organizationId: "org-1",
        name: { in: ["İstanbul"], mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    expect(locationCreate).not.toHaveBeenCalled();
    expect(placementsByTitle().Map).toEqual([
      { locationId: "loc-istanbul", organizationId: "org-1", quantity: 1 },
    ]);
  });

  it("restores a pool whose placements exceed its stock as the source holds it", async () => {
    await restore([
      row({
        title: "Batteries",
        type: "QUANTITY_TRACKED",
        quantity: "94",
        assetLocations: [
          { location: "Store", quantity: 60 },
          { location: "Studio", quantity: 40 },
        ],
      }),
      row({
        title: "Pens",
        type: "QUANTITY_TRACKED",
        quantity: "143",
        assetLocations: [{ location: "Store", quantity: 99 }],
      }),
    ]);

    const assets = assetDataByTitle();
    // Created with stock for its placements, so the placement check passes,
    expect(assets.Batteries.quantity).toBe(100);
    expect(placementsByTitle().Batteries).toEqual([
      { locationId: "new-Store", organizationId: "org-1", quantity: 60 },
      { locationId: "new-Studio", organizationId: "org-1", quantity: 40 },
    ]);
    // then lowered to the backup's stock.
    expect(assetUpdate).toHaveBeenCalledTimes(1);
    expect(assetUpdate).toHaveBeenCalledWith({
      where: { id: "asset-Batteries", organizationId: "org-1" },
      data: { quantity: 94 },
    });
    // A pool within its stock is created as it is.
    expect(assets.Pens.quantity).toBe(143);
  });

  it("leaves an unplaced asset without placements and looks nothing up", async () => {
    await restore([row({ title: "Loose" })]);

    expect(locationFindMany).not.toHaveBeenCalled();
    expect(locationCreate).not.toHaveBeenCalled();
    expect(placementsByTitle()).toEqual({ Loose: undefined });
  });
});

/**
 * An in-memory table for one relation the restore finds or creates by name,
 * behaving like Postgres: a plain `name` is an exact match, `in` with
 * `mode: "insensitive"` ignores case, and `create` fails on a name that
 * differs from an existing one only by case, as the unique
 * `LOWER(name)` index does.
 */
function fakeNamedTable(prefix: string) {
  const rows: { id: string; name: string }[] = [];
  const sameName = (a: string, b: string) =>
    a.toLowerCase() === b.toLowerCase();
  return {
    rows,
    findFirst: ({
      where,
    }: {
      where: { name: string | { in: string[]; mode?: "insensitive" } };
    }) => {
      const match =
        typeof where.name === "string"
          ? (row: { name: string }) => row.name === where.name
          : (row: { name: string }) =>
              (where.name as { in: string[] }).in.some((name) =>
                sameName(name, row.name)
              );
      return Promise.resolve(rows.find(match) ?? null);
    },
    create: ({ data }: { data: { name: string } }) => {
      if (rows.some((row) => sameName(row.name, data.name))) {
        return Promise.reject(new Error(`Unique constraint: ${data.name}`));
      }
      const created = { id: `${prefix}-${data.name}`, name: data.name };
      rows.push(created);
      return Promise.resolve(created);
    },
  };
}

/** The `db.asset.create` data each call received, by title. */
function assetDataByTitle() {
  const calls = assetCreate.mock.calls as [
    { data: Record<string, unknown> & { title: string } },
  ][];
  return Object.fromEntries(calls.map(([{ data }]) => [data.title, data]));
}

describe("createAssetsFromBackupImport shared relations", () => {
  let categories: ReturnType<typeof fakeNamedTable>;
  let tags: ReturnType<typeof fakeNamedTable>;
  let teamMembers: ReturnType<typeof fakeNamedTable>;

  beforeEach(() => {
    vitest.clearAllMocks();
    categories = fakeNamedTable("cat");
    tags = fakeNamedTable("tag");
    teamMembers = fakeNamedTable("tm");
    categoryFindFirst.mockImplementation(categories.findFirst);
    categoryCreate.mockImplementation(categories.create);
    tagFindFirst.mockImplementation(tags.findFirst);
    tagCreate.mockImplementation(tags.create);
    teamMemberFindFirst.mockImplementation(teamMembers.findFirst);
    teamMemberCreate.mockImplementation(teamMembers.create);
    assetCreate.mockImplementation(({ data }) =>
      Promise.resolve({ id: `asset-${data.title}` })
    );
  });

  it("creates a new category and tag shared by several assets once", async () => {
    const shared = {
      category: {
        name: "Audio",
        color: "#123456",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      tags: [{ name: "Fragile" }],
    };

    await restore([
      row({ title: "Mic 1", ...shared }),
      row({ title: "Mic 2", ...shared }),
    ]);

    expect(categories.rows).toEqual([{ id: "cat-Audio", name: "Audio" }]);
    expect(tags.rows).toEqual([{ id: "tag-Fragile", name: "Fragile" }]);
    const byTitle = assetDataByTitle();
    expect(byTitle["Mic 1"].categoryId).toBe("cat-Audio");
    expect(byTitle["Mic 2"].categoryId).toBe("cat-Audio");
    expect(byTitle["Mic 2"].tags).toEqual({ connect: [{ id: "tag-Fragile" }] });
  });

  it("uses a workspace category and tag whose name matches regardless of case", async () => {
    categories.rows.push({ id: "cat-existing", name: "AUDIO" });
    tags.rows.push({ id: "tag-existing", name: "FRAGILE" });

    await restore([
      row({
        title: "Mic",
        category: { name: "Audio", color: "#123456" },
        tags: [{ name: "fragile" }],
      }),
    ]);

    expect(categoryCreate).not.toHaveBeenCalled();
    expect(tagCreate).not.toHaveBeenCalled();
    expect(assetDataByTitle().Mic).toMatchObject({
      categoryId: "cat-existing",
      tags: { connect: [{ id: "tag-existing" }] },
    });
  });

  it("restores custody from the exported list of rows", async () => {
    teamMembers.rows.push({ id: "tm-existing", name: "Ada" });

    await restore([
      row({
        title: "Tripod",
        custody: [{ quantity: 1, custodian: { id: "src-1", name: "Ada" } }],
      }),
      row({
        title: "Pens",
        type: "QUANTITY_TRACKED",
        quantity: "50",
        custody: [
          { quantity: 5, custodian: { id: "src-2", name: "Grace" } },
          { quantity: 3, custodian: { id: "src-1", name: "Ada" } },
        ],
      }),
    ]);

    const byTitle = assetDataByTitle();
    expect(byTitle.Tripod.custody).toEqual({
      create: [{ teamMemberId: "tm-existing", quantity: 1 }],
    });
    expect(byTitle.Pens.custody).toEqual({
      create: [
        { teamMemberId: "tm-Grace", quantity: 5 },
        { teamMemberId: "tm-existing", quantity: 3 },
      ],
    });
    // Only Grace is new to the workspace; Ada is matched, not recreated.
    expect(teamMemberCreate).toHaveBeenCalledTimes(1);
  });

  it("matches a custodian regardless of case and merges rows that resolve to one", async () => {
    teamMembers.rows.push({ id: "tm-existing", name: "Ada" });

    await restore([
      row({
        title: "Pens",
        type: "QUANTITY_TRACKED",
        quantity: "50",
        custody: [
          { quantity: 5, custodian: { name: "ada" } },
          { quantity: 3, custodian: { name: "ADA" } },
        ],
      }),
    ]);

    expect(teamMemberCreate).not.toHaveBeenCalled();
    // One row per team member: the custody unique index allows no more.
    expect(assetDataByTitle().Pens.custody).toEqual({
      create: [{ teamMemberId: "tm-existing", quantity: 8 }],
    });
  });

  it("matches an asset model by exact name regardless of case, oldest first", async () => {
    assetModelFindFirst.mockResolvedValue({ id: "model-sm58" });

    await restore([
      row({
        title: "Mic",
        type: "INDIVIDUAL",
        assetModel: { name: " SM_58 " },
      }),
    ]);

    // `in` keeps `_` a plain character; `equals` + insensitive is an ILIKE,
    // where it matches any one character.
    expect(assetModelFindFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        name: { in: ["SM_58"], mode: "insensitive" },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(assetModelCreate).not.toHaveBeenCalled();
    expect(assetDataByTitle().Mic.assetModelId).toBe("model-sm58");
  });

  it("links custom field values to the upserted definitions", async () => {
    vitest.mocked(upsertCustomField).mockResolvedValue({
      customFields: {
        Serial: { id: "cf-serial" } as Awaited<
          ReturnType<typeof upsertCustomField>
        >["customFields"][string],
      },
      newOrUpdatedFields: [],
    });

    await restore([
      row({
        title: "Camera",
        customFields: [
          {
            value: { raw: "SN-1", valueText: "SN-1" },
            customField: { id: "src-cf", name: "Serial", type: "TEXT" },
          },
        ],
      }),
    ]);

    expect(assetDataByTitle().Camera.customFields).toEqual({
      create: [
        {
          value: { raw: "SN-1", valueText: "SN-1" },
          customFieldId: "cf-serial",
        },
      ],
    });
  });
});

describe("createAssetsFromBackupImport archived state (issue #382)", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    locationFindMany.mockResolvedValue([]);
    assetCreate.mockImplementation(({ data }) =>
      Promise.resolve({ id: `asset-${data.title}` })
    );
  });

  it("restores an archived asset as archived and an active one as active", async () => {
    await restore([
      row({ title: "Old drill", archivedAt: "2026-09-01T10:00:00.000Z" }),
      row({ title: "Tripod", archivedAt: "" }),
    ]);

    const data = assetDataByTitle();
    expect(data["Old drill"].archivedAt).toEqual(
      new Date("2026-09-01T10:00:00.000Z")
    );
    expect(data.Tripod.archivedAt).toBeNull();
  });
});
