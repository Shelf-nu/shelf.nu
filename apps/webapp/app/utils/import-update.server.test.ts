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
import {
  applyBulkUpdatesFromImport,
  buildUpdatePreview,
} from "./import-update.server";

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

  it("zero-edit round trip: an assetModel cell matching the current model's name produces no change (Bug 1 fix)", async () => {
    // Regression guard: the diff previously compared the CSV cell (a model
    // NAME, per the export) against `assetModelId` (a cuid) — the two can
    // never be string-equal, so this row would have falsely reported a
    // change. With the fix, `db.asset.findMany` returns the `assetModel`
    // relation (name), and the diff compares name-to-name.
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-i",
        sequentialId: "SAM-I1",
        type: AssetType.INDIVIDUAL,
        assetModelId: "model-1",
        assetModel: { id: "model-1", name: "MacBook pro 2022" },
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Asset model"],
      ["SAM-I1", "MacBook pro 2022"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.updated).toBe(0);
    expect(result.summary.skipped).toBe(1);
    expect(updateAsset).not.toHaveBeenCalled();
    expect(db.assetModel.findMany).not.toHaveBeenCalled();
    expect(db.assetModel.create).not.toHaveBeenCalled();
  });

  it("is a case-insensitive no-op, matching batchResolveAssetModelNames's own resolution (Bug 1 fix)", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-i",
        sequentialId: "SAM-I1",
        type: AssetType.INDIVIDUAL,
        assetModelId: "model-1",
        assetModel: { id: "model-1", name: "MacBook pro 2022" },
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Asset model"],
      ["SAM-I1", "macbook PRO 2022"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.updated).toBe(0);
    expect(updateAsset).not.toHaveBeenCalled();
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

describe("applyBulkUpdatesFromImport — multi-placement location guard (Bug 2 fix)", () => {
  // Reproduces the "Gloves" scenario: a QUANTITY_TRACKED asset with units
  // split across three AssetLocation rows. The placement NAMES matter as
  // well as the count — `fetchAssetsForUpdate` derives
  // `locationPlacementNames` from them, and the guard suppresses its warning
  // for a cell naming any location the asset already has units at.
  const threePlacements = [
    { location: { id: "loc-1", name: "Christmas Event" } },
    { location: { id: "loc-2", name: "Mithril Dragons" } },
    { location: { id: "loc-3", name: "God Wars Dungeon" } },
  ];

  it("warns and skips a location cell naming a different location — never calls updateAsset", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-gloves",
        sequentialId: "SAM-GLOVES",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 910,
        assetLocations: threePlacements,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Location"],
      ["SAM-GLOVES", "Somewhere Else"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      id: "SAM-GLOVES",
      message: expect.stringMatching(/multiple locations/i),
    });
    expect(updateAsset).not.toHaveBeenCalled();
    // The bogus "different location" name must never reach the entity
    // resolver — it's not actually being applied.
    expect(db.location.findMany).not.toHaveBeenCalled();
  });

  it("warns and skips an EMPTY location cell — never wipes placements", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-gloves",
        sequentialId: "SAM-GLOVES",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 910,
        assetLocations: threePlacements,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Location"],
      ["SAM-GLOVES", ""],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toMatch(/multiple locations/i);
    // Critically: no call ever carries `newLocationId: null` for this asset.
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("still applies a location change normally for a single-placement asset (regression guard)", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-single",
        sequentialId: "SAM-SINGLE",
        assetLocations: [{ location: { id: "loc-1", name: "Party Drop" } }],
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);
    vi.mocked(db.location.findMany).mockResolvedValueOnce([
      { id: "loc-warehouse", name: "Warehouse" },
    ] as unknown as Awaited<ReturnType<typeof db.location.findMany>>);

    const csvData = [
      ["Asset ID", "Location"],
      ["SAM-SINGLE", "Warehouse"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.warnings).toEqual([]);
    expect(result.summary.updated).toBe(1);
    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({ newLocationId: "loc-warehouse" })
    );
  });
});

