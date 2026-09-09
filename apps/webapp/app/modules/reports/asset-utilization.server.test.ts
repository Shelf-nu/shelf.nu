/**
 * Asset Utilization Report — Predicate & In-Use Time Tests
 *
 * Covers the public `assetUtilizationReport` function: that only bookings
 * representing real usage feed utilization (DRAFT/CANCELLED excluded at the
 * query layer), and that per-asset in-use time is the merged coverage of the
 * asset's booking intervals clamped to the window — counted once per
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
  },
}));

import { db } from "~/database/db.server";

import { assetUtilizationReport } from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
};

/** A booking slice as projected by the asset query's `bookingAssets` select. */
function slice(id: string, from: string, to: string) {
  return { booking: { id, from: new Date(from), to: new Date(to) } };
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("excludes DRAFT and CANCELLED bookings from the usage query", async () => {
    await assetUtilizationReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const args = vi.mocked(db.asset.findMany).mock.calls[0][0] as any;
    // A DRAFT booking is a plan and a CANCELLED one never happened — neither
    // is usage, so the slice filter excludes them exactly like the
    // top-booked reports do.
    expect(args.select.bookingAssets.where.booking).toEqual({
      from: { lte: TIMEFRAME.to },
      to: { gte: TIMEFRAME.from },
      status: { notIn: ["DRAFT", "CANCELLED"] },
    });
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
    // Two bookings overlapping by 5 days: Apr 1–11 and Apr 6–16. Merged
    // coverage is Apr 1–16 = 15 days; a plain sum would report 20.
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
});
