/**
 * Report Filter Plumbing Tests
 *
 * Pins that the filter bar's resolved filters reach every query a report runs:
 * the table rows, the headline KPIs and the charts. A query that drops the
 * filter still returns a plausible number, so these assert on the `where`
 * each query receives rather than on the rendered figures.
 *
 * @see {@link file://./helpers.server.ts}
 * @see {@link file://./asset-filter.ts}
 */

import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the reports run Prisma queries; these cases only inspect the predicate
// each query is handed, so every member answers with an empty result.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findMany: vi.fn(), count: vi.fn() },
    custody: { findMany: vi.fn(), count: vi.fn() },
    asset: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    activityEvent: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { db } from "~/database/db.server";

import { buildReportAssetFilter } from "./asset-filter";
import {
  assetActivityReport,
  assetUtilizationReport,
  bookingComplianceReport,
  custodySnapshotReport,
  idleAssetsReport,
  monthlyBookingTrendsReport,
  overdueItemsReport,
} from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const ORG = "org-1";
const TEAM_MEMBER = "tm-1";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
};

/** A category filter, the simplest predicate that is easy to spot in a `where`. */
const CATEGORY_FILTER = buildReportAssetFilter({ categoryIds: ["cat-1"] });

/** True when `value` (a Prisma args object) mentions the category filter. */
function carriesCategoryFilter(value: unknown): boolean {
  return JSON.stringify(value).includes('"categoryId":{"in":["cat-1"]}');
}

/**
 * A `$queryRaw` call as one `Prisma.Sql`, whether it was made as a tagged
 * template (whose nested fragments arrive as values) or with `Prisma.sql`.
 */
function rawSql(call: unknown[]): Prisma.Sql {
  const [first, ...values] = call;
  if (Array.isArray(first)) {
    return Prisma.sql(first as unknown as TemplateStringsArray, ...values);
  }
  return first as Prisma.Sql;
}

/** The SQL text of a `$queryRaw` call. */
function rawSqlText(call: unknown[]): string {
  return rawSql(call).sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.booking.findMany).mockResolvedValue([]);
  vi.mocked(db.booking.count).mockResolvedValue(0);
  vi.mocked(db.custody.findMany).mockResolvedValue([]);
  vi.mocked(db.custody.count).mockResolvedValue(0);
  vi.mocked(db.asset.findMany).mockResolvedValue([]);
  vi.mocked(db.asset.findFirst).mockResolvedValue(null);
  vi.mocked(db.asset.count).mockResolvedValue(0);
  vi.mocked(db.activityEvent.findMany).mockResolvedValue([]);
  vi.mocked(db.activityEvent.count).mockResolvedValue(0);
  // why: `groupBy`'s overloads cannot be satisfied by a plain array literal.
  vi.mocked(db.activityEvent.groupBy).mockResolvedValue([] as never);
  vi.mocked(db.$queryRaw).mockResolvedValue([]);
});

describe("custodySnapshotReport", () => {
  it("narrows the headline KPIs with the same asset filter as the rows", async () => {
    await custodySnapshotReport({
      organizationId: ORG,
      currency: "USD",
      assetFilter: CATEGORY_FILTER,
    });

    const calls = vi.mocked(db.custody.findMany).mock.calls;
    // One read for the page of rows, one for the KPIs.
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(carriesCategoryFilter(args)).toBe(true);
      // The workspace scope must survive alongside the filter.
      expect(JSON.stringify(args)).toContain(`"organizationId":"${ORG}"`);
    }
    expect(
      carriesCategoryFilter(vi.mocked(db.custody.count).mock.calls[0])
    ).toBe(true);
  });
});

describe("bookingComplianceReport", () => {
  it("applies the custodian and asset filters to the rate, trend and custodian table", async () => {
    await bookingComplianceReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      custodianTeamMemberId: TEAM_MEMBER,
      assetFilter: CATEGORY_FILTER,
    });

    // Rows, current rate, prior rate, trend, custodian performance, and the
    // booking ids that scope the status chart.
    const calls = vi.mocked(db.booking.findMany).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const [args] of calls) {
      const text = JSON.stringify(args);
      expect(carriesCategoryFilter(args)).toBe(true);
      expect(text).toContain(`"custodianTeamMemberId":"${TEAM_MEMBER}"`);
    }
  });

  it("scopes the status-transition chart to the filtered bookings", async () => {
    vi.mocked(db.booking.findMany).mockImplementation(((args: {
      select?: Record<string, unknown>;
    }) =>
      Promise.resolve(
        // The id-only read that scopes the chart answers with one booking.
        args?.select && Object.keys(args.select).join() === "id"
          ? [{ id: "booking-1" }]
          : []
      )) as never);

    await bookingComplianceReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      assetFilter: CATEGORY_FILTER,
    });

    const chartCall = vi
      .mocked(db.$queryRaw)
      .mock.calls.find((call) =>
        rawSqlText(call).includes("BOOKING_STATUS_CHANGED")
      );
    expect(chartCall).toBeDefined();
    expect(rawSqlText(chartCall!)).toContain('"bookingId" = ANY(');
    expect(rawSql(chartCall!).values).toContainEqual(["booking-1"]);
  });

  it("leaves the status chart workspace-wide when nothing narrows", async () => {
    await bookingComplianceReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
    });

    const chartCall = vi
      .mocked(db.$queryRaw)
      .mock.calls.find((call) =>
        rawSqlText(call).includes("BOOKING_STATUS_CHANGED")
      );
    expect(rawSqlText(chartCall!)).not.toContain('"bookingId"');
  });
});

