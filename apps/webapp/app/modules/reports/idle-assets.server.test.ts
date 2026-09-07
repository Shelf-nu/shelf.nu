/**
 * Idle Assets Report — Last-Use Predicate Tests
 *
 * Covers the public `idleAssetsReport` function: that every helper (rows,
 * count, KPIs) finds an asset's last use with the archive-aware predicate —
 * archiving rewrites a COMPLETE booking's status to ARCHIVED, so matching
 * COMPLETE alone would make assets look idle the moment their last booking
 * ages into the archive — and that the recency filter itself keeps recently
 * used assets out while including stale and never-booked ones.
 *
 * @see {@link file://./helpers.server.ts}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// why: Mock the Prisma client so the unit tests never touch a real database.
// Matches the pattern in `top-booked-kits.server.test.ts`. The report's three
// helpers all read assets via `db.asset.findMany`; the KPI helper also takes
// a whole-org `db.asset.count`. Fixtures carry no image URLs, so
// `refreshExpiredAssetImages` never needs further db methods.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";

import { idleAssetsReport } from "./helpers.server";

/**
 * Build an asset row shaped as a superset of what the three helpers select.
 * `lastUse` is the end date of the most recent returned booking; `null`
 * models a never-booked asset (empty pivot sub-query result).
 */
function idleAsset(id: string, lastUse: string | null) {
  return {
    id,
    organizationId: "org-1",
    title: `Asset ${id}`,
    mainImage: null,
    mainImageExpiration: null,
    thumbnailImage: null,
    assetModel: null,
    status: "AVAILABLE",
    valuation: null,
    type: "INDIVIDUAL",
    quantity: null,
    unitOfMeasure: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    category: null,
    assetLocations: [],
    bookingAssets: lastUse ? [{ booking: { to: new Date(lastUse) } }] : [],
  };
}

describe("idleAssetsReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.asset.findMany).mockResolvedValue([] as any);
    vi.mocked(db.asset.count).mockResolvedValue(0 as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("finds the last use with the archive-aware predicate in all three helpers", async () => {
    await idleAssetsReport({ organizationId: "org-1" });

    // Rows fetch, idle count, and KPI computation each scan assets once.
    const calls = vi.mocked(db.asset.findMany).mock.calls;
    expect(calls).toHaveLength(3);
    for (const [args] of calls) {
      const lastUseWhere = (args as any).select.bookingAssets.where.booking;
      // Archiving rewrites status (COMPLETE → ARCHIVED), so last use must
      // match checked-in archives too; never-checked-out archives
      // (`archivedWithoutCheckin: true`) are not uses.
      expect(lastUseWhere).toEqual({
        OR: [
          { status: "COMPLETE" },
          { status: "ARCHIVED", archivedWithoutCheckin: false },
        ],
      });
    }
  });

  it("keeps recently used assets out and includes stale and never-booked ones", async () => {
    // why: The idle cutoff derives from the wall clock (`now − threshold`);
    // pinning `now` makes the recency assertions exact.
    vi.useFakeTimers().setSystemTime(new Date("2026-08-26T12:00:00Z"));

    // Threshold 30d → cutoff 2026-07-27T12:00:00Z.
    vi.mocked(db.asset.findMany).mockResolvedValue([
      idleAsset("asset-recent", "2026-08-20T00:00:00Z"), // used after cutoff
      idleAsset("asset-stale", "2026-05-01T00:00:00Z"), // last use before cutoff
      idleAsset("asset-never", null), // never booked
    ] as any);
    vi.mocked(db.asset.count).mockResolvedValue(3 as any);

    const result = await idleAssetsReport({
      organizationId: "org-1",
      idleThresholdDays: 30,
    });

    expect(result.rows.map((r) => r.assetId)).toEqual([
      "asset-stale",
      "asset-never",
    ]);
    expect(result.totalRows).toBe(2);
    const totalIdle = result.kpis.find((k) => k.id === "total_idle");
    expect(totalIdle?.rawValue).toBe(2);
  });
});
