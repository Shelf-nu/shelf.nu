/**
 * @file Tests for the batch entity resolvers used by the bulk-update-from-CSV
 * import path. Covers `batchResolveAssetModelNames()` — the Wave-1 sibling of
 * `batchResolveCategoryNames()` — which looks up AssetModel names (case-
 * insensitive) and creates any that are missing in one bounded pass.
 *
 * The resolver is the canonical "no N+1" pattern for the update import:
 *  - dedupe by case-folded key
 *  - findMany existing rows in a single query
 *  - per-row `db.assetModel.create()` for missing rows (the schema uses
 *    nested-relation FKs which `createMany` does not support)
 *  - return a Map keyed by the ORIGINAL spelling so the caller can patch
 *    each asset row's lookup key.
 *
 * @see {@link file://./import-update-entities.server.ts}
 */
import { describe, expect, it, vi, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import { batchResolveAssetModelNames } from "./import-update-entities.server";

// why: the resolver issues raw Prisma calls — we stub them so we can assert
// the dedupe / create-missing / re-fetch shape without a real DB.
vitest.mock("~/database/db.server", () => ({
  db: {
    assetModel: {
      findMany: vitest.fn(),
      create: vitest.fn(),
    },
  },
}));

describe("batchResolveAssetModelNames", () => {
  const userId = "user-1";
  const organizationId = "org-1";

  beforeEach(() => {
    vi.mocked(db.assetModel.findMany).mockReset();
    vi.mocked(db.assetModel.create).mockReset();
  });

  it("returns an empty map when given no names", async () => {
    const result = await batchResolveAssetModelNames(
      [],
      userId,
      organizationId
    );
    expect(result.size).toBe(0);
    expect(db.assetModel.findMany).not.toHaveBeenCalled();
    expect(db.assetModel.create).not.toHaveBeenCalled();
  });

  it("resolves existing models case-insensitively without creating", async () => {
    // Note the case mismatch — input is "dell latitude" but DB has
    // "Dell Latitude". The findMany result wins; we keep the original
    // spelling as the map key per the resolver's contract.
    vi.mocked(db.assetModel.findMany).mockResolvedValueOnce([
      { id: "model-1", name: "Dell Latitude" },
    ] as Awaited<ReturnType<typeof db.assetModel.findMany>>);

    const result = await batchResolveAssetModelNames(
      ["dell latitude"],
      userId,
      organizationId
    );

    expect(result.get("dell latitude")).toBe("model-1");
    expect(db.assetModel.create).not.toHaveBeenCalled();
  });

  it("creates missing models with userId + organizationId via nested connect", async () => {
    // No existing model — findMany returns []. The resolver must create
    // one row per missing name with `createdBy` + `organization` nested
    // connects (not flat FK fields).
    vi.mocked(db.assetModel.findMany).mockResolvedValueOnce(
      [] as Awaited<ReturnType<typeof db.assetModel.findMany>>
    );
    vi.mocked(db.assetModel.create).mockResolvedValueOnce({
      id: "model-new",
      name: "Brand New Model",
    } as Awaited<ReturnType<typeof db.assetModel.create>>);

    const result = await batchResolveAssetModelNames(
      ["Brand New Model"],
      userId,
      organizationId
    );

    expect(result.get("Brand New Model")).toBe("model-new");
    expect(db.assetModel.create).toHaveBeenCalledTimes(1);
    expect(db.assetModel.create).toHaveBeenCalledWith({
      data: {
        name: "Brand New Model",
        createdBy: { connect: { id: userId } },
        organization: { connect: { id: organizationId } },
      },
      select: { id: true, name: true },
    });
  });

  it("dedupes case-variant inputs and only creates / queries each name once", async () => {
    // Three spellings of the same model. The resolver should de-dupe to
    // one unique name in the findMany call and one create call.
    vi.mocked(db.assetModel.findMany).mockResolvedValueOnce(
      [] as Awaited<ReturnType<typeof db.assetModel.findMany>>
    );
    vi.mocked(db.assetModel.create).mockResolvedValueOnce({
      id: "model-x",
      name: "MacBook Pro",
    } as Awaited<ReturnType<typeof db.assetModel.create>>);

    const result = await batchResolveAssetModelNames(
      ["MacBook Pro", "macbook pro", "MACBOOK PRO"],
      userId,
      organizationId
    );

    // findMany received unique deduped list — first spelling wins
    expect(db.assetModel.findMany).toHaveBeenCalledTimes(1);
    const findManyArg = vi.mocked(db.assetModel.findMany).mock.calls[0][0];
    expect(findManyArg?.where?.name).toEqual({
      in: ["MacBook Pro"],
      mode: "insensitive",
    });

    // Create called exactly once for the deduped name
    expect(db.assetModel.create).toHaveBeenCalledTimes(1);

    // Result map carries ALL three original spellings, each pointing at
    // the same resolved id.
    expect(result.get("MacBook Pro")).toBe("model-x");
    expect(result.get("macbook pro")).toBe("model-x");
    expect(result.get("MACBOOK PRO")).toBe("model-x");
  });

  it("returns a Map keyed by the original input spellings even when DB casing differs", async () => {
    // Two names in the input — one matches an existing row (different case),
    // the other needs to be created. The map keys must mirror the original
    // input spellings so the caller can look up each row by what was in
    // the CSV.
    vi.mocked(db.assetModel.findMany).mockResolvedValueOnce([
      { id: "existing-1", name: "Dell Latitude" },
    ] as Awaited<ReturnType<typeof db.assetModel.findMany>>);
    vi.mocked(db.assetModel.create).mockResolvedValueOnce({
      id: "new-1",
      name: "ThinkPad X1",
    } as Awaited<ReturnType<typeof db.assetModel.create>>);

    const result = await batchResolveAssetModelNames(
      ["DELL LATITUDE", "ThinkPad X1"],
      userId,
      organizationId
    );

    expect(result.get("DELL LATITUDE")).toBe("existing-1");
    expect(result.get("ThinkPad X1")).toBe("new-1");
  });

  it("ignores blank / whitespace-only names", async () => {
    vi.mocked(db.assetModel.findMany).mockResolvedValueOnce(
      [] as Awaited<ReturnType<typeof db.assetModel.findMany>>
    );

    const result = await batchResolveAssetModelNames(
      ["   ", ""],
      userId,
      organizationId
    );

    expect(result.size).toBe(0);
    // No DB calls needed when only blanks were supplied.
    expect(db.assetModel.findMany).not.toHaveBeenCalled();
    expect(db.assetModel.create).not.toHaveBeenCalled();
  });
});
