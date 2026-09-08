/**
 * Monthly Booking Trends Report — Predicate & Aggregation Tests
 *
 * Covers the public `monthlyBookingTrendsReport` function: that volume
 * excludes DRAFT/CANCELLED bookings, that "completed" is archive-aware
 * (archiving rewrites a COMPLETE booking's status to ARCHIVED), and that
 * each month's unique-assets count aggregates the bookings' pivot rows.
 *
 * @see {@link file://./helpers.server.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// why: Mock the Prisma client so the unit tests never touch a real database.
// Matches the pattern in `top-booked-kits.server.test.ts`. The report reads
// bookings through a single `db.booking.findMany` scan.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";

import { monthlyBookingTrendsReport } from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "this_year",
  label: "This year",
  from: new Date("2026-01-01T00:00:00Z"),
  to: new Date("2026-12-31T23:59:59Z"),
};

/** Build a booking row as returned by the trends scan. */
function booking(args: {
  id: string;
  createdAt: string;
  status: string;
  archivedWithoutCheckin?: boolean;
  assetIds?: string[];
}) {
  return {
    id: args.id,
    createdAt: new Date(args.createdAt),
    status: args.status,
    archivedWithoutCheckin: args.archivedWithoutCheckin ?? false,
    bookingAssets: (args.assetIds ?? []).map((assetId) => ({ assetId })),
  };
}

describe("monthlyBookingTrendsReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.booking.findMany).mockResolvedValue([] as any);
  });

  it("excludes DRAFT and CANCELLED bookings from the volume scan", async () => {
    await monthlyBookingTrendsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const args = vi.mocked(db.booking.findMany).mock.calls[0][0] as any;
    // "Total Bookings" here must mean the same thing it means in the
    // top-booked reports: real bookings, not plans (DRAFT) or bookings that
    // never happened (CANCELLED).
    expect(args.where.status).toEqual({ notIn: ["DRAFT", "CANCELLED"] });
    // The row projection carries what the aggregation reads: the archive
    // origin flag and the pivot's asset ids.
    expect(args.select.archivedWithoutCheckin).toBe(true);
    expect(args.select.bookingAssets).toEqual({ select: { assetId: true } });
  });

  it("counts checked-in archived bookings as completed", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking({
        id: "b-1",
        createdAt: "2026-04-05T10:00:00Z",
        status: "COMPLETE",
      }),
      // Archiving rewrites status (COMPLETE → ARCHIVED); a checked-in
      // archive is still a completed booking.
      booking({
        id: "b-2",
        createdAt: "2026-04-10T10:00:00Z",
        status: "ARCHIVED",
        archivedWithoutCheckin: false,
      }),
      // Archived straight from RESERVED — never returned, so not completed.
      booking({
        id: "b-3",
        createdAt: "2026-04-15T10:00:00Z",
        status: "ARCHIVED",
        archivedWithoutCheckin: true,
      }),
      booking({
        id: "b-4",
        createdAt: "2026-04-20T10:00:00Z",
        status: "ONGOING",
      }),
    ] as any);

    const result = await monthlyBookingTrendsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].bookingsCreated).toBe(4);
    expect(result.rows[0].bookingsCompleted).toBe(2);
  });

  it("counts unique assets booked per month from the bookings' pivot rows", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking({
        id: "b-1",
        createdAt: "2026-04-05T10:00:00Z",
        status: "COMPLETE",
        assetIds: ["asset-1", "asset-2"],
      }),
      booking({
        id: "b-2",
        createdAt: "2026-04-10T10:00:00Z",
        status: "RESERVED",
        assetIds: ["asset-1"],
      }),
      booking({
        id: "b-3",
        createdAt: "2026-05-02T10:00:00Z",
        status: "RESERVED",
        assetIds: ["asset-3"],
      }),
    ] as any);

    const result = await monthlyBookingTrendsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(2);
    // April: asset-1 (twice, deduped) + asset-2 = 2. May: asset-3 = 1.
    expect(result.rows[0].uniqueAssetsBooked).toBe(2);
    expect(result.rows[1].uniqueAssetsBooked).toBe(1);
  });
});