describe("applyBulkUpdatesFromImport — custom field clearing (SHELF-WEBAPP-21W)", () => {
  it("clears a custom field by emitting `undefined`, never a `{ raw: '' }` value", async () => {
    // why: give the org one TEXT custom field ("Notes") so the "Notes" CSV
    // header resolves to a customField column instead of being ignored.
    vi.mocked(db.customField.findMany).mockResolvedValue([
      {
        id: "cf-notes",
        name: "Notes",
        type: "TEXT",
        helpText: null,
        required: false,
        active: true,
        organizationId,
        categoryId: null,
        options: [],
        deletedAt: null,
      },
    ] as unknown as Awaited<ReturnType<typeof db.customField.findMany>>);

    // why: the asset must already HAVE a "Notes" value so a blank cell is
    // detected as a clear (detectClearing only fires on an existing non-empty
    // value) — that's the branch that produced the invalid write.
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        customFields: [
          {
            customField: { id: "cf-notes", name: "Notes" },
            value: { raw: "old note" },
          },
        ],
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Notes"],
      ["SAM-0001", ""], // blank cell → clear the existing value
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    // Previously this row 500'd on the `ensure_value_structure_and_types`
    // CHECK and landed in `failed`; now it applies as an update.
    expect(result.summary.failed).toBe(0);
    expect(result.summary.updated).toBe(1);
    expect(updateAsset).toHaveBeenCalledTimes(1);

    // The clearing signal must reach updateAsset as `undefined` (→ deleteMany),
    // NOT the invalid `{ raw: "" }` shape that violated the CHECK constraint.
    const payload = vi.mocked(updateAsset).mock.calls[0][0];
    expect(payload.customFieldsValues).toHaveLength(1);
    expect(payload.customFieldsValues?.[0]?.id).toBe("cf-notes");
    expect(payload.customFieldsValues?.[0]?.value).toBeUndefined();
    expect(JSON.stringify(payload.customFieldsValues)).not.toContain(
      '"raw":""'
    );
  });
});

describe("applyBulkUpdatesFromImport — description (Task 2 fix round 1)", () => {
  it("updates description via either vocabulary header ('Description' / 'description')", async () => {
    for (const header of ["Description", "description"]) {
      vi.clearAllMocks();
      vi.mocked(db.customField.findMany).mockResolvedValue([]);
      vi.mocked(db.tag.findMany).mockResolvedValue([]);
      vi.mocked(db.category.findMany).mockResolvedValue([]);
      vi.mocked(db.location.findMany).mockResolvedValue([]);
      vi.mocked(db.assetModel.findMany).mockResolvedValue([]);
      vi.mocked(updateAsset).mockResolvedValue({ id: "uuid-1" } as Awaited<
        ReturnType<typeof updateAsset>
      >);
      vi.mocked(db.asset.findMany).mockResolvedValueOnce([
        makeDbAsset({ description: "Old description" }),
      ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

      const csvData = [
        ["Asset ID", header],
        ["SAM-0001", "New description"],
      ];

      const result = await applyBulkUpdatesFromImport({
        csvData,
        organizationId,
        userId,
        request,
      });

      expect(result.summary.updated).toBe(1);
      expect(result.summary.failed).toBe(0);
      expect(updateAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "uuid-1",
          description: "New description",
        })
      );
    }
  });

  it("is a no-op when the description cell matches the current value", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({ description: "Same description" }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Description"],
      ["SAM-0001", "Same description"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.updated).toBe(0);
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("does not clear the description on an empty cell (matches 'name' semantics)", async () => {
    // Unlike category/location/tags/valuation, description is not
    // clearable via a blank cell — an empty cell is a no-op, same as
    // `name`. Pair the (no-op) description cell with a real Name change
    // (no entity resolution needed) so the row still reaches the apply
    // payload, and assert `description` is absent from it.
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        title: "Old Name",
        description: "Keep this description",
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const csvData = [
      ["Asset ID", "Description", "Name"],
      ["SAM-0001", "", "New Name"],
    ];

    const result = await applyBulkUpdatesFromImport({
      csvData,
      organizationId,
      userId,
      request,
    });

    expect(result.summary.updated).toBe(1);
    const payload = vi.mocked(updateAsset).mock.calls[0][0];
    expect(payload.title).toBe("New Name");
    expect(payload.description).toBeUndefined();
  });
});

describe("wrong-format detection — identifier found, zero updatable columns (Task 3 fix)", () => {
  // why: "Status" is a known-but-read-only field (lands in ignoredColumns)
  // and "Some Random Column" doesn't match any field or custom field (lands
  // in unrecognizedColumns) — combined, the identifier column resolves but
  // headerAnalysis.updatableColumns is empty. Before this fix both call
  // sites silently returned an empty preview / no-op apply instead of
  // explaining that the file has nothing this flow can write.
  const csvData = [
    ["Asset ID", "Status", "Some Random Column"],
    ["SAM-0001", "Available", "foo"],
  ];

  it("buildUpdatePreview throws a specific, actionable 400 instead of an empty preview", async () => {
    // why: user-input validation failures must be a 400, not the ShelfError
    // default of 500 — a wrong CSV upload is a client error, not a server
    // fault (see .claude/rules / reference_shelferror_user_input_400).
    await expect(
      buildUpdatePreview({ csvData, organizationId })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Import-ready"),
      status: 400,
      shouldBeCaptured: false,
    });
  });

  it("applyBulkUpdatesFromImport throws the same 400 (stateless re-parse guard)", async () => {
    await expect(
      applyBulkUpdatesFromImport({ csvData, organizationId, userId, request })
    ).rejects.toMatchObject({
      message: expect.stringContaining("Import-ready"),
      status: 400,
      shouldBeCaptured: false,
    });
  });

  it("does not throw when at least one column is updatable", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset(),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const validCsvData = [
      ["Asset ID", "Status", "Name"],
      ["SAM-0001", "Available", "New Name"],
    ];

    await expect(
      buildUpdatePreview({ csvData: validCsvData, organizationId })
    ).resolves.toMatchObject({ updatableColumns: ["Name"] });
  });
});

