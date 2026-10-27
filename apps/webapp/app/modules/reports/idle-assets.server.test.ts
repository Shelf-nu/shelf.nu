/**
 * Idle Assets Report: Idle Predicate Tests
 *
 * Covers the public `idleAssetsReport` function: that the rows and the KPIs
 * (whose total is the row count) select idle assets with one database
 * predicate, so a page holds as many rows as the pager says. A "use" is the
 * asset's own slice going out on an archive-aware returned booking (archiving
 * rewrites a COMPLETE booking's status to ARCHIVED, so matching COMPLETE alone
 * would make assets look idle the moment their last booking ages into the
 * archive); a recent use is one on a booking ending on or after the cutoff;
 * and "out right now" is the asset's slice, not the booking's status.
 *
 * @see {@link file://./helpers.server.ts}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// why: Mock the Prisma client so the unit tests never touch a real database.
// Matches the pattern in `top-booked-kits.server.test.ts`. The rows and the
// KPIs (whose total is also the row count) read assets via
// `db.asset.findMany`; the KPIs' whole-org denominator uses `db.asset.count`.
// Fixtures carry no image URLs, so `refreshExpiredAssetImages` never needs
// further db methods.
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

  /** A use: the asset's slice went out on an archive-aware returned booking. */
  const RETURNED_USE = {
    checkedOutAt: { not: null },
    booking: {
      OR: [
        { status: "COMPLETE" },
        { status: "ARCHIVED", archivedWithoutCheckin: false },
      ],
    },
  };

  /** The `where` of the rows read and of the KPI read, in that order. */
  function idleReadWheres() {
    const [rowsCall, kpiCall] = vi.mocked(db.asset.findMany).mock.calls;
    return [rowsCall?.[0]?.where, kpiCall?.[0]?.where];
  }

  /** The slice predicate a query uses to find each asset's last use. */
  function lastUseWhere(args: { select?: unknown } | undefined) {
    const select = args?.select as
      | { bookingAssets?: { where?: unknown } }
      | undefined;
    return select?.bookingAssets?.where;
  }

  it("finds the last use with the archive-aware predicate", async () => {
    // `currency` formats the Idle Value KPI string, which these assertions do
    // not read. Supplied because the report requires it.
    await idleAssetsReport({ organizationId: "org-1", currency: "USD" });

    // The rows and the KPIs each read the last use for display.
    const calls = vi.mocked(db.asset.findMany).mock.calls;
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(lastUseWhere(args)).toEqual(RETURNED_USE);
    }
  });

  it("leaves out assets used on a booking ending on or after the cutoff", async () => {
    // why: The idle cutoff derives from the wall clock (`now - threshold`);
    // pinning `now` makes the cutoff exact.
    vi.useFakeTimers().setSystemTime(new Date("2026-08-26T12:00:00Z"));

    await idleAssetsReport({
      organizationId: "org-1",
      currency: "USD",
      idleThresholdDays: 30,
    });

    // Threshold 30d puts the cutoff at 2026-07-27T12:00:00Z.
    const [where] = idleReadWheres();
    expect(where?.AND).toContainEqual({
      NOT: {
        bookingAssets: {
          some: {
            AND: [
              RETURNED_USE,
              { booking: { to: { gte: new Date("2026-07-27T12:00:00Z") } } },
            ],
          },
        },
      },
    });
    // An asset whose own slice is out on a running booking is not idle. One
    // checked back in, or never checked out, on that booking is.
    expect(where?.AND).toContainEqual({
      NOT: {
        bookingAssets: {
          some: {
            checkedOutAt: { not: null },
            checkedInAt: null,
            booking: { status: { in: ["ONGOING", "OVERDUE"] } },
          },
        },
      },
    });
    expect(where?.AND).toContainEqual({ organizationId: "org-1" });
  });

  it("pages, counts and totals the same idle assets", async () => {
    // The KPI read answers every idle asset; its length is the row count.
    vi.mocked(db.asset.findMany).mockImplementation(((args: {
      take?: number;
    }) =>
      Promise.resolve(
        args?.take === undefined
          ? Array.from({ length: 12 }, (_, i) => idleAsset(`asset-${i}`, null))
          : []
      )) as any);

    const result = await idleAssetsReport({
      organizationId: "org-1",
      currency: "USD",
      page: 3,
      pageSize: 5,
    });

    const [rowsWhere, kpiWhere] = idleReadWheres();
    const rowsArgs = vi.mocked(db.asset.findMany).mock.calls[0][0];
    // The page is cut from idle assets only, so it is full whenever the
    // count says more idle assets follow.
    expect(rowsWhere).toEqual(kpiWhere);
    expect(rowsArgs?.skip).toBe(10);
    expect(rowsArgs?.take).toBe(5);
    expect(result.totalRows).toBe(12);
    const totalIdle = result.kpis.find((k) => k.id === "total_idle");
    expect(totalIdle?.rawValue).toBe(12);
  });

  it("returns every asset of the page the database answers", async () => {
    // why: pinning `now` places the recent use after the 30-day cutoff.
    vi.useFakeTimers().setSystemTime(new Date("2026-08-26T12:00:00Z"));
    vi.mocked(db.asset.findMany).mockResolvedValue([
      idleAsset("asset-stale", "2026-05-01T00:00:00Z"),
      idleAsset("asset-never", null),
      // A use after the cutoff: the database predicate decides idleness, so
      // the report keeps whatever rows the query answers.
      idleAsset("asset-recent", "2026-08-20T00:00:00Z"),
    ] as any);

    const result = await idleAssetsReport({
      organizationId: "org-1",
      currency: "USD",
      idleThresholdDays: 30,
    });

    expect(result.rows.map((r) => r.assetId)).toEqual([
      "asset-stale",
      "asset-never",
      "asset-recent",
    ]);
  });
});
