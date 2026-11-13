/**
 * Asset Utilization Report: Predicate & In-Use Time Tests
 *
 * Covers the public `assetUtilizationReport` function: that only bookings
 * representing real usage feed utilization (DRAFT/CANCELLED excluded at the
 * query layer), and that per-asset in-use time is the merged coverage of the
 * asset's booking intervals clamped to the window, counted once per
 * distinct booking, overlaps merged, so utilization can never exceed 100%.
 *
 * @see {@link file://./helpers.server.ts}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// why: Mock the Prisma client so the unit tests never touch a real database.
// Matches the pattern in `top-booked-kits.server.test.ts`. The report reads
// assets (with their in-window booking slices) through `db.asset.findMany`;
// fixtures carry no image URLs, so `refreshExpiredAssetImages` never needs
// further db methods.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
    },
    consumptionLog: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";
import {
  MOVE_CATEGORY,
  OPENING_BALANCE_CATEGORY,
} from "~/modules/consumption-log/stock-ledger";

import {
  assetUtilizationReport,
  computeQuantityUtilization,
} from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
};

/** A booking slice as projected by the asset query's `bookingAssets` select. */
function slice(id: string, from: string, to: string, quantity = 1) {
  return { quantity, booking: { id, from: new Date(from), to: new Date(to) } };
}

/** A stock-ledger entry projected by `consumptionLogs`. */
function ledgerChange(createdAt: string, stockChange: number) {
  return { createdAt: new Date(createdAt), stockChange };
}

/** Build a QUANTITY_TRACKED asset pool. */
function quantityAsset(
  id: string,
  poolQuantity: number,
  bookingSlices: ReturnType<typeof slice>[]
) {
  return {
    ...asset(id, bookingSlices),
    type: "QUANTITY_TRACKED",
    quantity: poolQuantity,
  };
}

/**
 * Build an asset row as returned by `db.asset.findMany`. Image fields stay
 * null so the image-refresh helper is a no-op.
 */
function asset(id: string, bookingSlices: ReturnType<typeof slice>[]) {
  return {
    id,
    organizationId: "org-1",
    title: `Asset ${id}`,
    mainImage: null,
    mainImageExpiration: null,
    thumbnailImage: null,
    assetModel: null,
    valuation: null,
    type: "INDIVIDUAL",
    quantity: null,
    unitOfMeasure: null,
    category: null,
    assetLocations: [],
    bookingAssets: bookingSlices,
  };
}

