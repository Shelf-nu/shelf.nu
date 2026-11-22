/**
 * @file Tests the write boundary of `createAssetsFromContentImport`.
 *
 * The importer writes as it goes: its taxonomy helpers create categories, tags,
 * locations, kits, custom fields and asset models, and the row loop then creates
 * assets one at a time, none of it inside a transaction. So a row rejected part
 * way through would leave everything before it committed. Pre-flight validation
 * is what stops that, and these tests pin it — they assert that a file with an
 * invalid row reaches NONE of those writers.
 *
 * Kept separate from `service.server.test.ts` because this needs the import
 * dependency graph stubbed permissively, while that file stubs several of the
 * same modules down to a single export for unrelated suites.
 *
 * @see {@link file://./import-preflight.server.ts}
 * @see {@link file://./service.server.ts} — `createAssetsFromContentImport`
 */
import { beforeEach, describe, expect, it, vitest } from "vitest";

const parseQrCodesFromImportData = vitest.fn().mockResolvedValue([]);
const createCategoriesIfNotExists = vitest.fn().mockResolvedValue({});
const createTagsIfNotExists = vitest.fn().mockResolvedValue({});
const createKitsIfNotExists = vitest.fn().mockResolvedValue({});
const createLocationsIfNotExists = vitest.fn().mockResolvedValue({});
const createTeamMemberIfNotExists = vitest.fn().mockResolvedValue({});
const createCustomFieldsIfNotExists = vitest
  .fn()
  .mockResolvedValue({ customFields: {} });
const createAssetModelsIfNotExists = vitest.fn().mockResolvedValue({});
const assetCreate = vitest.fn().mockResolvedValue({ id: "asset-new" });

const getAssetModelsDefaults = vitest.fn().mockResolvedValue(new Map());

// why: the importer reads the workspace's existing custom fields to detect a
// header whose declared type contradicts one, and `createAsset` proves the
// model and custom field ids belong to the org before writing. The custom
// field read answers the ownership check with the ids it was asked about.
// The transaction runs on the same stub so `asset.create` is observable.
vitest.mock("~/database/db.server", () => {
  const db = {
    customField: {
      findMany: vitest.fn(
        (args: { where: { id?: { in: string[] } } } | undefined) =>
          Promise.resolve(args?.where.id?.in.map((id) => ({ id })) ?? [])
      ),
    },
    assetModel: {
      findFirst: vitest.fn(
        (args: { where: { id: string; organizationId: string } }) =>
          Promise.resolve({ id: args.where.id, name: "Westermo L210" })
      ),
    },
    asset: { create: assetCreate, findFirst: vitest.fn() },
    $transaction: vitest.fn(),
  };
  db.$transaction.mockImplementation((cb: unknown) =>
    typeof cb === "function" ? (cb as (tx: unknown) => unknown)(db) : null
  );
  return { db };
});

// why: the defaults read is Prisma and has its own suite
// (`asset-model/defaults.server.test.ts`); the fill decision it feeds,
// `planModelDefaultFill`, runs for real.
vitest.mock("~/modules/asset-model/defaults.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/asset-model/defaults.server"
  )),
  getAssetModelsDefaults,
}));

// why: event persistence has its own suite; `createAsset` records one inside
// its transaction, which the stub above cannot persist.
vitest.mock("~/modules/activity-event/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/activity-event/service.server"
  )),
  recordEvent: vitest.fn().mockResolvedValue(undefined),
}));

// why: each of these is a WRITER the import calls before or inside its row
// loop. They are spied rather than removed so the tests can assert none of
// them ran. `importActual` keeps every other export of the module intact —
// `service.server.ts` imports a wide surface from several of them, and a
// wholesale mock would silently turn the rest into `undefined`.
vitest.mock("~/modules/qr/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/qr/service.server"
  )),
  parseQrCodesFromImportData,
  getQr: vitest.fn().mockResolvedValue(null),
}));

vitest.mock("~/modules/category/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/category/service.server"
  )),
  createCategoriesIfNotExists,
}));

vitest.mock("~/modules/tag/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/tag/service.server"
  )),
  createTagsIfNotExists,
}));

vitest.mock("~/modules/kit/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/kit/service.server"
  )),
  createKitsIfNotExists,
}));

vitest.mock("~/modules/location/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/location/service.server"
  )),
  createLocationsIfNotExists,
}));

vitest.mock("~/modules/team-member/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/team-member/service.server"
  )),
  createTeamMemberIfNotExists,
}));

vitest.mock("~/modules/custom-field/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/custom-field/service.server"
  )),
  createCustomFieldsIfNotExists,
}));

vitest.mock("~/modules/asset-model/service.server", async () => ({
  ...(await vitest.importActual<Record<string, unknown>>(
    "~/modules/asset-model/service.server"
  )),
  createAssetModelsIfNotExists,
}));

// why: the sequential id comes from a Postgres sequence; stub it so a clean
// file can get as far as the row loop without database plumbing.
vitest.mock("./sequential-id.server", () => ({
  getNextSequentialId: vitest.fn().mockResolvedValue("TST-0001"),
}));

const { createAssetsFromContentImport } = await import("./service.server");

/** A minimal, valid INDIVIDUAL row. Override to make it invalid. */
function row(overrides: Record<string, string> = {}) {
  return {
    key: `key-${Object.keys(overrides).join("-")}-${Math.random()}`,
    title: "Aputure 300x",
    ...overrides,
  };
}

