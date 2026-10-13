// @vitest-environment node
/**
 * Tests for {@link getAdvancedAssetsForExport} (the bounded, windowed export
 * pipeline) and {@link toAdvancedIndexExportAsset} (the shape adapter).
 *
 * Mocks the DB-touching layers only (`db.$queryRaw`, the critical-row query,
 * the 8 hydration batches, and `withReadSlot`) so every assertion below is
 * about the PIPELINE's own orchestration — windowing, ordering, which
 * batches it fetches, the deadlock-avoiding slot discipline, and abort
 * handling — never about a real query's SQL shape (that is
 * `critical-query.server.test.ts` / `hydrate-*.server.test.ts`'s job).
 *
 * @see {@link file://./export.server.ts}
 */
import { AssetStatus, AssetType, BookingStatus, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import type { Column } from "~/modules/asset-index-settings/helpers";
import {
  getAdvancedAssetsForExport,
  toAdvancedIndexExportAsset,
} from "./export.server";
import type { CriticalRow, ViewerScope } from "./types";

type MockDb = { $queryRaw: ReturnType<typeof vi.fn> };
const dbMock = vi.hoisted<MockDb>(() => ({ $queryRaw: vi.fn() }));
// why: isolates the pipeline's own orchestration from a real database — the
// id-only query is the one raw SQL call this file's SUT issues directly.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

const criticalQueryMock = vi.hoisted(() => ({
  getAdvancedAssetCriticalPage: vi.fn(),
}));
// why: the critical-row query is real-DB tested elsewhere
// (critical-query.server.test.ts); here it's a controllable stand-in so
// per-window behavior (windowing, ordering) can be asserted deterministically.
vi.mock("./critical-query.server", () => criticalQueryMock);

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

/**
 * A passthrough `withReadSlot` stand-in that additionally tracks: (1) whether
 * any `withReadSlot` call is made SYNCHRONOUSLY from inside another slot's `fn`
 * body — a parent slot held open while a child acquires its own slot, which is
 * the nesting deadlock this pipeline must avoid; (2) every call's
 * `{ lane, batch, idCount }` metadata, so a test can assert the export lane and
 * per-window id counts directly, without reverse-engineering bind values out of
 * a `Prisma.Sql` fragment; and (3) the `signal` option, honoring an
 * already-aborted (or later-aborted) signal the same way the real limiter does
 * — reject with an `AbortError`, `fn` never called — so abort-handling tests
 * exercise the real contract.
 *
 * Nesting is detected via an `executingFn` flag set only around the SYNCHRONOUS
 * invocation of `fn`, not a lifetime depth counter: leaf reads launched
 * together with `Promise.all` overlap in flight by design (that is the
 * concurrency this pipeline wants), and each `fn()` returns its pending promise
 * before the next `withReadSlot` is called, so `executingFn` is back to `false`
 * between siblings. Only a call issued while another `fn` is still on the stack
 * — the real parent-holds-slot-around-child shape — trips `sawNestedCall`.
 */
const readSlotMock = vi.hoisted(() => {
  const state = {
    executingFn: false,
    sawNestedCall: false,
    calls: [] as Array<{ lane?: string; batch?: string; idCount?: number }>,
  };
  const withReadSlot = vi.fn(
    (
      fn: () => Promise<unknown>,
      opts?: {
        signal?: AbortSignal;
        lane?: string;
        batch?: string;
        idCount?: number;
      }
    ) => {
      if (opts?.signal?.aborted) {
        return Promise.reject(
          new DOMException("Read slot request aborted", "AbortError")
        );
      }
      if (state.executingFn) {
        state.sawNestedCall = true;
      }
      state.calls.push({
        lane: opts?.lane,
        batch: opts?.batch,
        idCount: opts?.idCount,
      });
      state.executingFn = true;
      try {
        return Promise.resolve(fn());
      } finally {
        state.executingFn = false;
      }
    }
  );
  return { withReadSlot, state };
});
vi.mock("~/utils/read-batch-limiter.server", () => ({
  withReadSlot: readSlotMock.withReadSlot,
}));

const ORG_ID = "org-1";
const VIEWER_SCOPE: ViewerScope = { userId: "user-1", canSeeAllCustody: true };
const WHERE_CLAUSE = Prisma.sql`WHERE a."organizationId" = ${ORG_ID}`;

/** Builds one minimal, valid {@link CriticalRow} for asset `id`. */
function makeCriticalRow(id: string): CriticalRow {
  return {
    id,
    title: `Asset ${id}`,
    description: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    userId: "user-1",
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    categoryId: null,
    organizationId: ORG_ID,
    status: AssetStatus.AVAILABLE,
    type: AssetType.INDIVIDUAL,
    valuation: null,
    quantity: null,
    unitOfMeasure: null,
    minQuantity: null,
    consumptionType: null,
    availableToBook: true,
    sequentialId: null,
    qrId: `qr-${id}`,
    assetModelId: null,
    assetModelName: null,
    assetModel: null,
    category: null,
    kit: null,
  };
}

/** Common args shared by most `getAdvancedAssetsForExport` calls below. */
function baseArgs(overrides?: {
  columns?: Column[];
  activeCustomFields?: Array<{ id: string; name: string }>;
  signal?: AbortSignal;
  output?: "human" | "import-ready";
}) {
  return {
    output: overrides?.output ?? ("human" as const),
    organizationId: ORG_ID,
    viewerScope: VIEWER_SCOPE,
    barcodesEnabled: true,
    whereClause: WHERE_CLAUSE,
    orderByInner: `a."createdAt" DESC`,
    customFieldSortings: [],
    sortBy: [],
    parsedFilters: [] as Filter[],
    columns: overrides?.columns ?? [],
    activeCustomFields: overrides?.activeCustomFields ?? [],
    signal: overrides?.signal ?? new AbortController().signal,
  };
}

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
  criticalQueryMock.getAdvancedAssetCriticalPage.mockReset();
  hydrateSimpleMock.fetchTagsBatch.mockClear();
  hydrateSimpleMock.fetchLocationsBatch.mockClear();
  hydrateSimpleMock.fetchKitsBatch.mockClear();
  hydrateSimpleMock.fetchCustomFieldsBatch.mockClear();
  hydrateSimpleMock.fetchRemindersBatch.mockClear();
  hydrateHeavyMock.fetchCustodyBatch.mockClear();
  hydrateHeavyMock.fetchBookingsBatch.mockClear();
  hydrateHeavyMock.fetchBarcodesBatch.mockClear();
  readSlotMock.withReadSlot.mockClear();
  readSlotMock.state.executingFn = false;
  readSlotMock.state.sawNestedCall = false;
  readSlotMock.state.calls = [];
});

