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
import {
  batchResolveAssetModelNames,
  fetchAssetsForUpdate,
} from "./import-update-entities.server";

// why: the resolver issues raw Prisma calls — we stub them so we can assert
// the dedupe / create-missing / re-fetch shape without a real DB.
vitest.mock("~/database/db.server", () => ({
  db: {
    assetModel: {
      findMany: vitest.fn(),
      create: vitest.fn(),
    },
    asset: {
      findMany: vitest.fn(),
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

/**
 * @description Org-scoping regression guard for `fetchAssetsForUpdate`.
 *
 * This is a LOCK, not a fix — `fetchAssetsForUpdate` already scopes its
 * query with `where: { [dbField]: { in: identifierValues }, organizationId }`.
 * It's pinned here because the import-ready export now emits a first-class
 * `id` column (Task 1), which means CSV-supplied asset ids are user input
 * on a multi-tenant system: an attacker in Org A could otherwise supply
 * Org B's ids and have them silently resolve. See
 * .claude/rules/org-scope-user-supplied-ids.md.
 */
describe("fetchAssetsForUpdate — org scoping (lock, not a fix)", () => {
  // Minimal shape fetchAssetsForUpdate needs from `db.asset.findMany`:
  // the relations it destructures (category, assetLocations, tags,
  // customFields) plus the two identifier fields it can be queried by.
  const orgAAsset = {
    id: "asset-org-a",
    sequentialId: "SAM-0001",
    organizationId: "org-a",
    title: "Org A Laptop",
    category: null,
    assetLocations: [],
    tags: [],
    customFields: [],
  };
  const orgBAsset = {
    id: "asset-org-b",
    // Same sequentialId as the Org A asset — a realistic collision since
    // sequential ids are only unique per-organization.
    sequentialId: "SAM-0001",
    organizationId: "org-b",
    title: "Org B Laptop",
    category: null,
    assetLocations: [],
    tags: [],
    customFields: [],
  };
  const allAssets = [orgAAsset, orgBAsset];

  beforeEach(() => {
    // why: simulates Postgres WHERE filtering (identifier-in-list AND
    // organizationId equality) so the test exercises the same scoping
    // logic a real query would enforce, without spinning up a live DB.
    vi.mocked(db.asset.findMany).mockImplementation(((args: {
      where: {
        organizationId: string;
        id?: { in: string[] };
        sequentialId?: { in: string[] };
      };
    }) => {
      const { where } = args;
      const dbField: "id" | "sequentialId" = where.id ? "id" : "sequentialId";
      const idsIn = where[dbField]?.in ?? [];
      return Promise.resolve(
        allAssets.filter(
          (a) =>
            idsIn.includes(a[dbField] ?? "") &&
            a.organizationId === where.organizationId
        )
      );
    }) as unknown as typeof db.asset.findMany);
  });

  it("does not resolve an id that belongs to a different organization", async () => {
    // Org A queries by an id (and, separately, a sequentialId) that only
    // exists under Org B — neither must resolve.
    const byId = await fetchAssetsForUpdate(["asset-org-b"], "org-a", "id");
    expect(byId.size).toBe(0);

    const bySequentialId = await fetchAssetsForUpdate(
      ["SAM-0001"],
      "org-a",
      "sequentialId"
    );
    // Org A's OWN "SAM-0001" resolves; Org B's same-looking id does not
    // leak in — the map has exactly the one asset scoped to Org A.
    expect(bySequentialId.size).toBe(1);
    expect(bySequentialId.get("SAM-0001")?.id).toBe("asset-org-a");
  });

  it("resolves an asset id correctly scoped to the requesting organization", async () => {
    const result = await fetchAssetsForUpdate(["asset-org-a"], "org-a", "id");
    expect(result.size).toBe(1);
    expect(result.get("asset-org-a")?.id).toBe("asset-org-a");
  });
});

/**
 * @description Regression guards for the two round-trip bugs fixed
 * alongside this suite:
 *  - Bug 1 (assetModel phantom change): the diff needs the AssetModel
 *    relation's NAME, not just its cuid, to compare against the CSV cell.
 *  - Bug 2 (multi-placement location collapse): the diff needs to know
 *    HOW MANY AssetLocation rows an asset has, and the "primary" one must
 *    be picked deterministically (oldest first), not by arbitrary
 *    unordered Prisma result order.
 */
describe("fetchAssetsForUpdate — assetModel + locationPlacementCount (Bug 1 / Bug 2 support)", () => {
  it("surfaces the assetModel relation and computes locationPlacementCount from assetLocations.length", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      {
        id: "asset-1",
        sequentialId: "SAM-0001",
        organizationId: "org-1",
        title: "Gloves",
        category: null,
        assetLocations: [
          { location: { id: "loc-a", name: "Christmas Event" } },
          { location: { id: "loc-b", name: "Mithril Dragons" } },
          { location: { id: "loc-c", name: "God Wars Dungeon" } },
        ],
        tags: [],
        customFields: [],
        assetModel: { id: "model-1", name: "MacBook pro 2022" },
      },
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const result = await fetchAssetsForUpdate(
      ["SAM-0001"],
      "org-1",
      "sequentialId"
    );

    const asset = result.get("SAM-0001");
    expect(asset?.locationPlacementCount).toBe(3);
    expect(asset?.assetModel).toEqual({
      id: "model-1",
      name: "MacBook pro 2022",
    });
  });

  it("queries with the assetModel relation included and assetLocations ordered deterministically (oldest first)", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce(
      [] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>
    );

    await fetchAssetsForUpdate(["SAM-0001"], "org-1", "sequentialId");

    const callArg = vi.mocked(db.asset.findMany).mock.calls.at(-1)?.[0] as {
      include?: {
        assetModel?: unknown;
        assetLocations?: { orderBy?: unknown };
      };
    };
    expect(callArg?.include?.assetModel).toEqual({
      select: { id: true, name: true },
    });
    expect(callArg?.include?.assetLocations?.orderBy).toEqual({
      createdAt: "asc",
    });
  });

  it("computes locationPlacementCount as 1 for a single-placement asset (regression guard)", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      {
        id: "asset-2",
        sequentialId: "SAM-0002",
        organizationId: "org-1",
        title: "Laptop",
        category: null,
        assetLocations: [{ location: { id: "loc-a", name: "Office A" } }],
        tags: [],
        customFields: [],
        assetModel: null,
      },
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const result = await fetchAssetsForUpdate(
      ["SAM-0002"],
      "org-1",
      "sequentialId"
    );

    expect(result.get("SAM-0002")?.locationPlacementCount).toBe(1);
  });
});
