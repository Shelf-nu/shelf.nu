/**
 * @file End-to-end coverage for `applyBulkUpdatesFromImport` — the Wave-1
 * apply layer for the qty-tracked + AssetModel update import.
 *
 * Mocks the database client + the `updateAsset` / `updateAssetBookingAvailability`
 * service exits so we can drive deterministic CSV scenarios and assert the
 * resulting `BulkUpdateResult` summary, warnings, and failed lists.
 *
 * Coverage focuses on the decisions resolved 2026-06-16:
 *  1. `type` cell silently ignored on update
 *  2. qty-tracked cells on INDIVIDUAL rows silently dropped
 *  3. `assetModel` cell on QUANTITY_TRACKED row → warning + drop, row still applies
 *  4. invalid qty / consumptionType → row goes into `failed`
 *
 * @see {@link file://./import-update.server.ts}
 */
import { AssetType, ConsumptionType } from "@prisma/client";
import { describe, expect, it, vi, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import { updateAsset } from "~/modules/asset/service.server";
import { applyBulkUpdatesFromImport } from "./import-update.server";

// why: we drive the apply path end-to-end. The real DB + the real `updateAsset`
// would require a fully migrated test DB; mocking lets us assert behaviour
// (warnings, failed rows, updated counts) declaratively per CSV scenario.
vitest.mock("~/database/db.server", () => ({
  db: {
    customField: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    asset: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    tag: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    category: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    location: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    assetModel: {
      findMany: vitest.fn().mockResolvedValue([]),
      create: vitest.fn(),
    },
  },
}));

// why: `updateAsset` is the service-layer write — we don't need to execute
// it (its DB writes + activity events are tested in the asset service suite).
// Stubbing it lets us assert the apply path's orchestration without running
// the full write stack.
vitest.mock("~/modules/asset/service.server", () => ({
  updateAsset: vitest.fn().mockResolvedValue({ id: "uuid" }),
  updateAssetBookingAvailability: vitest.fn().mockResolvedValue({ id: "uuid" }),
}));

// why: `getPrimaryLocation` is used by `fetchAssetsForUpdate` to synthesize
// the singular `location` shape the diff code expects. The default impl
// reads `assetLocations[0]` — we don't need its real behaviour here.
vitest.mock("~/modules/asset/utils", () => ({
  getPrimaryLocation: vitest.fn().mockReturnValue(null),
}));

const organizationId = "org-1";
const userId = "user-1";
const request = new Request("http://localhost/");

/**
 * Builds a minimal asset row matching the shape returned by Prisma in
 * `fetchAssetsForUpdate` (with the `assetLocations` pivot + flat scalars
 * + relation `select` columns). The defaults here keep test rows simple
 * — overrides specialise per case.
 */
function makeDbAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: "uuid-1",
    title: "Test Asset",
    sequentialId: "SAM-0001",
    valuation: null,
    availableToBook: true,
    type: AssetType.INDIVIDUAL,
    quantity: null,
    minQuantity: null,
    unitOfMeasure: null,
    consumptionType: null,
    assetModelId: null,
    category: null,
    assetLocations: [],
    tags: [],
    customFields: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // why: the apply path fetches CustomFields, then assets, then runs DB
  // updates. We reset to safe defaults that the per-test setup overrides.
  vi.mocked(db.customField.findMany).mockResolvedValue([]);
  vi.mocked(db.asset.findMany).mockResolvedValue([]);
  vi.mocked(db.tag.findMany).mockResolvedValue([]);
  vi.mocked(db.category.findMany).mockResolvedValue([]);
  vi.mocked(db.location.findMany).mockResolvedValue([]);
  vi.mocked(db.assetModel.findMany).mockResolvedValue([]);
  vi.mocked(updateAsset).mockResolvedValue({ id: "uuid-1" } as Awaited<
    ReturnType<typeof updateAsset>
  >);
});

