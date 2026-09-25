/**
 * @file Tests how `createAssetsFromBackupImport` restores placements, custody
 * and the records assets point at by name.
 *
 * The restore creates its assets in parallel. Every name (location, category,
 * tag, asset model, custodian, custom field) is therefore resolved once,
 * before the assets: resolving per asset would let two assets that share a new
 * name each try to create it. These tests pin that, and what each asset is
 * created with.
 *
 * @see {@link file://./service.server.ts} `createAssetsFromBackupImport`
 */
import { beforeEach, describe, expect, it, vitest } from "vitest";

const locationFindMany = vitest.fn();
const locationCreate = vitest.fn();
const categoryFindMany = vitest.fn();
const categoryCreate = vitest.fn();
const tagFindMany = vitest.fn();
const tagCreate = vitest.fn();
const assetModelFindMany = vitest.fn();
const assetModelCreate = vitest.fn();
const teamMemberFindMany = vitest.fn();
const teamMemberCreate = vitest.fn();
const customFieldFindFirst = vitest.fn();
const customFieldCreate = vitest.fn();
const assetCreate = vitest.fn();
const assetUpdate = vitest.fn();

// why: the restore's only reads and writes that matter here. The rest of
// `db` is left out: a call to it would throw and fail the test loudly.
vitest.mock("~/database/db.server", () => ({
  db: {
    location: { findMany: locationFindMany, create: locationCreate },
    category: { findMany: categoryFindMany, create: categoryCreate },
    tag: { findMany: tagFindMany, create: tagCreate },
    assetModel: { findMany: assetModelFindMany, create: assetModelCreate },
    teamMember: { findMany: teamMemberFindMany, create: teamMemberCreate },
    customField: { findFirst: customFieldFindFirst, create: customFieldCreate },
    // A new custom field is added to each saved index view; there are none.
    assetIndexSettings: { findMany: vitest.fn().mockResolvedValue([]) },
    asset: { create: assetCreate, update: assetUpdate },
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

/** Every lookup finds nothing, and every create returns `new-<name>`. */
function resetDb() {
  vitest.clearAllMocks();
  // `clearAllMocks` keeps queued `mockResolvedValueOnce` values; a test that
  // queues more than it uses must not hand the rest to the next test.
  for (const fn of [
    locationFindMany,
    locationCreate,
    categoryFindMany,
    categoryCreate,
    tagFindMany,
    tagCreate,
    assetModelFindMany,
    assetModelCreate,
    teamMemberFindMany,
    teamMemberCreate,
    customFieldFindFirst,
    customFieldCreate,
    assetCreate,
    assetUpdate,
  ]) {
    fn.mockReset();
  }
  assetUpdate.mockResolvedValue({});
  const createdByName = ({ data }: { data: { name: string } }) =>
    Promise.resolve({ id: `new-${data.name}` });
  for (const findMany of [
    locationFindMany,
    categoryFindMany,
    tagFindMany,
    assetModelFindMany,
    teamMemberFindMany,
  ]) {
    findMany.mockResolvedValue([]);
  }
  for (const create of [
    locationCreate,
    categoryCreate,
    tagCreate,
    assetModelCreate,
    teamMemberCreate,
  ]) {
    create.mockImplementation(createdByName);
  }
  customFieldFindFirst.mockResolvedValue(null);
  customFieldCreate.mockImplementation(({ data }) =>
    Promise.resolve({ ...data, id: `new-${data.name}` })
  );
  assetCreate.mockImplementation(({ data }) =>
    Promise.resolve({ id: `asset-${data.title}` })
  );
}

/** The data each `db.asset.create` call received, by title. */
function assetDataByTitle() {
  const calls = assetCreate.mock.calls as [
    { data: Record<string, unknown> & { title: string } },
  ][];
  return Object.fromEntries(calls.map(([{ data }]) => [data.title, data]));
}

/** A Custody row as the backup export writes it. */
function custodyRow({
  name,
  quantity = 1,
  kitCustodyId = "",
  sourceId = `source-${name}`,
  custodianCreatedAt = "2026-08-01T10:00:00.000Z",
}: {
  name: string;
  quantity?: number;
  kitCustodyId?: string;
  /** The custodian's team member id in the source workspace. */
  sourceId?: string;
  custodianCreatedAt?: string;
}) {
  return {
    id: `custody-${sourceId}`,
    teamMemberId: sourceId,
    assetId: "source-id",
    kitCustodyId,
    quantity,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    custodian: {
      id: sourceId,
      name,
      organizationId: "source-org",
      userId: "",
      createdAt: custodianCreatedAt,
      updatedAt: "2026-08-02T10:00:00.000Z",
      deletedAt: "",
    },
  };
}

/** A custom field value as the backup export writes it. */
function customFieldValue({
  name,
  type = "TEXT",
  options = [],
  value,
}: {
  name: string;
  type?: string;
  options?: string[];
  value: Record<string, unknown>;
}) {
  return {
    id: `value-${name}`,
    value,
    customField: {
      id: `source-${name}`,
      name,
      helpText: "",
      required: false,
      active: true,
      type,
      options,
      organizationId: "source-org",
      userId: "source-user",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
      deletedAt: "",
    },
  };
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
  beforeEach(resetDb);

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

describe("createAssetsFromBackupImport custody", () => {
  beforeEach(resetDb);

  it("restores an individual custodian and a pool's custodians with their units, not kit custody", async () => {
    await restore([
      row({
        title: "Tripod",
        type: "INDIVIDUAL",
        status: "IN_CUSTODY",
        custody: [custodyRow({ name: "Ana" })],
      }),
      row({
        title: "Pens",
        type: "QUANTITY_TRACKED",
        quantity: "100",
        status: "IN_CUSTODY",
        custody: [
          custodyRow({ name: "Ana", quantity: 30 }),
          custodyRow({ name: "Ben", quantity: 20 }),
          custodyRow({ name: "Cleo", quantity: 5, kitCustodyId: "kc-1" }),
        ],
      }),
    ]);

    const assets = assetDataByTitle();
    expect(assets.Tripod.custody).toEqual({
      create: [{ teamMemberId: "new-Ana", quantity: 1 }],
    });
    expect(assets.Pens.custody).toEqual({
      create: [
        { teamMemberId: "new-Ana", quantity: 30 },
        { teamMemberId: "new-Ben", quantity: 20 },
      ],
    });
    expect(assets.Tripod.status).toBe("IN_CUSTODY");
    expect(assets.Pens.status).toBe("IN_CUSTODY");
    // Ana holds both assets and is created once; Cleo held units only
    // through a kit, which the backup does not carry.
    expect(teamMemberCreate.mock.calls.map(([{ data }]) => data)).toEqual([
      {
        name: "Ana",
        organizationId: "org-1",
        createdAt: new Date("2026-08-01T10:00:00.000Z"),
        updatedAt: new Date("2026-08-02T10:00:00.000Z"),
      },
      {
        name: "Ben",
        organizationId: "org-1",
        createdAt: new Date("2026-08-01T10:00:00.000Z"),
        updatedAt: new Date("2026-08-02T10:00:00.000Z"),
      },
    ]);
  });

  it("keeps two people who share a name apart", async () => {
    teamMemberCreate
      .mockResolvedValueOnce({ id: "tm-ana-1" })
      .mockResolvedValueOnce({ id: "tm-ana-2" });

    await restore([
      row({
        title: "Pens",
        type: "QUANTITY_TRACKED",
        quantity: "100",
        custody: [
          custodyRow({ name: "Ana", quantity: 30, sourceId: "ana-1" }),
          custodyRow({ name: "Ana", quantity: 10, sourceId: "ana-2" }),
        ],
      }),
      row({
        title: "Tripod",
        custody: [custodyRow({ name: "Ana", sourceId: "ana-2" })],
      }),
    ]);

    expect(teamMemberCreate).toHaveBeenCalledTimes(2);
    const assets = assetDataByTitle();
    expect(assets.Pens.custody).toEqual({
      create: [
        { teamMemberId: "tm-ana-1", quantity: 30 },
        { teamMemberId: "tm-ana-2", quantity: 10 },
      ],
    });
    expect(assets.Tripod.custody).toEqual({
      create: [{ teamMemberId: "tm-ana-2", quantity: 1 }],
    });
  });

  it("matches each workspace team member of that name once, oldest first", async () => {
    teamMemberFindMany.mockResolvedValue([{ id: "tm-existing", name: "Ana" }]);
    teamMemberCreate.mockResolvedValueOnce({ id: "tm-created" });

    await restore([
      row({
        title: "Pens",
        type: "QUANTITY_TRACKED",
        quantity: "100",
        custody: [
          custodyRow({
            name: "Ana",
            quantity: 10,
            sourceId: "ana-newer",
            custodianCreatedAt: "2026-08-05T10:00:00.000Z",
          }),
          custodyRow({
            name: "Ana",
            quantity: 30,
            sourceId: "ana-older",
            custodianCreatedAt: "2026-08-01T10:00:00.000Z",
          }),
        ],
      }),
    ]);

    expect(assetDataByTitle().Pens.custody).toEqual({
      create: [
        { teamMemberId: "tm-created", quantity: 10 },
        { teamMemberId: "tm-existing", quantity: 30 },
      ],
    });
    expect(teamMemberCreate).toHaveBeenCalledTimes(1);
    expect(teamMemberCreate.mock.calls[0][0].data.createdAt).toEqual(
      new Date("2026-08-05T10:00:00.000Z")
    );
  });

  it("restores an asset held only through its kit as available, without custody", async () => {
    await restore([
      row({
        title: "Camera",
        type: "INDIVIDUAL",
        status: "IN_CUSTODY",
        custody: [custodyRow({ name: "Cleo", kitCustodyId: "kc-1" })],
      }),
    ]);

    const { Camera } = assetDataByTitle();
    expect(Camera.status).toBe("AVAILABLE");
    expect(Camera.custody).toBeUndefined();
    expect(teamMemberFindMany).not.toHaveBeenCalled();
    expect(teamMemberCreate).not.toHaveBeenCalled();
  });

  it("restores a backup's single custody object as one custody row", async () => {
    const {
      kitCustodyId: _kitCustodyId,
      quantity: _quantity,
      ...legacy
    } = custodyRow({ name: "Ana" });

    await restore([
      row({ title: "Tripod", status: "IN_CUSTODY", custody: legacy }),
    ]);

    expect(assetDataByTitle().Tripod.custody).toEqual({
      create: [{ teamMemberId: "new-Ana", quantity: 1 }],
    });
  });

  it("uses the workspace's team member with exactly that name", async () => {
    teamMemberFindMany.mockResolvedValue([{ id: "tm-ana", name: "Ana" }]);

    await restore([
      row({ title: "Tripod", custody: [custodyRow({ name: "Ana" })] }),
    ]);

    expect(teamMemberFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        deletedAt: null,
        name: { in: ["Ana"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    });
    expect(teamMemberCreate).not.toHaveBeenCalled();
    expect(assetDataByTitle().Tripod.custody).toEqual({
      create: [{ teamMemberId: "tm-ana", quantity: 1 }],
    });
  });
});

describe("createAssetsFromBackupImport names shared by several assets", () => {
  beforeEach(resetDb);

  /** An asset row naming the same new category, tag, model, custodian and
   * custom field, each name spelled the way `spelling` returns it. */
  const mic = (title: string, spelling: (name: string) => string) =>
    row({
      title,
      type: "INDIVIDUAL",
      status: "IN_CUSTODY",
      category: {
        id: "source-category",
        name: spelling("Audio"),
        description: "Microphones and mixers",
        color: "#ab47bc",
        createdAt: "2026-07-01T10:00:00.000Z",
        updatedAt: "2026-07-02T10:00:00.000Z",
      },
      tags: [{ id: "source-tag", name: spelling("Live") }],
      assetModel: { name: spelling("SM58") },
      custody: [custodyRow({ name: "Ana" })],
      customFields: [
        customFieldValue({
          name: spelling("Serial"),
          value: { raw: title, valueText: title },
        }),
      ],
    });

  it("creates each new name once and points every asset at it", async () => {
    await restore([
      mic("Mic 1", (name) => name),
      mic("Mic 2", (name) => name),
      mic("Mic 3", (name) => name.toLowerCase()),
    ]);

    expect(categoryCreate).toHaveBeenCalledTimes(1);
    expect(categoryCreate).toHaveBeenCalledWith({
      data: {
        name: "Audio",
        description: "Microphones and mixers",
        color: "#ab47bc",
        createdAt: new Date("2026-07-01T10:00:00.000Z"),
        updatedAt: new Date("2026-07-02T10:00:00.000Z"),
        organizationId: "org-1",
        userId: "user-1",
      },
      select: { id: true },
    });
    expect(tagCreate).toHaveBeenCalledTimes(1);
    expect(assetModelCreate).toHaveBeenCalledTimes(1);
    expect(teamMemberCreate).toHaveBeenCalledTimes(1);
    expect(customFieldCreate).toHaveBeenCalledTimes(1);

    const assets = assetDataByTitle();
    for (const title of ["Mic 1", "Mic 2", "Mic 3"]) {
      expect(assets[title]).toMatchObject({
        categoryId: "new-Audio",
        tags: { connect: [{ id: "new-Live" }] },
        assetModelId: "new-SM58",
        custody: { create: [{ teamMemberId: "new-Ana", quantity: 1 }] },
        customFields: {
          create: [
            {
              value: { raw: title, valueText: title },
              customFieldId: "new-Serial",
            },
          ],
        },
      });
    }
  });

  it("uses the workspace's records whose names match regardless of case", async () => {
    categoryFindMany.mockResolvedValue([{ id: "cat-audio", name: "AUDIO" }]);
    tagFindMany.mockResolvedValue([{ id: "tag-live", name: "live" }]);
    assetModelFindMany.mockResolvedValue([{ id: "model-sm58", name: "sm58" }]);
    customFieldFindFirst.mockResolvedValue({
      id: "cf-serial",
      name: "SERIAL",
      type: "TEXT",
      options: [],
    });

    await restore([mic("Mic 1", (name) => name)]);

    const exactly = (name: string) => ({ in: [name], mode: "insensitive" });
    expect(categoryFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", name: exactly("Audio") },
      select: { id: true, name: true },
    });
    expect(tagFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", name: exactly("Live") },
      select: { id: true, name: true },
    });
    expect(assetModelFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", name: exactly("SM58") },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    expect(customFieldFindFirst).toHaveBeenCalledWith({
      where: {
        name: exactly("Serial"),
        organizationId: "org-1",
        deletedAt: null,
      },
    });
    expect(categoryCreate).not.toHaveBeenCalled();
    expect(tagCreate).not.toHaveBeenCalled();
    expect(assetModelCreate).not.toHaveBeenCalled();
    expect(customFieldCreate).not.toHaveBeenCalled();
    expect(assetDataByTitle()["Mic 1"]).toMatchObject({
      categoryId: "cat-audio",
      tags: { connect: [{ id: "tag-live" }] },
      assetModelId: "model-sm58",
      customFields: { create: [{ customFieldId: "cf-serial" }] },
    });
  });

  it("uses the record the database matches when JavaScript lower-cases the name differently", async () => {
    // Postgres folds `İ` to `i`, JavaScript to `i` plus a combining dot, so
    // the batch lookup finds a record the file's key does not recognise.
    categoryFindMany.mockResolvedValue([
      { id: "cat-istanbul", name: "istanbul" },
    ]);

    await restore([
      row({
        title: "Map",
        category: { name: "İstanbul", color: "#ab47bc" },
      }),
    ]);

    expect(categoryFindMany).toHaveBeenLastCalledWith({
      where: {
        organizationId: "org-1",
        name: { in: ["İstanbul"], mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    expect(categoryCreate).not.toHaveBeenCalled();
    expect(assetDataByTitle().Map.categoryId).toBe("cat-istanbul");
  });

  it("creates an option field once, with its listed options and every held one", async () => {
    const color = (title: string, held: string) =>
      row({
        title,
        customFields: [
          customFieldValue({
            name: "Color",
            type: "OPTION",
            options: ["Red", "Green"],
            value: { raw: held, valueOption: held },
          }),
        ],
      });

    await restore([color("Cable 1", "Red"), color("Cable 2", "Blue")]);

    expect(customFieldCreate).toHaveBeenCalledTimes(1);
    expect(customFieldCreate.mock.calls[0][0].data).toMatchObject({
      name: "Color",
      type: "OPTION",
      options: ["Red", "Green", "Blue"],
    });
  });

  it("drops the model of a quantity-tracked row and looks no model up", async () => {
    await restore([
      row({
        title: "Batteries",
        type: "QUANTITY_TRACKED",
        quantity: "40",
        assetModel: { name: "AA" },
      }),
    ]);

    expect(assetModelFindMany).not.toHaveBeenCalled();
    expect(assetDataByTitle().Batteries.assetModelId).toBeUndefined();
  });
});