describe("assetUtilizationReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.asset.findMany).mockResolvedValue([] as any);
    vi.mocked(db.consumptionLog.findMany).mockResolvedValue([]);
    vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("excludes DRAFT, CANCELLED and never-checked-out archived bookings from the usage query", async () => {
    await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const args = vi.mocked(db.asset.findMany).mock.calls[0][0] as any;
    // A DRAFT booking is a plan, a CANCELLED one never happened, and one
    // archived before any check-out (a discarded draft or an unused
    // reservation) never went out. None is usage, so the slice filter
    // excludes them exactly like the top-booked reports do.
    expect(args.select.bookingAssets.where.booking).toEqual({
      from: { lte: TIMEFRAME.to },
      to: { gte: TIMEFRAME.from },
      status: { notIn: ["DRAFT", "CANCELLED"] },
      archivedWithoutCheckin: false,
    });
  });

  it("filters ledger queries by timeframe, nonzero change, and category", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-1", 10, []),
    ] as any);

    await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(db.consumptionLog.findMany).toHaveBeenCalledWith({
      where: {
        assetId: { in: ["pool-1"] },
        createdAt: {
          gt: TIMEFRAME.from,
          lt: TIMEFRAME.to,
        },
        stockChange: { not: 0 },
        category: {
          notIn: [MOVE_CATEGORY, OPENING_BALANCE_CATEGORY],
        },
      },
      select: {
        assetId: true,
        createdAt: true,
        stockChange: true,
      },
      orderBy: { createdAt: "asc" },
    });

    expect(db.consumptionLog.groupBy).toHaveBeenCalledWith({
      by: ["assetId"],
      where: {
        assetId: { in: ["pool-1"] },
        createdAt: { gte: TIMEFRAME.to },
        stockChange: { not: 0 },
        category: {
          notIn: [MOVE_CATEGORY, OPENING_BALANCE_CATEGORY],
        },
      },
      _sum: {
        stockChange: true,
      },
    });
  });

  it("does not query ledger rows when all assets are individual", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([
      asset("ind-1", []),
    ] as any);

    await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(db.consumptionLog.findMany).not.toHaveBeenCalled();
    expect(db.consumptionLog.groupBy).not.toHaveBeenCalled();
  });

  it("counts a booking's days once even when it holds multiple slices of the asset", async () => {
    // One booking holding TWO pivot rows for the same asset (standalone +
    // kit-driven slice, which the pivot's partial unique indexes allow).
    vi.mocked(db.asset.findMany).mockResolvedValue([
      asset("asset-1", [
        slice("b-1", "2026-04-10T00:00:00Z", "2026-04-13T00:00:00Z"),
        slice("b-1", "2026-04-10T00:00:00Z", "2026-04-13T00:00:00Z"),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    // 3 days, not 6.
    expect(result.rows[0].daysInUse).toBe(3);
    expect(result.rows[0].bookingCount).toBe(1);
  });

  it("merges overlapping bookings instead of summing them", async () => {
    // Two bookings overlapping by 5 days: Apr 1-11 and Apr 6-16. Merged
    // coverage is Apr 1-16 = 15 days; a plain sum would report 20.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      asset("asset-1", [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-11T00:00:00Z"),
        slice("b-2", "2026-04-06T00:00:00Z", "2026-04-16T00:00:00Z"),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].daysInUse).toBe(15);
    expect(result.rows[0].bookingCount).toBe(2);
    expect(result.rows[0].utilizationRate).toBe(50);
  });

  it("sums exact milliseconds and converts to days once at the end", async () => {
    // Two adjacent 1.5-day bookings cover exactly 3 days. Rounding each
    // booking up before summing would report 4.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      asset("asset-1", [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-02T12:00:00Z"),
        slice("b-2", "2026-04-02T12:00:00Z", "2026-04-04T00:00:00Z"),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].daysInUse).toBe(3);
  });

  it("caps utilization at 100% for concurrent whole-window bookings", async () => {
    // Three bookings each spanning past both window edges: coverage clamps
    // to the window itself, so utilization is 100 — never 300.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      asset("asset-1", [
        slice("b-1", "2026-03-25T00:00:00Z", "2026-05-05T00:00:00Z"),
        slice("b-2", "2026-03-20T00:00:00Z", "2026-05-10T00:00:00Z"),
        slice("b-3", "2026-03-15T00:00:00Z", "2026-05-15T00:00:00Z"),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].daysInUse).toBe(result.rows[0].totalDays);
    expect(result.rows[0].utilizationRate).toBe(100);
    expect(result.rows[0].bookingCount).toBe(3);
  });
  it("weights quantity-tracked assets by booked units over pool capacity", async () => {
    // 1 unit of a 14-unit asset booked for the entire 30-day window:
    // 30 unit-days booked out of 30 * 14 = 420 available unit-days.
    // Utilization rate should be 30 / 420 = 7%, not 100%.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-1", 14, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z", 1),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].utilizationRate).toBe(7);
    expect(result.rows[0].bookingCount).toBe(1);
    expect(result.rows[0].daysInUse).toBe(30); // calendar days with >= 1 unit booked
  });

  it("reports 100% utilization when all units in a quantity pool are booked", async () => {
    // All 14 units booked for the entire window
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-1", 14, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z", 14),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].utilizationRate).toBe(100);
    expect(result.rows[0].daysInUse).toBe(result.rows[0].totalDays);
  });

  it("aggregates concurrent bookings of separate units in a quantity pool", async () => {
    // Booking 1: 5 units for 15 days (Apr 1-16) -> 75 unit-days
    // Booking 2: 5 units for 15 days (Apr 1-16) -> 75 unit-days
    // Total: 150 unit-days out of 14 * 30 = 420 unit-days -> 36%
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-1", 14, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-16T00:00:00Z", 5),
        slice("b-2", "2026-04-01T00:00:00Z", "2026-04-16T00:00:00Z", 5),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].utilizationRate).toBe(36);
    expect(result.rows[0].bookingCount).toBe(2);
  });

  it("sums multiple slices belonging to the same booking in a quantity pool", async () => {
    // One booking with two slices (e.g. kit-driven slice of 2 + standalone slice of 3 = 5 units)
    // for 15 days = 75 unit-days out of 420 unit-days = 18%
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-1", 14, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-16T00:00:00Z", 2),
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-16T00:00:00Z", 3),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].utilizationRate).toBe(18);
    expect(result.rows[0].bookingCount).toBe(1);
  });

  it("caps instantaneous in-use units at pool capacity during overlapping bookings", async () => {
    // Two overlapping bookings of 8 units each on a 10-unit pool across the
    // first 15 days (Apr 1-16), idle for the remaining 15 days:
    // instantaneous usage caps at 10 units -> 150 / 300 = 50% (not 80%).
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-1", 10, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-16T00:00:00Z", 8),
        slice("b-2", "2026-04-01T00:00:00Z", "2026-04-16T00:00:00Z", 8),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].utilizationRate).toBe(50);
    expect(result.rows[0].daysInUse).toBe(15);
    expect(result.rows[0].bookingCount).toBe(2);
  });

  it("caps instantaneous in-use units when quantity-pool bookings are staggered", async () => {
    // 8 units Apr 1-11 and 8 units Apr 6-16 on a 10-unit pool.
    // Apr 1-6: 8 units, Apr 6-11: min(16, 10) = 10, Apr 11-16: 8.
    // 5 * 8 + 5 * 10 + 5 * 8 = 130 unit-days out of 300 -> 43%.
    // A global cap would give min(160, 150) = 150 -> 50%.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-1", 10, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-11T00:00:00Z", 8),
        slice("b-2", "2026-04-06T00:00:00Z", "2026-04-16T00:00:00Z", 8),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].utilizationRate).toBe(43);
    expect(result.rows[0].daysInUse).toBe(15);
    expect(result.rows[0].bookingCount).toBe(2);
  });

  it("reports booked days for a quantity pool with zero stock across the period", async () => {
    // QUANTITY_TRACKED pool with 0 stock across the period and one booking for
    // 3 units from Apr 1 to Apr 4 (3 days).
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-zero", 0, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-04T00:00:00Z", 3),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].daysInUse).toBe(3);
    expect(result.rows[0].utilizationRate).toBe(0);
    expect(result.rows[0].bookingCount).toBe(1);
  });

  it("reconstructs historical pool capacity from stock-ledger changes", async () => {
    // Pool had 10 units during Apr 1-16 (all 10 booked), then all 10 units were
    // consumed on Apr 16 leaving live quantity = 0 today. Historical utilization
    // over the 150 available unit-days is 100%, and daysInUse is 15.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-depleted", 0, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-04-16T00:00:00Z", 10),
      ]),
      // Pool grew from 10 to 20 units mid-window (Apr 16):
      // available = 15*10 + 15*20 = 450 unit-days; 10 units booked full 30d = 300 -> 67%.
      quantityAsset("pool-restocked", 20, [
        slice("b-2", "2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z", 10),
      ]),
    ] as any);

    vi.mocked(db.consumptionLog.findMany).mockResolvedValue([
      {
        assetId: "pool-depleted",
        createdAt: new Date("2026-04-16T00:00:00Z"),
        stockChange: -10,
      },
      {
        assetId: "pool-restocked",
        createdAt: new Date("2026-04-16T00:00:00Z"),
        stockChange: 10,
      },
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const depleted = result.rows.find((r) => r.assetId === "pool-depleted")!;
    const restocked = result.rows.find((r) => r.assetId === "pool-restocked")!;
    expect(depleted.utilizationRate).toBe(100);
    expect(depleted.daysInUse).toBe(15);
    expect(restocked.utilizationRate).toBe(67);
    expect(restocked.daysInUse).toBe(30);
  });

  it("accounts for stock changes occurring after the period end via post-period sums", async () => {
    // Pool has live quantity 15 today because of a +5 restock on May 5 (after period end).
    // During April (30 days), effective capacity was 10 units = 300 unit-days available.
    // Booking was for 5 units across the full 30 days = 150 unit-days -> 50% utilization.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-post-change", 15, [
        slice("b-1", "2026-04-01T00:00:00Z", "2026-05-01T00:00:00Z", 5),
      ]),
    ] as any);

    vi.mocked(db.consumptionLog.groupBy).mockResolvedValue([
      {
        assetId: "pool-post-change",
        _sum: {
          stockChange: 5,
        },
      },
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows[0].utilizationRate).toBe(50);
    expect(result.rows[0].daysInUse).toBe(30);
  });

  it("matches utilization rounding between a 1-unit quantity pool and an individual asset", async () => {
    const oneDayWindow: ResolvedTimeframe = {
      preset: "custom",
      label: "Apr 10",
      from: new Date("2026-04-10T00:00:00Z"),
      to: new Date("2026-04-11T00:00:00Z"),
    };
    vi.mocked(db.asset.findMany).mockResolvedValue([
      asset("ind-1", [
        slice("b-1", "2026-04-10T09:00:00Z", "2026-04-10T10:00:00Z", 1),
      ]),
      quantityAsset("pool-1", 1, [
        slice("b-2", "2026-04-10T09:00:00Z", "2026-04-10T10:00:00Z", 1),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: oneDayWindow,
    });

    const ind = result.rows.find((r) => r.assetId === "ind-1")!;
    const pool = result.rows.find((r) => r.assetId === "pool-1")!;
    expect(pool.daysInUse).toBe(ind.daysInUse);
    expect(pool.utilizationRate).toBe(ind.utilizationRate);
    expect(pool.utilizationRate).toBe(100);
  });

  it("clamps totalDays and daysInUse to zero when custom timeframe is reversed", async () => {
    const reversed: ResolvedTimeframe = {
      preset: "custom",
      label: "Reversed",
      from: new Date("2026-04-20T00:00:00Z"),
      to: new Date("2026-04-10T00:00:00Z"),
    };
    vi.mocked(db.asset.findMany).mockResolvedValue([
      quantityAsset("pool-1", 5, [
        slice("b-1", "2026-04-05T00:00:00Z", "2026-04-25T00:00:00Z", 5),
      ]),
      asset("ind-1", [
        slice("b-2", "2026-04-05T00:00:00Z", "2026-04-25T00:00:00Z", 1),
      ]),
    ] as any);

    const result = await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: reversed,
    });

    for (const row of result.rows) {
      expect(row.totalDays).toBe(0);
      expect(row.daysInUse).toBe(0);
      expect(row.utilizationRate).toBe(0);
    }
  });
});