describe("getAdvancedAssetsForExport", () => {
  it("human vs import-ready columns require different hydration batches", async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([{ assetId: "a1", __sortRank: 0 }]);
    criticalQueryMock.getAdvancedAssetCriticalPage.mockResolvedValueOnce({
      items: [makeCriticalRow("a1")],
    });

    await getAdvancedAssetsForExport(
      baseArgs({
        output: "human",
        columns: [
          { name: "tags", visible: true, position: 0 },
          { name: "kit", visible: true, position: 1 },
        ],
      })
    );

    expect(hydrateSimpleMock.fetchTagsBatch).toHaveBeenCalledTimes(1);
    expect(hydrateSimpleMock.fetchKitsBatch).toHaveBeenCalledTimes(1);
    expect(hydrateHeavyMock.fetchCustodyBatch).not.toHaveBeenCalled();

    dbMock.$queryRaw.mockResolvedValueOnce([{ assetId: "a2", __sortRank: 0 }]);
    criticalQueryMock.getAdvancedAssetCriticalPage.mockResolvedValueOnce({
      items: [makeCriticalRow("a2")],
    });

    await getAdvancedAssetsForExport(
      baseArgs({
        output: "import-ready",
        columns: [{ name: "custody", visible: true, position: 0 }],
      })
    );

    // Only one extra call each since the last check (mockClear happens in
    // beforeEach, so these totals are for THIS test's two calls combined).
    expect(hydrateSimpleMock.fetchTagsBatch).toHaveBeenCalledTimes(1);
    expect(hydrateSimpleMock.fetchKitsBatch).toHaveBeenCalledTimes(1);
    expect(hydrateHeavyMock.fetchCustodyBatch).toHaveBeenCalledTimes(1);
  });

  it("windows 1200 ids into exactly 3 windows of <=500 and preserves order", async () => {
    const allIds = Array.from({ length: 1200 }, (_, i) => `asset-${i}`);
    dbMock.$queryRaw.mockResolvedValueOnce(
      allIds.map((assetId, i) => ({ assetId, __sortRank: i }))
    );

    const windows = [
      allIds.slice(0, 500),
      allIds.slice(500, 1000),
      allIds.slice(1000, 1200),
    ];
    for (const window of windows) {
      criticalQueryMock.getAdvancedAssetCriticalPage.mockResolvedValueOnce({
        items: window.map(makeCriticalRow),
      });
    }

    const result = await getAdvancedAssetsForExport(baseArgs());

    expect(
      criticalQueryMock.getAdvancedAssetCriticalPage
    ).toHaveBeenCalledTimes(3);
    expect(result.map((row) => row.id)).toEqual(allIds);

    // Each window's "critical" leaf read was bounded to <=500 ids — recorded
    // directly by the withReadSlot stand-in, not reverse-engineered from SQL.
    const criticalCalls = readSlotMock.state.calls.filter(
      (c) => c.batch?.includes("critical")
    );
    expect(criticalCalls).toHaveLength(3);
    expect(criticalCalls.map((c) => c.idCount)).toEqual([500, 500, 200]);
    for (const call of criticalCalls) {
      expect(call.idCount).toBeLessThanOrEqual(500);
      expect(call.lane).toBe("export");
    }
  });

  it("never runs count_query for the ordered id fetch", async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([]);

    await getAdvancedAssetsForExport(baseArgs());

    expect(dbMock.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = dbMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    const text = sql.strings.join("?");
    const finalSelectStart = text.lastIndexOf('SELECT "assetId"');
    expect(finalSelectStart).toBeGreaterThan(-1);
    const finalSelect = text.slice(finalSelectStart);
    // The final SELECT reads only `sorted_asset_query` — `count_query` still
    // exists as an unreferenced CTE definition earlier in the text (built by
    // the shared `buildSlimPagedAssetCTEs`), but nothing here selects from it.
    expect(finalSelect).toMatch(/FROM\s+sorted_asset_query/);
    expect(finalSelect).not.toMatch(/count_query/);
  });

  it("returns [] without issuing any query when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await getAdvancedAssetsForExport(
      baseArgs({ signal: controller.signal })
    );

    expect(result).toEqual([]);
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
    expect(
      criticalQueryMock.getAdvancedAssetCriticalPage
    ).not.toHaveBeenCalled();
  });

  it("stops scheduling windows on a mid-export abort without throwing", async () => {
    const allIds = Array.from({ length: 600 }, (_, i) => `asset-${i}`);
    dbMock.$queryRaw.mockResolvedValueOnce(
      allIds.map((assetId, i) => ({ assetId, __sortRank: i }))
    );

    const controller = new AbortController();
    const window1 = allIds.slice(0, 500);
    // Aborts as a side effect of the FIRST window's critical read settling —
    // the second window (ids 500..599) must never be requested.
    criticalQueryMock.getAdvancedAssetCriticalPage.mockImplementationOnce(
      async () => {
        controller.abort();
        return { items: window1.map(makeCriticalRow) };
      }
    );

    const result = await getAdvancedAssetsForExport(
      baseArgs({ signal: controller.signal })
    );

    expect(
      criticalQueryMock.getAdvancedAssetCriticalPage
    ).toHaveBeenCalledTimes(1);
    expect(result.map((row) => row.id)).toEqual(window1);
  });

  it("never holds a slot around a window's children (no nested withReadSlot)", async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([{ assetId: "a1", __sortRank: 0 }]);
    criticalQueryMock.getAdvancedAssetCriticalPage.mockResolvedValueOnce({
      items: [makeCriticalRow("a1")],
    });

    const allBatchColumns: Column[] = [
      { name: "tags", visible: true, position: 0 },
      { name: "location", visible: true, position: 1 },
      { name: "kit", visible: true, position: 2 },
      { name: "custody", visible: true, position: 3 },
      { name: "upcomingReminder", visible: true, position: 4 },
      { name: "upcomingBookings", visible: true, position: 5 },
      { name: "barcode_Code128", visible: true, position: 6 },
      { name: "cf_Brand", visible: true, position: 7 },
    ];

    await getAdvancedAssetsForExport(
      baseArgs({
        columns: allBatchColumns,
        activeCustomFields: [{ id: "cf-1", name: "Brand" }],
      })
    );

    expect(readSlotMock.state.sawNestedCall).toBe(false);
    // One id-fetch leaf read, plus one critical + 8 batches for the single
    // window — every leaf read wrapped individually, none nested.
    expect(readSlotMock.withReadSlot).toHaveBeenCalledTimes(10);
    expect(
      readSlotMock.state.calls.every((call) => call.lane === "export")
    ).toBe(true);
  });
});

