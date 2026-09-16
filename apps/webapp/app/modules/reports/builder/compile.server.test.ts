/**
 * Report builder compiler: SQL shape and result shaping.
 *
 * The SQL assertions read the query text, which is the only thing a unit
 * test can check about raw SQL: the mapped column names, the status
 * exclusions, the scoping, and that no user text ever lands in the
 * statement. Behaviour against real data is covered by the browser proof in
 * the PR.
 *
 * @see {@link file://./compile.server.ts}
 */

import { CustomFieldType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the compiler runs two raw queries and a few name lookups; fixed
// results keep the shaping rules, not Prisma, under test.
vi.mock("~/database/db.server", () => ({
  db: {
    $queryRaw: vi.fn(),
    category: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
    assetModel: { findMany: vi.fn() },
    kit: { findMany: vi.fn() },
    teamMember: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

import { db } from "~/database/db.server";
import { buildReportAssetFilter } from "../asset-filter";
import type { ResolvedTimeframe } from "../types";
import { compileBuilderQueries, runBuilderReport } from "./compile.server";
import type { BuilderSpec } from "./spec";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-08-17T00:00:00Z"),
  to: new Date("2026-09-16T23:59:59Z"),
};

const EMPTY_FILTER = buildReportAssetFilter({});

function compile(spec: BuilderSpec, filter = EMPTY_FILTER) {
  const { grouped, totals } = compileBuilderQueries({
    organizationId: "org-1",
    spec,
    timeframe: TIMEFRAME,
    timeZone: "Europe/Amsterdam",
    assetFilter: filter,
  });
  return { grouped: grouped.sql, totals: totals.sql, values: grouped.values };
}

describe("compileBuilderQueries", () => {
  it("scopes every dataset to the workspace and reads the mapped `value` column", () => {
    for (const dataset of ["assets", "bookings", "custody"] as const) {
      const { grouped, totals, values } = compile({
        dataset,
        groupBy: "category",
        customFieldId: null,
        measure:
          dataset === "assets"
            ? "totalValue"
            : dataset === "bookings"
            ? "bookingCount"
            : "totalValue",
      });
      expect(grouped).toContain('"organizationId" =');
      expect(totals).toContain('"organizationId" =');
      expect(values).toContain("org-1");
      // Asset.valuation is @map("value"); the Prisma field name must never appear.
      expect(grouped).not.toContain("valuation");
      if (dataset !== "bookings") {
        // The money measures read the mapped column; bookings have none.
        expect(grouped).toContain("COALESCE(a.value, 0)");
      }
    }
  });

  it("excludes draft and cancelled bookings and overlaps the period", () => {
    const { grouped, values } = compile({
      dataset: "bookings",
      groupBy: "month",
      customFieldId: null,
      measure: "bookingCount",
    });

    expect(grouped).toContain(`b.status::text NOT IN ('DRAFT', 'CANCELLED')`);
    expect(grouped).toContain(`b."from" <=`);
    expect(grouped).toContain(`b."to" >=`);
    expect(values).toContain(TIMEFRAME.from);
    expect(values).toContain(TIMEFRAME.to);
    // Month buckets in the user's zone, never the server's.
    expect(grouped).toContain("AT TIME ZONE");
    expect(values).toContain("Europe/Amsterdam");
  });

  it("counts one asset on one booking once, across its slices", () => {
    const { grouped } = compile({
      dataset: "bookings",
      groupBy: "category",
      customFieldId: null,
      measure: "assetsBooked",
    });

    // Slices collapse to (booking, asset) before anything is counted.
    expect(grouped).toContain(`GROUP BY ba."bookingId", ba."assetId"`);
    expect(grouped).toContain("COUNT(DISTINCT booking_id)");
    expect(grouped).toContain("COUNT(DISTINCT asset_id)");
  });

  it("passes the custom field id as a parameter, never as text", () => {
    const { grouped, values } = compile({
      dataset: "assets",
      groupBy: "customField",
      customFieldId: "cf-perkins",
      measure: "assetCount",
    });

    expect(grouped).toContain(`v.value->>'raw'`);
    expect(grouped).not.toContain("cf-perkins");
    expect(values).toContain("cf-perkins");
  });

  it("uses units at the location and units in the kit for those groupings", () => {
    const byLocation = compile({
      dataset: "assets",
      groupBy: "location",
      customFieldId: null,
      measure: "units",
    }).grouped;
    const byKit = compile({
      dataset: "assets",
      groupBy: "kit",
      customFieldId: null,
      measure: "units",
    }).grouped;

    expect(byLocation).toContain(`LEFT JOIN "AssetLocation" al`);
    expect(byLocation).toContain(
      "COALESCE(al.quantity, COALESCE(a.quantity, 1))"
    );
    expect(byKit).toContain(`LEFT JOIN "AssetKit" ak`);
    expect(byKit).toContain("COALESCE(ak.quantity, COALESCE(a.quantity, 1))");
  });

  it("carries the shared report filters into the asset CTE", () => {
    const filter = buildReportAssetFilter({
      categoryIds: ["cat-1"],
      customFieldValues: [
        { customFieldId: "cf-1", value: "yes", type: CustomFieldType.TEXT },
      ],
    });
    const { grouped, values } = compile(
      {
        dataset: "custody",
        groupBy: "custodian",
        customFieldId: null,
        measure: "custodyCount",
      },
      filter
    );

    expect(grouped).toContain('"categoryId" IN');
    expect(grouped).toContain("value->>'raw' =");
    expect(values).toContain("cat-1");
    expect(values).toContain("yes");
    expect(grouped).not.toContain("cat-1");
  });

  it("orders by the chosen measure and caps the group count", () => {
    const { grouped } = compile({
      dataset: "custody",
      groupBy: "assetModel",
      customFieldId: null,
      measure: "avgDaysInCustody",
    });

    expect(grouped).toContain(`ORDER BY "avgDaysInCustody" DESC NULLS LAST`);
    expect(grouped).toContain("LIMIT");
  });
});

describe("runBuilderReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.category.findMany).mockResolvedValue([
      { id: "cat-1", name: "Cameras" },
    ] as any);
  });

  it("shapes rows, share, KPIs and the chart from the two queries", async () => {
    vi.mocked(db.$queryRaw)
      // grouped
      .mockResolvedValueOnce([
        { key: "cat-1", assetCount: 6, units: 6, totalValue: 600 },
        { key: null, assetCount: 2, units: 5, totalValue: 0 },
      ] as any)
      // totals
      .mockResolvedValueOnce([
        { groupCount: 2, assetCount: 8, units: 11, totalValue: 600 },
      ] as any);

    const result = await runBuilderReport({
      organizationId: "org-1",
      spec: {
        dataset: "assets",
        groupBy: "category",
        customFieldId: null,
        measure: "assetCount",
      },
      timeframe: TIMEFRAME,
      timeZone: "UTC",
      assetFilter: EMPTY_FILTER,
      currency: "USD",
      customField: null,
    });

    expect(result.rows).toEqual([
      {
        id: "cat-1",
        groupName: "Cameras",
        value: 6,
        share: 75,
        measures: { assetCount: 6, units: 6, totalValue: 600 },
      },
      {
        id: "none",
        groupName: "No category",
        value: 2,
        share: 25,
        measures: { assetCount: 2, units: 5, totalValue: 0 },
      },
    ]);
    expect(result.kpis.map((k) => [k.id, k.value])).toEqual([
      ["total_assetCount", "8"],
      ["groups", "2"],
      ["top_group", "Cameras"],
    ]);
    expect(result.kpis[2].delta).toBe("75%");
    expect(result.chartSeries[0].data).toEqual([
      { date: "Cameras", value: 6 },
      { date: "No category", value: 2 },
    ]);
    expect(result.truncated).toBe(false);
    // Names are looked up org-scoped, only for the keys that appeared.
    expect(db.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["cat-1"] }, organizationId: "org-1" },
      })
    );
  });

  it("falls back to the dataset's first grouping when the custom field is not verified", async () => {
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ groupCount: 0 }] as any);

    const result = await runBuilderReport({
      organizationId: "org-1",
      spec: {
        dataset: "assets",
        groupBy: "customField",
        customFieldId: "cf-foreign",
        measure: "assetCount",
      },
      timeframe: TIMEFRAME,
      timeZone: "UTC",
      assetFilter: EMPTY_FILTER,
      currency: "USD",
      customField: null,
    });

    expect(result.spec.groupBy).toBe("category");
    expect(result.spec.customFieldId).toBeNull();
    expect(result.rows).toEqual([]);
    expect(result.chartSeries).toEqual([]);
  });

  it("leaves share empty for an average measure and formats it in days", async () => {
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([
        {
          key: "cat-1",
          custodyCount: 3,
          custodyUnits: 3,
          totalValue: 90,
          avgDaysInCustody: 12.34,
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          groupCount: 1,
          custodyCount: 3,
          custodyUnits: 3,
          totalValue: 90,
          avgDaysInCustody: 12.34,
        },
      ] as any);

    const result = await runBuilderReport({
      organizationId: "org-1",
      spec: {
        dataset: "custody",
        groupBy: "category",
        customFieldId: null,
        measure: "avgDaysInCustody",
      },
      timeframe: TIMEFRAME,
      timeZone: "UTC",
      assetFilter: EMPTY_FILTER,
      currency: "USD",
      customField: null,
    });

    expect(result.rows[0].share).toBeNull();
    expect(result.kpis[0].value).toBe("12.3 days");
  });

  it("resolves booking custodians from team members and users", async () => {
    vi.mocked(db.$queryRaw)
      .mockResolvedValueOnce([
        {
          key: "tm-1",
          bookingCount: 4,
          assetsBooked: 2,
          unitsBooked: 4,
          daysBooked: 9,
        },
        {
          key: "user:u-1",
          bookingCount: 1,
          assetsBooked: 1,
          unitsBooked: 1,
          daysBooked: 2,
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          groupCount: 2,
          bookingCount: 5,
          assetsBooked: 3,
          unitsBooked: 5,
          daysBooked: 11,
        },
      ] as any);
    vi.mocked(db.teamMember.findMany).mockResolvedValue([
      { id: "tm-1", name: "Sam Stone", user: null },
    ] as any);
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: "u-1", firstName: "Ada", lastName: "Lovelace", displayName: null },
    ] as any);

    const result = await runBuilderReport({
      organizationId: "org-1",
      spec: {
        dataset: "bookings",
        groupBy: "custodian",
        customFieldId: null,
        measure: "bookingCount",
      },
      timeframe: TIMEFRAME,
      timeZone: "UTC",
      assetFilter: EMPTY_FILTER,
      currency: "USD",
      customField: null,
    });

    expect(result.rows.map((r) => r.groupName)).toEqual([
      "Sam Stone",
      "Ada Lovelace",
    ]);
    expect(db.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["u-1"] },
          userOrganizations: { some: { organizationId: "org-1" } },
        },
      })
    );
  });
});