describe("overdueItemsReport", () => {
  it("matches a team-member custodian or the user behind it, inside the workspace", async () => {
    await overdueItemsReport({
      organizationId: ORG,
      currency: "USD",
      custodianTeamMemberId: TEAM_MEMBER,
    });

    const [args] = vi.mocked(db.booking.findMany).mock.calls[0] as [
      { where: { AND: unknown[]; bookingAssets?: unknown } },
    ];
    expect(args.where.AND).toContainEqual({
      OR: [
        { custodianTeamMemberId: TEAM_MEMBER },
        {
          custodianUser: {
            teamMembers: { some: { id: TEAM_MEMBER, organizationId: ORG } },
          },
        },
      ],
    });
    // Nothing narrows the assets, so no pivot join is added.
    expect(args.where.bookingAssets).toBeUndefined();
  });

  it("keeps the bookings holding at least one matching asset", async () => {
    await overdueItemsReport({
      organizationId: ORG,
      currency: "USD",
      assetFilter: CATEGORY_FILTER,
    });

    const [args] = vi.mocked(db.booking.findMany).mock.calls[0] as [
      { where: { bookingAssets: { some: { asset: unknown } } } },
    ];
    expect(carriesCategoryFilter(args.where.bookingAssets.some.asset)).toBe(
      true
    );
    expect(JSON.stringify(args.where.bookingAssets.some.asset)).toContain(
      `"organizationId":"${ORG}"`
    );
  });
});

describe("monthlyBookingTrendsReport", () => {
  it("keeps matching bookings and counts only their matching assets", async () => {
    await monthlyBookingTrendsReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      assetFilter: CATEGORY_FILTER,
    });

    const [args] = vi.mocked(db.booking.findMany).mock.calls[0] as [
      {
        where: { bookingAssets: { some: { asset: unknown } } };
        select: { bookingAssets: { where?: { asset: unknown } } };
      },
    ];
    expect(carriesCategoryFilter(args.where.bookingAssets.some.asset)).toBe(
      true
    );
    // A booking with 1 matching asset and 9 others adds 1 unique asset, not 10.
    expect(carriesCategoryFilter(args.select.bookingAssets.where?.asset)).toBe(
      true
    );
  });

  it("counts every asset of a booking when nothing narrows", async () => {
    await monthlyBookingTrendsReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
    });

    const [args] = vi.mocked(db.booking.findMany).mock.calls[0] as [
      { select: { bookingAssets: unknown } },
    ];
    expect(args.select.bookingAssets).toEqual({ select: { assetId: true } });
  });
});

describe("idleAssetsReport and assetUtilizationReport", () => {
  it("narrows the idle rows and the KPI read that also gives the idle count", async () => {
    await idleAssetsReport({
      organizationId: ORG,
      currency: "USD",
      assetFilter: CATEGORY_FILTER,
    });

    const calls = vi.mocked(db.asset.findMany).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [args] of calls) {
      expect(carriesCategoryFilter(args)).toBe(true);
    }
  });

  it("narrows the utilization asset read", async () => {
    await assetUtilizationReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      assetFilter: CATEGORY_FILTER,
    });

    const [args] = vi.mocked(db.asset.findMany).mock.calls[0];
    expect(carriesCategoryFilter(args)).toBe(true);
  });
});

describe("assetActivityReport", () => {
  it("narrows events through a subquery instead of loading every matching asset id", async () => {
    await assetActivityReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
      assetFilter: CATEGORY_FILTER,
    });

    // No id-only read of the matching assets: on a large workspace that list
    // has no upper bound and can pass Postgres' bind-parameter limit.
    const idOnlyAssetReads = vi
      .mocked(db.asset.findMany)
      .mock.calls.filter(([args]) => carriesCategoryFilter(args));
    expect(idOnlyAssetReads).toEqual([]);

    const sql = vi.mocked(db.$queryRaw).mock.calls.map(rawSqlText).join("\n");
    expect(sql).toContain('FROM "ActivityEvent"');
    expect(sql).toContain('FROM "Asset"');
    expect(sql).toContain('"categoryId" IN');
  });

  it("keeps the plain Prisma path when nothing narrows", async () => {
    await assetActivityReport({ organizationId: ORG, timeframe: TIMEFRAME });

    expect(db.activityEvent.findMany).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