describe("wrong-format detection — no identifier column (status 400 fix round 1)", () => {
  // why: covers the OTHER half of the same "wrong file" story — no
  // Asset ID / ID / id column at all. Pre-existing behaviour (message only),
  // now also asserting `status: 400` since the fix-round-1 review found
  // these throws set `shouldBeCaptured: false` but omitted `status`, so
  // ShelfError's 500 default made a user-input error look like a server
  // fault.
  const csvData = [
    ["Name", "Category"],
    ["New Name", "Electronics"],
  ];

  it("buildUpdatePreview throws a 400 when no identifier column is present", async () => {
    await expect(
      buildUpdatePreview({ csvData, organizationId })
    ).rejects.toMatchObject({
      message: expect.stringContaining("No identifier column found"),
      status: 400,
      shouldBeCaptured: false,
    });
  });

  it("applyBulkUpdatesFromImport throws a 400 when no identifier column is present", async () => {
    await expect(
      applyBulkUpdatesFromImport({ csvData, organizationId, userId, request })
    ).rejects.toMatchObject({
      message: expect.stringContaining("No identifier column found"),
      status: 400,
      shouldBeCaptured: false,
    });
  });
});

describe("wrong-format detection — workspace backup export (final review fix)", () => {
  // why: before this branch, this file was already rejected — identifier
  // matching was case-sensitive, so the backup export's lowercase "id"
  // header never resolved. This branch's case-insensitive matching +
  // `sequentialId` alias means it now WOULD resolve, so without a dedicated
  // guard the backup file's JSON-blob `category`/`tags`/`assetModel` cells
  // would be proposed as literal new entities (a category named `{}`, etc).
  const backupCsvData = [
    [
      "id",
      "title",
      "description",
      "category",
      "tags",
      "assetModel",
      "assetLocations",
      "customFields",
      "notes",
      "createdAt",
      "updatedAt",
    ],
    [
      "uuid-1",
      "Laptop",
      "desc",
      "{}",
      "[]",
      "{}",
      "[]",
      "[]",
      "[]",
      "2024-01-01T00:00:00.000Z",
      "2024-01-01T00:00:00.000Z",
    ],
  ];

  it("buildUpdatePreview throws a specific, actionable 400 instead of proposing JSON entities", async () => {
    await expect(
      buildUpdatePreview({ csvData: backupCsvData, organizationId })
    ).rejects.toMatchObject({
      message: expect.stringContaining("workspace backup export"),
      status: 400,
      shouldBeCaptured: false,
    });
  });

  it("applyBulkUpdatesFromImport throws the same 400 (stateless re-parse guard)", async () => {
    await expect(
      applyBulkUpdatesFromImport({
        csvData: backupCsvData,
        organizationId,
        userId,
        request,
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining("workspace backup export"),
      status: 400,
      shouldBeCaptured: false,
    });
  });

  it("does not fire a false positive on a normal Import-ready export", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset(),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const importReadyCsvData = [
      ["id", "title", "description", "category"],
      ["uuid-1", "New Name", "New description", "Electronics"],
    ];

    await expect(
      buildUpdatePreview({ csvData: importReadyCsvData, organizationId })
    ).resolves.toMatchObject({
      updatableColumns: expect.arrayContaining(["title"]),
    });
  });
});