describe("applyBulkUpdatesFromImport — qty-tracked + AssetModel", () => {
  it("updates quantity on a QUANTITY_TRACKED asset", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-q",
        sequentialId: "SAM-Q1",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 10,
        consumptionType: ConsumptionType.ONE_WAY,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Quantity"],
      ["SAM-Q1", "42"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.updated).toBe(1);
    expect(result.summary.failed).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(updateAsset).toHaveBeenCalledTimes(1);
    // The qty value flows through to the service-layer payload.
    expect(vi.mocked(updateAsset).mock.calls[0][0]).toMatchObject({
      id: "uuid-q",
      quantity: 42,
    });
  });

  it("resolves and links an existing AssetModel on an INDIVIDUAL asset", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-i",
        sequentialId: "SAM-I1",
        type: AssetType.INDIVIDUAL,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    // Model already exists — resolver finds it via findMany, no create call.
    vi.mocked(db.assetModel.findMany).mockResolvedValueOnce([
      { id: "model-existing", name: "Dell Latitude" },
    ] as unknown as Awaited<ReturnType<typeof db.assetModel.findMany>>);

    const csvData = [
      ["Asset ID", "Asset model"],
      ["SAM-I1", "Dell Latitude"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.updated).toBe(1);
    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "uuid-i",
        assetModelId: "model-existing",
      })
    );
  });

  it("creates a missing AssetModel on an INDIVIDUAL asset", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-i",
        sequentialId: "SAM-I1",
        type: AssetType.INDIVIDUAL,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);
    // No existing models → resolver falls into the per-name `create()` branch.
    vi.mocked(db.assetModel.findMany).mockResolvedValueOnce(
      [] as unknown as Awaited<ReturnType<typeof db.assetModel.findMany>>
    );
    vi.mocked(db.assetModel.create).mockResolvedValueOnce({
      id: "model-new",
      name: "Brand New Model",
    } as Awaited<ReturnType<typeof db.assetModel.create>>);

    const csvData = [
      ["Asset ID", "Asset model"],
      ["SAM-I1", "Brand New Model"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.updated).toBe(1);
    expect(db.assetModel.create).toHaveBeenCalledTimes(1);
    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({ assetModelId: "model-new" })
    );
  });

  it("warns + skips assetModel on a QUANTITY_TRACKED row, other cells still apply", async () => {
    // QUANTITY_TRACKED existing asset. Row carries BOTH `Asset model` (warned
    // + dropped) AND `Quantity` (applied). The row should land in `updated`
    // because Quantity flows through; warnings should have one entry.
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-q",
        sequentialId: "SAM-Q1",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 10,
        consumptionType: ConsumptionType.ONE_WAY,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Quantity", "Asset model"],
      ["SAM-Q1", "20", "Dell Latitude"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.updated).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      id: "SAM-Q1",
      // Warning now comes from the diff layer (single source of truth);
      // the message is prefixed with the display label "Asset model: "
      // not the camelCase internal key. See `compareCoreField` case
      // "assetModel" in `import-update-diff.ts`.
      message: expect.stringMatching(/asset model/i),
    });
    // The model name was NOT pushed to the batch resolver — no findMany +
    // no create on assetModel.
    expect(db.assetModel.findMany).not.toHaveBeenCalled();
    expect(db.assetModel.create).not.toHaveBeenCalled();
    // Quantity still applies.
    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 20 })
    );
  });

  it("silently ignores a divergent `type` cell — no warning, no failure", async () => {
    // Asset is INDIVIDUAL; CSV says QUANTITY_TRACKED. Per decision #1 this
    // is a silent no-op (analyzeUpdateHeaders strips `type` because it
    // isn't in UPDATABLE_FIELDS). We add a Name change so the row still
    // produces an update.
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-i",
        sequentialId: "SAM-I1",
        type: AssetType.INDIVIDUAL,
        title: "Old Name",
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Type", "Name"],
      ["SAM-I1", "QUANTITY_TRACKED", "New Name"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.failed).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.summary.updated).toBe(1);
    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Name" })
    );
    // No type was passed through.
    const callArg = vi.mocked(updateAsset).mock
      .calls[0][0] as unknown as Record<string, unknown>;
    expect(callArg.type).toBeUndefined();
  });

  it("silently drops qty-tracked cells on an INDIVIDUAL row (decision #2)", async () => {
    // INDIVIDUAL asset; CSV carries qty-tracked cells. Per decision #2,
    // these are silently dropped — no warning, no failure. With ONLY
    // qty-tracked cells in the row the result should be "skipped" (no
    // changes detected by the diff layer for INDIVIDUAL).
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-i",
        sequentialId: "SAM-I1",
        type: AssetType.INDIVIDUAL,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Quantity", "Min quantity", "Consumption type"],
      ["SAM-I1", "5", "1", "ONE_WAY"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.failed).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.summary.updated).toBe(0);
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("fails the row when QUANTITY_TRACKED quantity cell is invalid", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-q",
        sequentialId: "SAM-Q1",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 10,
        consumptionType: ConsumptionType.ONE_WAY,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Quantity"],
      ["SAM-Q1", "not-a-number"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.failed).toBeGreaterThanOrEqual(1);
    // The failure carries the asset id + a quantity-related error message.
    const qtyFailure = result.failed.find((f) => f.id === "SAM-Q1");
    expect(qtyFailure).toBeDefined();
    expect(qtyFailure?.error.toLowerCase()).toMatch(/quantity/);
  });

  it("multi-row mix: some succeed, some warn, some fail", async () => {
    // 3 rows:
    //  1. SAM-Q1 (QUANTITY_TRACKED) — quantity changes, succeeds → updated
    //  2. SAM-Q2 (QUANTITY_TRACKED) — Name + assetModel cell. Name applies
    //     (lands in `updated`); the assetModel cell is warn + dropped per
    //     decision #3 and surfaces in `result.warnings`.
    //  3. SAM-Q3 (QUANTITY_TRACKED) — invalid quantity → fails
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-q1",
        sequentialId: "SAM-Q1",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 5,
        consumptionType: ConsumptionType.ONE_WAY,
        title: "Q1",
      }),
      makeDbAsset({
        id: "uuid-q2",
        sequentialId: "SAM-Q2",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 10,
        consumptionType: ConsumptionType.ONE_WAY,
        title: "Q2-old",
      }),
      makeDbAsset({
        id: "uuid-q3",
        sequentialId: "SAM-Q3",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 15,
        consumptionType: ConsumptionType.ONE_WAY,
        title: "Q3",
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Name", "Quantity", "Asset model"],
      ["SAM-Q1", "Q1", "20", ""],
      ["SAM-Q2", "Q2-new", "10", "Dell Latitude"],
      ["SAM-Q3", "Q3", "bad", ""],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    // SAM-Q1 should be in updated.
    expect(result.updated.find((u) => u.id === "SAM-Q1")).toBeDefined();
    // SAM-Q2 should have produced a warning (assetModel on QUANTITY_TRACKED).
    // Warning message now uses the display label "Asset model" — see
    // diff-layer source-of-truth note above.
    expect(
      result.warnings.find(
        (w) => w.id === "SAM-Q2" && /asset model/i.test(w.message)
      )
    ).toBeDefined();
    // SAM-Q3 should be in failed.
    expect(result.failed.find((f) => f.id === "SAM-Q3")).toBeDefined();
  });

  it("surfaces a warning when an update row carries ONLY an assetModel cell on a QUANTITY_TRACKED asset (single-cell edge)", async () => {
    // Regression guard for the 2026-06-17 fix. Before this, a row with
    // no other updatable cells AND an assetModel value on a qty-tracked
    // asset landed in `skipped` with the generic "No changes detected"
    // reason — hiding from the user that their intent didn't take
    // effect. The diff layer now emits a warning-marked FieldChange so
    // the row reaches the apply loop and the warning flows into
    // `result.warnings`. No write happens against `updateAsset` (the
    // field's `.warning` short-circuits it) and the assetModel resolver
    // is never invoked.
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-q-only",
        sequentialId: "SAM-QONLY",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 10,
        consumptionType: ConsumptionType.ONE_WAY,
        title: "Q-only",
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Asset model"],
      ["SAM-QONLY", "Dell Latitude"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    // Exactly one warning, pointing at the right row + naming the cell.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      id: "SAM-QONLY",
      message: expect.stringMatching(/asset model/i),
    });
    // No write attempted.
    expect(updateAsset).not.toHaveBeenCalled();
    expect(db.assetModel.findMany).not.toHaveBeenCalled();
    expect(db.assetModel.create).not.toHaveBeenCalled();
    // Row goes into the all-warnings-skipped branch, NOT updated.
    expect(result.summary.updated).toBe(0);
  });
});
