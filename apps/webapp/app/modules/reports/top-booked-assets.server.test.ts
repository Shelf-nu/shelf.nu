/**
 * Top Booked Assets Report — Predicate & Aggregation Tests
 *
 * Covers the public `topBookedAssetsReport` function: that both booking
 * queries (rows + KPIs) use the interval-overlap window predicate, that an
 * asset is counted once per booking even when the booking holds several
 * pivot slices of it, and that the "Total Bookings" hero counts the same
 * booking population the rows aggregate.
 *
 * @see {@link file://./helpers.server.ts}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// why: Mock the Prisma client so the unit tests never touch a real database.
// Matches the pattern in `top-booked-kits.server.test.ts`. Both the rows
// fetch and the KPI computation go through `db.booking.findMany`; fixtures
// carry no image URLs, so `refreshExpiredAssetImages` never needs
// `db.asset` methods.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";

import { topBookedAssetsReport } from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
};

/**
 * Build an asset as projected by the ROWS query's nested `bookingAssets`
 * select. Image fields stay null so the image-refresh helper is a no-op.
 */
function rowsAsset(id: string, title: string) {
  return {
    id,
    organizationId: "org-1",
    title,
    mainImage: null,
    mainImageExpiration: null,
    thumbnailImage: null,
    assetModel: null,
    category: null,
    assetLocations: [],
  };
}

/** Build a booking as returned by the ROWS query. */
function rowsBooking(
  from: string,
  to: string,
  assets: Array<{ id: string; title: string }>
) {
  return {
    from: new Date(from),
    to: new Date(to),
    bookingAssets: assets.map((a) => ({ asset: rowsAsset(a.id, a.title) })),
  };
}

/** Build a booking as returned by the KPI query (lean asset projection). */
function kpiBooking(assets: Array<{ id: string; title: string }>) {
  return {
    bookingAssets: assets.map((a) => ({ asset: { id: a.id, title: a.title } })),
  };
}

describe("topBookedAssetsReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.booking.findMany).mockResolvedValue([] as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses an interval-overlap timeframe predicate in both booking queries", async () => {
    await topBookedAssetsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    // Rows fetch + KPI computation each scan bookings once.
    const calls = vi.mocked(db.booking.findMany).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      const where = (args as any).where;
      // Overlap = starts on/before window end AND ends on/after window start.
      // A naive start-OR-end-in-window test (where.OR) would miss bookings
      // that span the entire window, so assert we are NOT using it.
      expect(where.from).toEqual({ lte: TIMEFRAME.to });
      expect(where.to).toEqual({ gte: TIMEFRAME.from });
      expect(where.OR).toBeUndefined();
      expect(where.status).toEqual({ notIn: ["DRAFT", "CANCELLED"] });
    }
  });

  it("counts an asset once per booking even when the booking holds multiple slices of it", async () => {
    // One booking holding TWO pivot rows for the same asset — a standalone
    // slice plus a kit-driven slice, which the pivot's partial unique
    // indexes allow for the same (booking, asset) pair.
    const cam = { id: "asset-1", title: "Camera A" };
    vi.mocked(db.booking.findMany)
      .mockResolvedValueOnce([
        rowsBooking("2026-04-10T00:00:00Z", "2026-04-12T00:00:00Z", [cam, cam]),
      ] as any)
      .mockResolvedValueOnce([kpiBooking([cam, cam])] as any);

    const result = await topBookedAssetsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    // Deduped per (asset, booking): 1 booking, not 2.
    expect(result.rows[0].bookingCount).toBe(1);
    // Days counted once per distinct booking: 2, not 4.
    expect(result.rows[0].totalDaysBooked).toBe(2);
    // The "Most Popular" hero mirrors the rows aggregation, so it dedupes
    // the same way.
    const mostBooked = result.kpis.find((k) => k.id === "most_booked_asset");
    expect(mostBooked?.rawValue).toBe(1);
  });

  it("aggregates distinct bookings of the same asset across bookings", async () => {
    const cam = { id: "asset-1", title: "Camera A" };
    vi.mocked(db.booking.findMany)
      .mockResolvedValueOnce([
        rowsBooking("2026-04-10T00:00:00Z", "2026-04-12T00:00:00Z", [cam]), // 2 days
        rowsBooking("2026-04-20T00:00:00Z", "2026-04-23T00:00:00Z", [cam]), // 3 days
      ] as any)
      .mockResolvedValueOnce([kpiBooking([cam]), kpiBooking([cam])] as any);

    const result = await topBookedAssetsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].bookingCount).toBe(2);
    expect(result.rows[0].totalDaysBooked).toBe(5);
    expect(result.topBookedAsset?.assetId).toBe("asset-1");
  });

  it("clamps a booking's days to the report window", async () => {
    // A booking spanning far beyond the window (which the overlap predicate
    // now includes) contributes only its overlap with the window: March 15
    // to May 15 viewed in April counts April's days, not 61.
    vi.mocked(db.booking.findMany).mockResolvedValueOnce([
      rowsBooking("2026-03-15T00:00:00Z", "2026-05-15T00:00:00Z", [
        { id: "asset-1", title: "Spanning Asset" },
      ]),
    ] as any);
    vi.mocked(db.booking.findMany).mockResolvedValueOnce([
      kpiBooking([{ id: "asset-1", title: "Spanning Asset" }]),
    ] as any);

    const result = await topBookedAssetsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    // Window = April (30 days). Unclamped this would read 61.
    expect(result.rows[0].totalDaysBooked).toBe(30);
  });

  it("counts only bookings holding at least one matching asset in the Total Bookings hero", async () => {
    await topBookedAssetsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
      categoryId: "cat-1",
    });

    // The KPI query is the second booking scan (rows fetch runs first).
    const kpiArgs = vi.mocked(db.booking.findMany).mock.calls[1][0] as any;
    // The hero's population must match the rows': a booking only counts when
    // it holds at least one asset matching the report's asset filters, so
    // assetless bookings (and, under category/location filters, bookings
    // with only non-matching assets) stay out of "Total Bookings".
    expect(kpiArgs.where.bookingAssets).toEqual({
      some: { asset: { organizationId: "org-1", categoryId: "cat-1" } },
    });
    // The nested per-booking pivot filter applies the same asset predicate.
    expect(kpiArgs.select.bookingAssets.where).toEqual({
      asset: { organizationId: "org-1", categoryId: "cat-1" },
    });
  });
});