describe("preview counts exclude warning-marked changes", () => {
  // why: the apply layer skips any FieldChange carrying `.warning`, so
  // counting those toward `totalFieldChanges` promised writes that never
  // happen. Found in manual testing: a zero-edit round trip of a workspace
  // containing multi-location quantity-tracked assets rendered
  // "Apply 2 changes to 2 assets" when the real answer was zero.
  const threePlacements = [
    { location: { id: "loc-1", name: "Christmas Event" } },
    { location: { id: "loc-2", name: "Mithril Dragons" } },
    { location: { id: "loc-3", name: "God Wars Dungeon" } },
  ];

  it("reports 0 field changes when every change is warning-marked", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-gloves",
        sequentialId: "SAM-GLOVES",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 910,
        assetLocations: threePlacements,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const preview = await buildUpdatePreview({
      csvData: [
        ["Asset ID", "Location"],
        ["SAM-GLOVES", "Somewhere Else"],
      ],
      organizationId,
    });

    // The row still surfaces so the user can see what was flagged...
    expect(preview.assetsToUpdate).toHaveLength(1);
    expect(preview.assetsToUpdate[0].changes[0].warning).toMatch(
      /multiple locations/i
    );
    // ...but nothing is actually applicable.
    expect(preview.totalFieldChanges).toBe(0);
  });

  it("counts only the applicable change when warning and real changes mix", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-gloves",
        sequentialId: "SAM-GLOVES",
        title: "Old title",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 910,
        assetLocations: threePlacements,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);

    const preview = await buildUpdatePreview({
      csvData: [
        ["Asset ID", "Name", "Location"],
        ["SAM-GLOVES", "New title", "Somewhere Else"],
      ],
      organizationId,
    });

    // Two changes recorded (name + warning-marked location), one applicable.
    expect(preview.assetsToUpdate[0].changes).toHaveLength(2);
    expect(preview.totalFieldChanges).toBe(1);
  });
});

describe("multi-placement location guard — untouched round trip is a no-op", () => {
  // why: the guard originally fired on placement COUNT alone, so a zero-edit
  // re-upload reported every multi-location asset as "needs fixing" even
  // though its location cell was a faithful round trip. Matching against ALL
  // placement names (not just the primary) is what makes this reliable: the
  // export flattens N placements into one cell and can pick a different row
  // than `fetchAssetsForUpdate` does when placements share a `createdAt`.
  const threePlacements = [
    { location: { id: "loc-1", name: "Christmas Event" } },
    { location: { id: "loc-2", name: "Mithril Dragons" } },
    { location: { id: "loc-3", name: "God Wars Dungeon" } },
  ];

  function mockGloves() {
    vi.mocked(db.asset.findMany).mockResolvedValueOnce([
      makeDbAsset({
        id: "uuid-gloves",
        sequentialId: "SAM-GLOVES",
        type: AssetType.QUANTITY_TRACKED,
        quantity: 910,
        assetLocations: threePlacements,
      }),
    ] as unknown as Awaited<ReturnType<typeof db.asset.findMany>>);
  }

  it.each([
    ["the placement the export would call primary", "Christmas Event"],
    ["a non-primary placement (ordering disagreement)", "God Wars Dungeon"],
    ["a differently-cased placement name", "mithril dragons"],
  ])("no-ops when the cell names %s", async (_label, cell) => {
    mockGloves();

    const preview = await buildUpdatePreview({
      csvData: [
        ["Asset ID", "Location"],
        ["SAM-GLOVES", cell],
      ],
      organizationId,
    });

    // No FieldChange at all — not a warning, not a change.
    expect(preview.assetsToUpdate).toHaveLength(0);
    expect(preview.skippedAssets).toHaveLength(1);
    expect(preview.totalFieldChanges).toBe(0);
  });

  it("still warns when the cell names a location the asset is NOT at", async () => {
    mockGloves();

    const preview = await buildUpdatePreview({
      csvData: [
        ["Asset ID", "Location"],
        ["SAM-GLOVES", "Somewhere Else"],
      ],
      organizationId,
    });

    expect(preview.assetsToUpdate).toHaveLength(1);
    expect(preview.assetsToUpdate[0].changes[0].warning).toMatch(
      /multiple locations/i
    );
  });
});