/** Every writer the import reaches before and during its row loop. */
const writers = [
  ["parseQrCodesFromImportData", parseQrCodesFromImportData],
  ["createCategoriesIfNotExists", createCategoriesIfNotExists],
  ["createTagsIfNotExists", createTagsIfNotExists],
  ["createKitsIfNotExists", createKitsIfNotExists],
  ["createLocationsIfNotExists", createLocationsIfNotExists],
  ["createTeamMemberIfNotExists", createTeamMemberIfNotExists],
  ["createCustomFieldsIfNotExists", createCustomFieldsIfNotExists],
  ["createAssetModelsIfNotExists", createAssetModelsIfNotExists],
  ["db.asset.create", assetCreate],
] as const;

function runImport(data: Record<string, string>[]) {
  return createAssetsFromContentImport({
    data: data as never,
    userId: "user-1",
    organizationId: "org-1",
    canUseBarcodes: false,
  });
}

describe("createAssetsFromContentImport pre-flight write boundary", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("writes nothing when a LATER row is invalid", async () => {
    // The first row is perfectly valid. Before pre-flight existed it would
    // have been created and left behind when row 2 aborted the run.
    await expect(
      runImport([
        row({ category: "Lighting", tags: "grip" }),
        row({ title: "Arri AS-2", type: "QUANTITY_TRACKED" }),
      ])
    ).rejects.toMatchObject({ status: 400 });

    for (const [name, writer] of writers) {
      expect(
        writer,
        `${name} must not run for an invalid file`
      ).not.toHaveBeenCalled();
    }
  });

  it("reports every bad row in one response, not just the first", async () => {
    await expect(
      runImport([
        row({ title: "A", type: "QUANTITY_TRACKED" }),
        row({ title: "B" }),
        row({ title: "C", type: "QUANTITY_TRACKED" }),
      ])
    ).rejects.toMatchObject({
      additionalData: { totalErrors: 2 },
    });
  });

  it("sends the true problem count alongside the truncated list", async () => {
    // The payload is a contract the compiler cannot check: the import page
    // shows "the first N of M" only when these two disagree.
    await expect(
      runImport(
        Array.from({ length: 125 }, (_unused, index) =>
          row({ title: `Broken ${index}`, type: "QUANTITY_TRACKED" })
        )
      )
    ).rejects.toMatchObject({
      additionalData: { totalErrors: 125 },
    });

    await runImport(
      Array.from({ length: 125 }, (_unused, index) =>
        row({ title: `Broken ${index}`, type: "QUANTITY_TRACKED" })
      )
    ).catch((cause: { additionalData: { rowErrors: unknown[] } }) => {
      expect(cause.additionalData.rowErrors).toHaveLength(100);
    });
  });

  it("numbers the reported rows as spreadsheet lines", async () => {
    await expect(
      runImport([row(), row({ title: "bad", type: "QUANTITY_TRACKED" })])
    ).rejects.toMatchObject({
      additionalData: { rowErrors: [expect.objectContaining({ row: 3 })] },
    });
  });

  it("refuses a barcode file when the workspace may not use barcodes", async () => {
    await expect(
      runImport([row({ barcode_Code128: "CAM00001" })])
    ).rejects.toMatchObject({
      status: 403,
      message:
        "Your workspace doesn't have barcodes enabled. Please contact sales to learn more about barcodes.",
    });

    expect(assetCreate).not.toHaveBeenCalled();
    expect(createKitsIfNotExists).not.toHaveBeenCalled();
  });

  it("lets a clean file through to the writers", async () => {
    // Guards the opposite failure: a pre-flight that rejects a file the
    // importer would have accepted is worse than the abort it replaces.
    // The run is allowed to fail further in — only the boundary matters here.
    await runImport([row({ category: "Lighting" })]).catch(() => undefined);

    expect(parseQrCodesFromImportData).toHaveBeenCalled();
    expect(createCategoriesIfNotExists).toHaveBeenCalled();
  });
});

describe("createAssetsFromContentImport model defaults", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("fills a row's empty cells from the model it joins, and a file value wins", async () => {
    createAssetModelsIfNotExists.mockResolvedValueOnce({
      "Westermo L210": "model-1",
    });
    createCustomFieldsIfNotExists.mockResolvedValueOnce({
      customFields: {
        Brand: { id: "brand", name: "Brand", type: "TEXT" },
        Firmware: { id: "firmware", name: "Firmware", type: "TEXT" },
      },
    });
    getAssetModelsDefaults.mockResolvedValueOnce(
      new Map([
        [
          "model-1",
          {
            id: "model-1",
            name: "Westermo L210",
            defaultCategoryId: null,
            defaultValuation: 450,
            customFieldDefaults: ["brand", "firmware"].map((fieldId) => ({
              customFieldId: fieldId,
              value: { raw: fieldId === "brand" ? "Westermo" : "v2" },
              customField: {
                id: fieldId,
                name: fieldId,
                type: "TEXT",
                active: true,
                deletedAt: null,
                options: [],
                categories: [],
              },
            })),
          },
        ],
      ])
    );

    await runImport([
      row({
        assetModel: "Westermo L210",
        valuation: "",
        "cf:Brand": "Siemens",
        "cf:Firmware": "",
      }),
    ]);

    expect(getAssetModelsDefaults).toHaveBeenCalledWith({
      assetModelIds: ["model-1"],
      organizationId: "org-1",
    });
    expect(assetCreate).toHaveBeenCalledTimes(1);
    const { data } = assetCreate.mock.calls[0][0];
    expect(data.valuation).toBe(450);
    expect(data.customFields.create).toEqual([
      {
        customFieldId: "brand",
        value: expect.objectContaining({ raw: "Siemens" }),
      },
      { customFieldId: "firmware", value: { raw: "v2" } },
    ]);
  });
});
