// @vitest-environment node
/**
 * Tests for the batched chunk writer: which batch statements one chunk issues,
 * what each row becomes, and how mid-import conflicts turn into warnings.
 *
 * @see {@link file://./chunk-writer.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { recordEvents } from "~/modules/activity-event/service.server";
import { getAssetModelDefaults } from "~/modules/asset-model/defaults.server";
import { ShelfError } from "~/utils/error";
import { assertCategoriesBelongToOrg } from "~/utils/org-validation.server";
import type { WriteImportChunkArgs } from "./chunk-writer.server";
import { appendImportWarnings, writeImportChunk } from "./chunk-writer.server";
import type { ResolvedImportEntities, StoredImportRow } from "./types";

/**
 * Fake transaction client, one `vi.fn` per method the writer uses.
 * why: there is no real-database test harness in this repo; these tests
 * assert the batch payloads, and the writer is verified against the local
 * database separately.
 */
const tx = vi.hoisted(() => ({
  assetImport: { updateMany: vi.fn() },
  customField: { findMany: vi.fn() },
  asset: { createMany: vi.fn() },
  qr: { updateMany: vi.fn(), createMany: vi.fn() },
  assetLocation: { createMany: vi.fn() },
  assetKit: { createMany: vi.fn() },
  custody: { createMany: vi.fn() },
  assetCustomFieldValue: { createMany: vi.fn() },
  barcode: { findMany: vi.fn(), updateMany: vi.fn(), createMany: vi.fn() },
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
}));

// why: the chunk is written in one interactive transaction; the callback runs
// against the fake client above so every statement inside it can be asserted.
vi.mock("~/database/db.server", () => ({
  db: { $transaction: vi.fn() },
}));

// why: activity events have their own tests, and their actor lookup would need
// user fakes on the transaction client.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvents: vi.fn(),
}));

// why: reading a model's defaults has its own suite; here only how the writer
// applies them to rows matters.
vi.mock("~/modules/asset-model/defaults.server", () => ({
  getAssetModelDefaults: vi.fn(),
}));

// why: the org guards have their own tests; here they must not need extra
// `tx` fakes for every model they read.
vi.mock("~/utils/org-validation.server", () => ({
  assertAssetModelsBelongToOrg: vi.fn(),
  assertCategoriesBelongToOrg: vi.fn(),
  assertKitsBelongToOrg: vi.fn(),
  assertLocationsBelongToOrg: vi.fn(),
  assertTagsBelongToOrg: vi.fn(),
  assertTeamMembersBelongToOrg: vi.fn(),
}));

const resolvedFixture: ResolvedImportEntities = {
  kits: { "Camera kit": "kit-cam" },
  categories: { Tools: "cat-tools" },
  locations: { Store: "loc-store" },
  teamMembers: { Sam: "tm-sam" },
  tags: { red: "tag-red", big: "tag-big" },
  customFields: {},
  assetModels: {},
  qrIdsByRowKey: {},
};

/**
 * A stored row with only a title, plus the given cells.
 *
 * @param assetId - Pre-allocated asset id
 * @param cells - Extra cells, including `key` and `rowNumber` overrides
 */
function row(
  assetId: string,
  cells: Partial<StoredImportRow> = {}
): StoredImportRow {
  return {
    key: `key-${assetId}`,
    title: `Asset ${assetId}`,
    assetId,
    rowNumber: 2,
    ...cells,
  };
}

/**
 * Writer arguments for a chunk starting at row 0.
 *
 * @param overrides - Fields to replace
 */
function args(
  overrides: Partial<WriteImportChunkArgs> = {}
): WriteImportChunkArgs {
  return {
    importId: "imp",
    organizationId: "org",
    userId: "user",
    rows: [],
    chunkStart: 0,
    resolved: resolvedFixture,
    canUseBarcodes: false,
    imagePaths: {},
    ...overrides,
  };
}