describe("toAdvancedIndexExportAsset", () => {
  it("converts date-like string fields to real Date instances", () => {
    const row = makeCriticalRow("a1");
    const asset = toAdvancedIndexExportAsset({
      ...row,
      tags: [],
      location: null,
      locations: [],
      kits: [],
      customFields: [],
      reminders: {
        id: "r1",
        name: "Check battery",
        message: "Replace the battery",
        alertDateTime: "2026-02-01T00:00:00.000Z",
      },
      custody: null,
      bookings: [],
      barcodes: [],
    });

    expect(asset.createdAt).toBeInstanceOf(Date);
    expect(asset.updatedAt).toBeInstanceOf(Date);
    expect(asset.upcomingReminder?.alertDateTime).toBeInstanceOf(Date);
  });

  it("converts a null nested relation to undefined, matching the legacy shape", () => {
    const row = makeCriticalRow("a1");
    const asset = toAdvancedIndexExportAsset({
      ...row,
      tags: [],
      location: null,
      locations: [],
      kits: [],
      customFields: [],
      reminders: null,
      custody: null,
      bookings: [
        {
          id: "b1",
          name: "Booking 1",
          description: null,
          status: BookingStatus.RESERVED,
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-01-02T00:00:00.000Z",
          tags: [{ id: "t1", name: "Tag 1" }],
          custodianTeamMember: null,
          custodianUser: null,
          creator: null,
          assetKitId: null,
          quantity: null,
          kitName: null,
        },
      ],
      barcodes: [],
    });

    expect(asset.upcomingReminder).toBeUndefined();
    expect(asset.bookings?.[0].custodianTeamMember).toBeUndefined();
    expect(asset.bookings?.[0].quantity).toBeUndefined();
    expect(asset.bookings?.[0].tags).toEqual([
      { id: "t1", name: "Tag 1", color: null },
    ]);
  });
});
