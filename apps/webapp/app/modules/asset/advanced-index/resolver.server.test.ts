// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Column } from "~/modules/asset-index-settings/helpers";
import {
  assembleHydratedAssets,
  createDeferredHydration,
  resolveHydrationPlan,
} from "./resolver.server";
import type { BatchKey, CriticalRow, ResolvedHydration } from "./types";

// why: isolates createDeferredHydration from the real batch fetchers — each
// test controls which BatchKey each mock stands in for, without a database.
const hydrateSimpleMock = vi.hoisted(() => ({
  fetchTagsBatch: vi.fn(async () => new Map()),
  fetchLocationsBatch: vi.fn(async () => new Map()),
  fetchKitsBatch: vi.fn(async () => new Map()),
  fetchCustomFieldsBatch: vi.fn(async () => new Map()),
  fetchRemindersBatch: vi.fn(async () => new Map()),
}));
vi.mock("./hydrate-simple.server", () => hydrateSimpleMock);

const hydrateHeavyMock = vi.hoisted(() => ({
  fetchCustodyBatch: vi.fn(async () => new Map()),
  fetchBookingsBatch: vi.fn(async () => new Map()),
  fetchBarcodesBatch: vi.fn(async () => new Map()),
}));
vi.mock("./hydrate-heavy.server", () => hydrateHeavyMock);

// why: replaces the real concurrency-limited withReadSlot with a passthrough
// that just invokes fn and records the metadata it was called with, so tests
// assert on the lane/batch/idCount contract without depending on the
// limiter's internal scheduling (covered separately by its own test file).
const withReadSlotMock = vi.hoisted(() =>
  // The second param (the slot options) is unused by this passthrough but must
  // be in the signature so the recorded call tuple has length 2 — tests read
  // the options back via `mock.calls[i][1]` to assert the lane/batch/idCount.
  vi.fn((fn: () => Promise<unknown>, _opts: unknown) => fn())
);
vi.mock("~/utils/read-batch-limiter.server", () => ({
  withReadSlot: withReadSlotMock,
}));

const ORG_ID = "org-1";
const VIEWER_SCOPE = { userId: "user-1", canSeeAllCustody: true };

/** Builds one column entry; individual tests override `visible`/`position`. */
function makeColumn(
  name: Column["name"],
  visible: boolean,
  position = 0
): Column {
  return { name, visible, position };
}

describe("resolveHydrationPlan", () => {
  it("requires only the batches the visible columns map to", () => {
    const { required } = resolveHydrationPlan({
      columns: [makeColumn("tags", true), makeColumn("kit", true)],
      isAvailabilityView: false,
      barcodesEnabled: false,
      activeCustomFields: [],
    });

    expect(required).toEqual(new Set<BatchKey>(["tags", "kits"]));
  });

  it("ignores invisible columns entirely", () => {
    const { required } = resolveHydrationPlan({
      columns: [
        makeColumn("tags", false),
        makeColumn("location", false),
        makeColumn("kit", true),
      ],
      isAvailabilityView: false,
      barcodesEnabled: false,
      activeCustomFields: [],
    });

    expect(required).toEqual(new Set<BatchKey>(["kits"]));
  });

  it("does not require barcodes for a visible barcode column when the org lacks the entitlement", () => {
    const { required } = resolveHydrationPlan({
      columns: [makeColumn("barcode_Code128", true)],
      isAvailabilityView: false,
      barcodesEnabled: false,
      activeCustomFields: [],
    });

    expect(required.has("barcodes")).toBe(false);
  });

  it("requires barcodes for a visible barcode column when the org has the entitlement", () => {
    const { required } = resolveHydrationPlan({
      columns: [makeColumn("barcode_EAN13", true)],
      isAvailabilityView: false,
      barcodesEnabled: true,
      activeCustomFields: [],
    });

    expect(required.has("barcodes")).toBe(true);
  });

  it("resolves a visible cf_<name> column to its active field's id", () => {
    const { required, cfFieldIds } = resolveHydrationPlan({
      columns: [makeColumn("cf_Condition", true)],
      isAvailabilityView: false,
      barcodesEnabled: false,
      activeCustomFields: [{ id: "field-condition", name: "Condition" }],
    });

    expect(required.has("customFields")).toBe(true);
    expect(cfFieldIds).toEqual(["field-condition"]);
  });

  it("skips a cf_<name> column whose name matches no active field, without crashing", () => {
    const { required, cfFieldIds } = resolveHydrationPlan({
      columns: [makeColumn("cf_Ghost", true)],
      isAvailabilityView: false,
      barcodesEnabled: false,
      activeCustomFields: [{ id: "field-condition", name: "Condition" }],
    });

    expect(required.has("customFields")).toBe(false);
    expect(cfFieldIds).toEqual([]);
  });
});

