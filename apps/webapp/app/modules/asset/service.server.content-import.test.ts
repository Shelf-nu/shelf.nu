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

// why: the importer reads the workspace's existing custom fields to detect a
// header whose declared type contradicts one. Everything else on `db` is here
// so the module graph loads.
vitest.mock("~/database/db.server", () => ({
  db: {
    customField: { findMany: vitest.fn().mockResolvedValue([]) },
    asset: { create: assetCreate, findFirst: vitest.fn() },
    $transaction: vitest
      .fn()
      .mockImplementation((cb: unknown) =>
        typeof cb === "function" ? (cb as (tx: unknown) => unknown)({}) : null
      ),
  },
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

describe("createAssetsFromContentImport — pre-flight write boundary", () => {
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

  it("numbers the reported rows as spreadsheet lines", async () => {
    await expect(
      runImport([row(), row({ title: "bad", type: "QUANTITY_TRACKED" })])
    ).rejects.toMatchObject({
      additionalData: { rowErrors: [expect.objectContaining({ row: 3 })] },
    });
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
