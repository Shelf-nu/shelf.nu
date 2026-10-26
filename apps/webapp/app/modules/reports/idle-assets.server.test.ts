/**
 * Idle Assets Report: Idle Predicate Tests
 *
 * Covers the public `idleAssetsReport` function: that the rows, the count and
 * the KPIs all select idle assets with one database predicate (so a page holds
 * as many rows as the pager says), that the predicate reads a "use" as an
 * archive-aware returned booking (archiving rewrites a COMPLETE booking's
 * status to ARCHIVED, so matching COMPLETE alone would make assets look idle
 * the moment their last booking ages into the archive), and that a recent use
 * is one ending on or after the cutoff.
 *
 * @see {@link file://./helpers.server.ts}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// why: Mock the Prisma client so the unit tests never touch a real database.
// Matches the pattern in `top-booked-kits.server.test.ts`. The rows and the
// KPIs read assets via `db.asset.findMany`; the idle count and the KPIs'
// whole-org denominator use `db.asset.count`. Fixtures carry no image URLs,
// so `refreshExpiredAssetImages` never needs further db methods.
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

  /** The archive-aware "returned booking" predicate a use is matched with. */
  const RETURNED = {
    OR: [
      { status: "COMPLETE" },
      { status: "ARCHIVED", archivedWithoutCheckin: false },
    ],
  };

  /** The `where` of the idle count (the count call that is not org-wide). */
  function idleCountWhere() {
    const call = vi
      .mocked(db.asset.count)
      .mock.calls.find(([args]) => "AND" in (args?.where ?? {}));
    return call?.[0]?.where;
  }

  /** The booking predicate a query uses to find each asset's last use. */
  function lastUseWhere(args: { select?: unknown } | undefined) {
    const select = args?.select as
      | { bookingAssets?: { where?: { booking?: unknown } } }
      | undefined;
    return select?.bookingAssets?.where?.booking;
  }

  it("finds the last use with the archive-aware predicate", async () => {
    // `currency` formats the Idle Value KPI string, which these assertions do
    // not read. Supplied because the report requires it.
    await idleAssetsReport({ organizationId: "org-1", currency: "USD" });

    // The rows and the KPIs each read the last use for display.
    const calls = vi.mocked(db.asset.findMany).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(lastUseWhere(args)).toEqual(RETURNED);
    }
  });

  it("leaves out assets returned from a booking on or after the cutoff", async () => {
    // why: The idle cutoff derives from the wall clock (`now - threshold`);
    // pinning `now` makes the cutoff exact.
    vi.useFakeTimers().setSystemTime(new Date("2026-08-26T12:00:00Z"));

    await idleAssetsReport({
      organizationId: "org-1",
      currency: "USD",
      idleThresholdDays: 30,
    });

    // Threshold 30d puts the cutoff at 2026-07-27T12:00:00Z.
    const where = idleCountWhere();
    expect(where?.AND).toContainEqual({
      NOT: {
        bookingAssets: {
          some: {
            booking: {
              AND: [
                RETURNED,
                { to: { gte: new Date("2026-07-27T12:00:00Z") } },
              ],
            },
          },
        },
      },
    });
    // Assets out on a booking right now are not idle either.
    expect(where?.AND).toContainEqual({
      NOT: {
        bookingAssets: {
          some: { booking: { status: { in: ["ONGOING", "OVERDUE"] } } },
        },
      },
    });
    expect(where?.AND).toContainEqual({ organizationId: "org-1" });
  });

  it("pages, counts and totals the same idle assets", async () => {
    vi.mocked(db.asset.count).mockResolvedValue(12);

    const result = await idleAssetsReport({
      organizationId: "org-1",
      currency: "USD",
      page: 3,
      pageSize: 5,
    });

    const [rowsCall, kpiCall] = vi.mocked(db.asset.findMany).mock.calls;
    const rowsArgs = rowsCall[0];
    // The page is cut from idle assets only, so it is full whenever the
    // count says more idle assets follow.
    expect(rowsArgs?.where).toEqual(idleCountWhere());
    expect(rowsArgs?.skip).toBe(10);
    expect(rowsArgs?.take).toBe(5);
    expect(kpiCall[0]?.where).toEqual(idleCountWhere());
    expect(result.totalRows).toBe(12);
  });

  it("returns every asset of the page the database answers", async () => {
    vi.mocked(db.asset.findMany).mockResolvedValue([
      idleAsset("asset-stale", "2026-05-01T00:00:00Z"),
      idleAsset("asset-never", null),
    ] as any);

    const result = await idleAssetsReport({
      organizationId: "org-1",
      currency: "USD",
    });

    expect(result.rows.map((r) => r.assetId)).toEqual([
      "asset-stale",
      "asset-never",
    ]);
    const totalIdle = result.kpis.find((k) => k.id === "total_idle");
    expect(totalIdle?.rawValue).toBe(2);
  });
});