describe("createDeferredHydration", () => {
  it("returns a promise only for each required batch", () => {
    const sources = createDeferredHydration(
      ["asset-1"],
      {
        organizationId: ORG_ID,
        viewerScope: VIEWER_SCOPE,
        barcodesEnabled: true,
        required: new Set<BatchKey>(["tags", "kits"]),
        cfFieldIds: [],
        isAvailabilityView: false,
      },
      new AbortController().signal
    );

    expect(Object.keys(sources).sort()).toEqual(["kits", "tags"]);
    expect(sources.tags).toBeInstanceOf(Promise);
    expect(sources.kits).toBeInstanceOf(Promise);
  });

  it("drops bookings and barcodes from the deferred set in availability view, keeping the rest", () => {
    const sources = createDeferredHydration(
      ["asset-1"],
      {
        organizationId: ORG_ID,
        viewerScope: VIEWER_SCOPE,
        barcodesEnabled: true,
        required: new Set<BatchKey>(["tags", "bookings", "barcodes"]),
        cfFieldIds: [],
        isAvailabilityView: true,
      },
      new AbortController().signal
    );

    expect(Object.keys(sources)).toEqual(["tags"]);
    expect(sources.bookings).toBeUndefined();
    expect(sources.barcodes).toBeUndefined();
  });

  it("streams bookings and barcodes normally outside availability view", () => {
    const sources = createDeferredHydration(
      ["asset-1"],
      {
        organizationId: ORG_ID,
        viewerScope: VIEWER_SCOPE,
        barcodesEnabled: true,
        required: new Set<BatchKey>(["bookings", "barcodes"]),
        cfFieldIds: [],
        isAvailabilityView: false,
      },
      new AbortController().signal
    );

    expect(Object.keys(sources).sort()).toEqual(["barcodes", "bookings"]);
  });

  it("calls withReadSlot on the interactive lane with the batch label and idCount", () => {
    withReadSlotMock.mockClear();
    const ids = ["asset-1", "asset-2", "asset-3"];
    const signal = new AbortController().signal;

    createDeferredHydration(
      ids,
      {
        organizationId: ORG_ID,
        viewerScope: VIEWER_SCOPE,
        barcodesEnabled: true,
        required: new Set<BatchKey>(["custody"]),
        cfFieldIds: [],
        isAvailabilityView: false,
      },
      signal
    );

    expect(withReadSlotMock).toHaveBeenCalledTimes(1);
    const [, opts] = withReadSlotMock.mock.calls[0];
    expect(opts).toEqual({
      signal,
      lane: "interactive",
      batch: "custody",
      idCount: ids.length,
    });
  });
});

/** Builds a minimal, fully-typed `CriticalRow`; individual tests override fields. */
function makeCriticalRow(overrides: Partial<CriticalRow> = {}): CriticalRow {
  return {
    id: "asset-1",
    title: "Camera",
    description: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    userId: "user-1",
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    categoryId: null,
    organizationId: ORG_ID,
    status: "AVAILABLE",
    type: "INDIVIDUAL",
    valuation: null,
    quantity: null,
    unitOfMeasure: null,
    minQuantity: null,
    consumptionType: null,
    availableToBook: true,
    sequentialId: null,
    qrId: "qr-1",
    assetModel: null,
    category: null,
    kit: null,
    ...overrides,
  };
}

describe("assembleHydratedAssets", () => {
  it("preserves row order and applies each column's default when a map has no entry", () => {
    const rows = [
      makeCriticalRow({ id: "asset-1" }),
      makeCriticalRow({ id: "asset-2" }),
    ];
    // why: only `tags` is populated for asset-1 — every other batch is either
    // entirely absent from `maps` (locations, kits, …) or present but without
    // an entry for either asset, so both cases exercise the same defaults.
    const maps: ResolvedHydration = {
      tags: new Map([
        ["asset-1", [{ id: "tag-1", name: "Outdoor", color: "#fff" }]],
      ]),
    };

    const result = assembleHydratedAssets(rows, maps);

    expect(result.map((r) => r.id)).toEqual(["asset-1", "asset-2"]);
    expect(result[0].tags).toEqual([
      { id: "tag-1", name: "Outdoor", color: "#fff" },
    ]);
    expect(result[1].tags).toEqual([]);
    for (const row of result) {
      expect(row.locations).toEqual([]);
      expect(row.location).toBeNull();
      expect(row.kits).toEqual([]);
      expect(row.customFields).toEqual([]);
      expect(row.reminders).toBeNull();
      expect(row.bookings).toEqual([]);
      expect(row.barcodes).toEqual([]);
    }
  });

  it("defaults custody to null, never an empty array", () => {
    const rows = [makeCriticalRow({ id: "asset-1" })];

    const result = assembleHydratedAssets(rows, {});

    expect(result[0].custody).toBeNull();
    expect(result[0].custody).not.toEqual([]);
  });

  it("picks the first element of the locations array as the primary location", () => {
    const rows = [makeCriticalRow({ id: "asset-1" })];
    const maps: ResolvedHydration = {
      locations: new Map([
        [
          "asset-1",
          [
            { id: "loc-1", name: "Warehouse", parentId: null, childCount: 0 },
            { id: "loc-2", name: "Shelf B", parentId: "loc-1", childCount: 0 },
          ],
        ],
      ]),
    };

    const [result] = assembleHydratedAssets(rows, maps);

    expect(result.location).toEqual({
      id: "loc-1",
      name: "Warehouse",
      parentId: null,
      childCount: 0,
    });
    expect(result.locations).toHaveLength(2);
  });

  it("keeps the row's own primary kit untouched by the kits batch", () => {
    const primaryKit = {
      id: "kit-1",
      name: "Studio Kit",
      status: "AVAILABLE" as const,
    };
    const rows = [makeCriticalRow({ id: "asset-1", kit: primaryKit })];
    const maps: ResolvedHydration = {
      kits: new Map([
        [
          "asset-1",
          [
            primaryKit,
            { id: "kit-2", name: "Backup Kit", status: "AVAILABLE" as const },
          ],
        ],
      ]),
    };

    const [result] = assembleHydratedAssets(rows, maps);

    expect(result.kit).toEqual(primaryKit);
    expect(result.kits).toHaveLength(2);
  });

  it("does not mutate the input rows or maps", () => {
    const row = makeCriticalRow({ id: "asset-1" });
    const rows = [row];
    const tagsMap = new Map([
      ["asset-1", [{ id: "tag-1", name: "Outdoor", color: null }]],
    ]);
    const maps: ResolvedHydration = { tags: tagsMap };

    assembleHydratedAssets(rows, maps);

    expect(row).not.toHaveProperty("tags");
    expect(tagsMap.size).toBe(1);
  });
});