describe("writeImportChunk", () => {
  beforeEach(() => {
    // resetAllMocks, not clearAllMocks: queued `mockResolvedValueOnce` values
    // must not leak into the next test.
    vi.resetAllMocks();
    vi.mocked(db.$transaction).mockImplementation(((
      cb: (client: typeof tx) => unknown
    ) => cb(tx)) as never);
    tx.$queryRaw.mockResolvedValue([{ id: "SAM-0001" }, { id: "SAM-0002" }]);
    tx.$executeRaw.mockResolvedValue(1);
    tx.customField.findMany.mockResolvedValue([]);
    tx.barcode.findMany.mockResolvedValue([]);
    tx.barcode.updateMany.mockResolvedValue({ count: 1 });
    tx.qr.updateMany.mockResolvedValue({ count: 1 });
  });

  it("writes one createMany per table for a plain chunk", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    const result = await writeImportChunk(
      args({ rows: [row("a1", { category: "Tools" }), row("a2")] })
    );
    expect(result).toEqual({
      applied: true,
      nextProcessedRows: 2,
      warnings: [],
    });
    expect(tx.assetImport.updateMany).toHaveBeenCalledWith({
      where: { id: "imp", organizationId: "org", processedRows: 0 },
      data: { processedRows: 2 },
    });
    expect(tx.asset.createMany).toHaveBeenCalledOnce();
    expect(tx.asset.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        id: "a1",
        categoryId: "cat-tools",
        sequentialId: "SAM-0001",
        organizationId: "org",
        userId: "user",
        description: "",
        availableToBook: true,
        mainImage: null,
      }),
      expect.objectContaining({
        id: "a2",
        categoryId: null,
        sequentialId: "SAM-0002",
      }),
    ]);
    expect(tx.qr.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(tx.qr.createMany.mock.calls[0][0].data[0]).toMatchObject({
      version: 0,
      errorCorrection: "L",
      userId: "user",
      organizationId: "org",
      assetId: "a1",
    });
    expect(tx.custody.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(recordEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({ action: "ASSET_CREATED", assetId: "a1" }),
        expect.objectContaining({ assetId: "a2" }),
      ],
      tx
    );
  });

  it("tells the user to resume when a record was deleted since PREPARE", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(assertCategoriesBelongToOrg).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        label: "Organization",
        message: "Some of the selected categories do not exist.",
        status: 400,
      })
    );

    await expect(
      writeImportChunk(args({ rows: [row("a1", { category: "Tools" })] }))
    ).rejects.toMatchObject({
      status: 400,
      message:
        "Some categories this import uses were deleted while it ran. Resume the import to create them again and continue.",
    });
    expect(tx.asset.createMany).not.toHaveBeenCalled();
  });

  it("skips a chunk whose rows are already committed", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 0 });
    const result = await writeImportChunk(
      args({ chunkStart: 100, rows: [row("a1")] })
    );
    expect(result).toEqual({
      applied: false,
      nextProcessedRows: 101,
      warnings: [],
    });
    expect(tx.asset.createMany).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(recordEvents).not.toHaveBeenCalled();
  });

  it("stores warnings found before the transaction with the chunk", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    const imageWarning = {
      row: 2,
      title: "Asset a1",
      message:
        'Image "https://x.test/a.jpg" could not be downloaded; the asset was imported without an image.',
    };

    const result = await writeImportChunk(
      args({ rows: [row("a1")], extraWarnings: [imageWarning] })
    );

    expect(result.warnings).toEqual([imageWarning]);
    // Appended inside the chunk's transaction, with the rows.
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    expect(tx.$executeRaw.mock.calls[0]).toContain(
      JSON.stringify([imageWarning])
    );
  });

  it("drops warnings found before the transaction when the chunk was already committed", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 0 });

    const result = await writeImportChunk(
      args({
        rows: [row("a1")],
        extraWarnings: [{ row: 2, title: "Asset a1", message: "Skipped" }],
      })
    );

    expect(result.warnings).toEqual([]);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("sets the signed image of rows that have one", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    const expiry = new Date("2026-10-17T00:00:00Z");
    await writeImportChunk(
      args({
        rows: [row("a1"), row("a2")],
        imagePaths: {
          a1: { mainImage: "signed-a1", mainImageExpiration: expiry },
        },
      })
    );
    expect(tx.asset.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        id: "a1",
        mainImage: "signed-a1",
        mainImageExpiration: expiry,
      }),
      expect.objectContaining({
        id: "a2",
        mainImage: null,
        mainImageExpiration: null,
      }),
    ]);
  });

  it("quantity-tracked rows place the full pool and source custody from the location", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    await writeImportChunk(
      args({
        rows: [
          row("q1", {
            type: "QUANTITY_TRACKED",
            quantity: "40",
            consumptionType: "TWO_WAY",
            location: "Store",
            custodian: "Sam",
          }),
        ],
      })
    );
    expect(tx.assetLocation.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        assetId: "q1",
        locationId: "loc-store",
        quantity: 40,
      }),
    ]);
    expect(tx.custody.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        assetId: "q1",
        teamMemberId: "tm-sam",
        locationId: "loc-store",
      }),
    ]);
    expect(tx.asset.createMany.mock.calls[0][0].data[0]).toMatchObject({
      status: "IN_CUSTODY",
      quantity: 40,
      type: "QUANTITY_TRACKED",
      consumptionType: "TWO_WAY",
    });
  });

  it("individual rows are placed with one unit and custody has no source", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    await writeImportChunk(
      args({ rows: [row("i1", { location: "Store", custodian: "Sam" })] })
    );
    expect(tx.assetLocation.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ assetId: "i1", quantity: 1 }),
    ]);
    expect(tx.custody.createMany.mock.calls[0][0].data).toEqual([
      { assetId: "i1", teamMemberId: "tm-sam" },
    ]);
  });

  it("kit rows get the kit pivot and no direct custody", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    await writeImportChunk(
      args({ rows: [row("k1", { kit: "Camera kit", custodian: "Sam" })] })
    );
    expect(tx.assetKit.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({
        assetId: "k1",
        kitId: "kit-cam",
        quantity: 1,
      }),
    ]);
    expect(tx.custody.createMany).not.toHaveBeenCalled();
    expect(tx.asset.createMany.mock.calls[0][0].data[0].status).toBeUndefined();
  });

  it("connects a claimed QR code instead of creating one", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    tx.qr.updateMany.mockResolvedValue({ count: 1 });
    await writeImportChunk(
      args({
        rows: [row("a1", { key: "k-a1" })],
        resolved: { ...resolvedFixture, qrIdsByRowKey: { "k-a1": "QR1" } },
      })
    );
    expect(tx.qr.updateMany).toHaveBeenCalledWith({
      where: { id: "QR1", organizationId: "org", assetId: null, kitId: null },
      data: { assetId: "a1" },
    });
    expect(tx.qr.createMany).not.toHaveBeenCalled();
  });

  it("turns a taken QR code into a new code and a warning", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    tx.qr.updateMany.mockResolvedValue({ count: 0 });
    const result = await writeImportChunk(
      args({
        rows: [row("a1", { key: "k-a1", rowNumber: 7 })],
        resolved: { ...resolvedFixture, qrIdsByRowKey: { "k-a1": "QR1" } },
      })
    );
    expect(tx.qr.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ assetId: "a1" }),
    ]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        row: 7,
        title: "Asset a1",
        message: expect.stringContaining("QR1"),
      }),
    ]);
    expect(tx.$executeRaw).toHaveBeenCalled(); // appendImportWarnings
  });

  it("turns a taken barcode into a warning", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    tx.barcode.findMany.mockResolvedValueOnce([
      { id: "b9", value: "ABC123", assetId: "other", kitId: null },
    ]);
    const result = await writeImportChunk(
      args({
        canUseBarcodes: true,
        rows: [row("a1", { barcode_Code128: "ABC123", rowNumber: 4 })],
      })
    );
    expect(tx.barcode.createMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ value: "ABC123" }),
        ]),
      })
    );
    expect(result.warnings).toEqual([
      expect.objectContaining({
        row: 4,
        message: expect.stringContaining("ABC123"),
      }),
    ]);
    expect(tx.asset.createMany.mock.calls[0][0].data[0]).toMatchObject({
      id: "a1",
    });
  });

  it("reuses an orphaned barcode and retypes it", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    tx.barcode.findMany.mockResolvedValueOnce([
      { id: "b1", value: "ORPHAN1", assetId: null, kitId: null },
    ]);
    const result = await writeImportChunk(
      args({
        canUseBarcodes: true,
        rows: [row("a1", { barcode_Code39: "orphan1" })],
      })
    );
    expect(tx.barcode.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", organizationId: "org", assetId: null, kitId: null },
      data: { assetId: "a1", type: "Code39" },
    });
    expect(tx.barcode.createMany).not.toHaveBeenCalled();
    expect(result.warnings).toEqual([]);
  });

  it("creates new barcodes and warns for one skipped as a duplicate", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    // First read: nothing exists. Re-read after the insert: only NEW1 landed.
    tx.barcode.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ value: "NEW1", assetId: "a1" }]);
    const result = await writeImportChunk(
      args({
        canUseBarcodes: true,
        rows: [
          row("a1", { barcode_Code128: "new1" }),
          row("a2", { barcode_Code128: "NEW2", rowNumber: 3 }),
        ],
      })
    );
    expect(tx.barcode.createMany).toHaveBeenCalledWith({
      data: [
        {
          type: "Code128",
          value: "NEW1",
          organizationId: "org",
          assetId: "a1",
        },
        {
          type: "Code128",
          value: "NEW2",
          organizationId: "org",
          assetId: "a2",
        },
      ],
      skipDuplicates: true,
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({
        row: 3,
        message: expect.stringContaining("NEW2"),
      }),
    ]);
  });

  it("ignores barcode cells when barcodes are not enabled", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    await writeImportChunk(
      args({ rows: [row("a1", { barcode_Code128: "ABC123" })] })
    );
    expect(tx.barcode.findMany).not.toHaveBeenCalled();
    expect(tx.barcode.createMany).not.toHaveBeenCalled();
  });

  it("writes custom field values for fields that still exist", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    tx.customField.findMany.mockResolvedValue([
      { id: "cf-serial", name: "Serial", type: "TEXT" },
    ]);
    await writeImportChunk(
      args({
        rows: [row("a1", { "cf:Serial,type:TEXT": "S-1" })],
        resolved: { ...resolvedFixture, customFields: { Serial: "cf-serial" } },
      })
    );
    expect(tx.customField.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["cf-serial"] },
        organizationId: "org",
        deletedAt: null,
      },
      select: { id: true, name: true, type: true },
    });
    expect(tx.assetCustomFieldValue.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "a1",
          customFieldId: "cf-serial",
          value: expect.objectContaining({ raw: "S-1" }),
        },
      ],
    });
  });

  it("fills empty cells of a row that names a model from its defaults, and keeps the file's values", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(getAssetModelDefaults).mockResolvedValue({
      id: "model-1",
      name: "Westermo L210",
      defaultCategoryId: "cat-network",
      defaultValuation: 450,
      customFieldDefaults: [
        {
          customFieldId: "cf-brand",
          value: { raw: "Westermo", valueOption: "Westermo" },
          customField: {
            id: "cf-brand",
            name: "Brand",
            type: "OPTION",
            active: true,
            deletedAt: null,
            categories: [],
          },
        },
      ],
    });

    await writeImportChunk(
      args({
        rows: [
          // Empty row: every default applies.
          row("a1", { assetModel: "Westermo L210" }),
          // The file's category and valuation win over the model's.
          row("a2", {
            assetModel: "Westermo L210",
            category: "Tools",
            valuation: "99",
          }),
        ],
        resolved: {
          ...resolvedFixture,
          assetModels: { "Westermo L210": "model-1" },
        },
      })
    );

    const created = vi.mocked(tx.asset.createMany).mock.calls[0][0].data;
    expect(created).toEqual([
      expect.objectContaining({
        id: "a1",
        categoryId: "cat-network",
        valuation: 450,
      }),
      expect.objectContaining({
        id: "a2",
        categoryId: "cat-tools",
        valuation: 99,
      }),
    ]);
    expect(tx.assetCustomFieldValue.createMany).toHaveBeenCalledWith({
      data: [
        {
          assetId: "a1",
          customFieldId: "cf-brand",
          value: { raw: "Westermo", valueOption: "Westermo" },
        },
        {
          assetId: "a2",
          customFieldId: "cf-brand",
          value: { raw: "Westermo", valueOption: "Westermo" },
        },
      ],
    });
  });

  it("skips a custom field value that no longer fits", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    tx.customField.findMany.mockResolvedValue([]); // the field was deleted mid-import
    const result = await writeImportChunk(
      args({
        rows: [row("a1", { "cf:Serial,type:TEXT": "S-1", rowNumber: 3 })],
        resolved: { ...resolvedFixture, customFields: { Serial: "cf-serial" } },
      })
    );
    expect(tx.assetCustomFieldValue.createMany).not.toHaveBeenCalled();
    expect(result.warnings).toEqual([
      expect.objectContaining({
        row: 3,
        message: expect.stringContaining("Serial"),
      }),
    ]);
  });

  it("skips a value whose field was retyped and still imports the row", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    // The field is a DATE now, so "S-1" no longer fits.
    tx.customField.findMany.mockResolvedValue([
      { id: "cf-serial", name: "Serial", type: "DATE" },
    ]);
    const result = await writeImportChunk(
      args({
        rows: [row("a1", { "cf:Serial,type:TEXT": "S-1", rowNumber: 5 })],
        resolved: { ...resolvedFixture, customFields: { Serial: "cf-serial" } },
      })
    );
    expect(result.applied).toBe(true);
    expect(tx.assetCustomFieldValue.createMany).not.toHaveBeenCalled();
    expect(tx.asset.createMany).toHaveBeenCalledOnce();
    expect(result.warnings).toEqual([
      expect.objectContaining({
        row: 5,
        message: expect.stringContaining('"S-1"'),
      }),
    ]);
  });

  it("links tags through the join table in one statement", async () => {
    tx.assetImport.updateMany.mockResolvedValue({ count: 1 });
    await writeImportChunk(
      args({
        rows: [
          row("a1", { tags: ["red", "big"] }),
          row("a2", { tags: ["red"] }),
        ],
      })
    );
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
    const query = tx.$executeRaw.mock.calls[0][0];
    const sql = query.strings.join("?");
    expect(sql).toContain('"_AssetToTag"');
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(query.values).toEqual([
      ["a1", "a1", "a2"],
      ["tag-red", "tag-big", "tag-red"],
    ]);
  });
});

describe("appendImportWarnings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does nothing for an empty list", async () => {
    // why: the client is handed in; asserting it is never touched
    const client = { $executeRaw: vi.fn() };
    await appendImportWarnings(client as never, "imp", []);
    expect(client.$executeRaw).not.toHaveBeenCalled();
  });

  it("appends the warnings and their count in one statement", async () => {
    // why: the client is handed in; only the statement is inspected
    const client = { $executeRaw: vi.fn().mockResolvedValue(1) };
    const warnings = [{ row: 2, title: "Drill", message: "Skipped" }];
    await appendImportWarnings(client as never, "imp", warnings);
    expect(client.$executeRaw).toHaveBeenCalledOnce();
    const [strings, ...values] = client.$executeRaw.mock.calls[0];
    expect(strings.join("?")).toContain('"warningCount" = "warningCount" +');
    expect(values).toEqual([500, JSON.stringify(warnings), 1, "imp"]);
  });
});