describe("computeQuantityUtilization", () => {
  const windowStart = new Date("2026-04-01T00:00:00Z").getTime();
  const windowEnd = new Date("2026-05-01T00:00:00Z").getTime();

  it("shifts starting stock when a ledger row occurs after period end", () => {
    // Live quantity is 15 today after a restock of +5 on May 5 (after period end).
    // Effective capacity during the period was 10.
    // 5 units booked for 30 days = 150 unit-days out of 10*30 = 300 unit-days -> 50%
    const result = computeQuantityUtilization({
      windowStart,
      windowEnd,
      liveQuantity: 15,
      slices: [
        {
          quantity: 5,
          booking: {
            id: "b-1",
            from: new Date("2026-04-01T00:00:00Z"),
            to: new Date("2026-05-01T00:00:00Z"),
          },
        },
      ],
      ledger: [
        {
          createdAt: new Date("2026-05-05T00:00:00Z"),
          stockChange: 5,
        },
      ],
    });

    expect(result.daysInUse).toBe(30);
    expect(result.utilizationRate).toBe(50);
  });

  it("ignores a ledger row at or before the period start", () => {
    // Live quantity 10. A row at or before period start (e.g. Mar 31) should be ignored.
    // 5 units booked for 30 days = 150 / 300 = 50%
    const result = computeQuantityUtilization({
      windowStart,
      windowEnd,
      liveQuantity: 10,
      slices: [
        {
          quantity: 5,
          booking: {
            id: "b-1",
            from: new Date("2026-04-01T00:00:00Z"),
            to: new Date("2026-05-01T00:00:00Z"),
          },
        },
      ],
      ledger: [
        {
          createdAt: new Date("2026-03-31T23:59:59Z"),
          stockChange: 5,
        },
        {
          createdAt: new Date("2026-04-01T00:00:00Z"),
          stockChange: 3,
        },
      ],
    });

    expect(result.daysInUse).toBe(30);
    expect(result.utilizationRate).toBe(50);
  });

  it("calculates daysInUse while leaving utilizationRate 0 for zero stock pool", () => {
    // Pool with 0 stock across period, booking for 3 units for 3 days.
    const result = computeQuantityUtilization({
      windowStart,
      windowEnd,
      liveQuantity: 0,
      slices: [
        {
          quantity: 3,
          booking: {
            id: "b-1",
            from: new Date("2026-04-01T00:00:00Z"),
            to: new Date("2026-04-04T00:00:00Z"),
          },
        },
      ],
    });

    expect(result.daysInUse).toBe(3);
    expect(result.utilizationRate).toBe(0);
    expect(result.bookingCount).toBe(1);
  });

  it("treats a slice with null quantity as 1 unit", () => {
    // Pool quantity 10. Slice with null quantity for 15 days = 15 unit-days out of 300 -> 5%
    const result = computeQuantityUtilization({
      windowStart,
      windowEnd,
      liveQuantity: 10,
      slices: [
        {
          quantity: null,
          booking: {
            id: "b-1",
            from: new Date("2026-04-01T00:00:00Z"),
            to: new Date("2026-04-16T00:00:00Z"),
          },
        },
      ],
    });

    expect(result.daysInUse).toBe(15);
    expect(result.utilizationRate).toBe(5);
    expect(result.bookingCount).toBe(1);
  });
});
