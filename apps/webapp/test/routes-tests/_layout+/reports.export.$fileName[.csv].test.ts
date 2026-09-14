/**
 * Route tests for the report CSV export loader.
 *
 * The report exports are the surface users open in Excel, so the assertions
 * here are about the bytes on the wire: a UTF-8 byte order mark and a
 * charset on the content type, which together are what make a non-Latin
 * workspace (Arabic category names, in the reported case) open as text
 * rather than mojibake.
 *
 * @see {@link file://../../../app/routes/_layout+/reports.export.$fileName[.csv].tsx}
 * @see {@link file://../../../app/utils/csv-utf8.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import {
  assetActivityReport,
  assetDistributionReport,
  assetInventoryReport,
  assetUtilizationReport,
  bookingComplianceReport,
  custodySnapshotReport,
  idleAssetsReport,
  monthlyBookingTrendsReport,
  overdueItemsReport,
  topBookedAssetsReport,
  topBookedKitsReport,
} from "~/modules/reports/helpers.server";
import type {
  AssetDistributionRow,
  MonthlyBookingTrendRow,
  ReportPayload,
  ResolvedTimeframe,
} from "~/modules/reports/types";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

// why: verifying export encoding without executing real permission checks
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the report builders query Prisma; the loader only needs their shape
vi.mock("~/modules/reports/helpers.server", () => ({
  resolveTimeframe: vi.fn(() => ({
    preset: "last_30d",
    from: new Date("2026-07-25T00:00:00.000Z"),
    to: new Date("2026-08-24T00:00:00.000Z"),
    label: "Last 30 days",
  })),
  assetDistributionReport: vi.fn(),
  bookingComplianceReport: vi.fn(),
  custodySnapshotReport: vi.fn(),
  overdueItemsReport: vi.fn(),
  idleAssetsReport: vi.fn(),
  topBookedAssetsReport: vi.fn(),
  topBookedKitsReport: vi.fn(),
  assetInventoryReport: vi.fn(),
  assetUtilizationReport: vi.fn(),
  assetActivityReport: vi.fn(),
  monthlyBookingTrendsReport: vi.fn(),
}));

// why: format prefs are resolved from the database for the acting user
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(() =>
    Promise.resolve({
      dateFormat: "MM/DD/YYYY",
      timeFormat: "12h",
      timeZone: "UTC",
      weekStartsOn: 0,
    })
  ),
}));

let loader: (typeof import("~/routes/_layout+/reports.export.$fileName[.csv]"))["loader"];

const requirePermissionMock = vi.mocked(requirePermission);
const assetDistributionReportMock = vi.mocked(assetDistributionReport);
const custodySnapshotReportMock = vi.mocked(custodySnapshotReport);
const assetInventoryReportMock = vi.mocked(assetInventoryReport);
const bookingComplianceReportMock = vi.mocked(bookingComplianceReport);

beforeAll(async () => {
  ({ loader } = await import(
    "~/routes/_layout+/reports.export.$fileName[.csv]"
  ));
});

describe("app/routes/_layout+/reports.export.$fileName[.csv] loader", () => {
  const context = {
    getSession: () => ({ userId: "user-123" }),
  } as LoaderFunctionArgs["context"];

  /** Arabic group names — the content the encoding has to survive. */
  const arabicBreakdown = {
    byCategory: [
      {
        id: "cat-1",
        groupName: "حاسوب محمول",
        assetCount: 12,
        percentage: 60,
        totalValue: 24000,
      },
    ],
    byLocation: [
      {
        id: "loc-1",
        groupName: "مستودع الرياض",
        assetCount: 8,
        percentage: 40,
        totalValue: 16000,
      },
    ],
    byStatus: [
      {
        id: "status-1",
        groupName: "Available",
        assetCount: 20,
        percentage: 100,
        totalValue: 40000,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      // The loader threads the workspace currency into the money-KPI-bearing
      // report functions, so the permission result must carry it.
      currentOrganization: { currency: "USD" },
    } as any);
    assetDistributionReportMock.mockResolvedValue({
      distributionBreakdown: arabicBreakdown,
    } as any);
  });

  const runLoader = () =>
    loader(
      createLoaderArgs({
        request: new Request(
          "http://localhost:3000/reports/export/distribution-last_30d-2026-08-24.csv?reportId=distribution"
        ),
        params: { fileName: "distribution-last_30d-2026-08-24" },
        context,
      })
    );

  it("serves the distribution CSV as UTF-8", async () => {
    const response = (await runLoader()) as unknown as Response;

    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.reports,
        action: PermissionAction.export,
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("content-disposition")).toContain(
      "distribution-last_30d-2026-08-24.csv"
    );

    // Read as bytes: `text()` decodes as UTF-8 and drops the mark, so only the
    // raw body shows what the browser writes to disk.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);

    const rows = (await response.text()).trim().split("\n");
    expect(rows[0]).toBe(
      "Breakdown Type,Group,Asset Count,Percentage,Total Valuation"
    );
    expect(rows[1]).toBe("Category,حاسوب محمول,12,60.0%,24000");
    expect(rows[2]).toBe("Location,مستودع الرياض,8,40.0%,16000");
  });

  /**
   * Every report case must hand the params its page-loader counterpart honors
   * to the same query function, or a filtered page silently exports the whole
   * workspace — the bug this table exists to keep fixed.
   *
   * The table is exhaustive over the loader's `switch`, and deliberately so:
   * the params are string literals matched by convention against
   * `reports.$reportId.tsx`, so a typo in one case is invisible to the
   * compiler and produces no error at runtime. Only an assertion per case can
   * catch it. Add a report to the switch, add a row here.
   *
   * @see {@link file://../../../app/routes/_layout+/reports.$reportId.tsx} the page loader whose params these mirror
   */
  describe("filter passthrough", () => {
    const exportUrl = (query: string) =>
      `http://localhost:3000/reports/export/report-2026-08-28.csv?${query}`;

    const runLoaderWith = (query: string) =>
      loader(
        createLoaderArgs({
          request: new Request(exportUrl(query)),
          params: { fileName: "report-2026-08-28" },
          context,
        })
      );

    const timeframe: ResolvedTimeframe = {
      preset: "last_30d",
      from: new Date("2026-07-25T00:00:00.000Z"),
      to: new Date("2026-08-24T00:00:00.000Z"),
      label: "Last 30 days",
    };

    /**
     * A payload thin enough for the loader to reach its CSV generator. The
     * assertions here are about the ARGUMENTS a report function receives, so
     * the rows it returns never matter.
     */
    const emptyPayload = <TRow>(): ReportPayload<TRow> => ({
      report: { id: "r", title: "R", description: "" },
      filters: { timeframe, filters: [] },
      kpis: [],
      rows: [],
      computedMs: 0,
      totalRows: 0,
      page: 1,
      pageSize: 10000,
    });

    type PassthroughCase = {
      /** `reportId` param, matching a case in the loader's switch. */
      reportId: string;
      /** Filter params as they would appear on the page's URL. */
      query: string;
      /** The query function those params must reach. */
      mock: Mock;
      /** The argument shape the loader must build from `query`. */
      expected: Record<string, unknown>;
    };

    const cases = (): PassthroughCase[] => [
      {
        reportId: "booking-compliance",
        query: "sortBy=custodian&sortOrder=asc",
        mock: vi.mocked(bookingComplianceReport),
        // Sort, not a filter: the CSV's row order has to match the table's.
        expected: { sortBy: "custodian", sortOrder: "asc" },
      },
      {
        reportId: "custody-snapshot",
        query: "teamMember=tm-1&location=loc-1",
        mock: vi.mocked(custodySnapshotReport),
        expected: {
          teamMemberId: "tm-1",
          locationId: "loc-1",
          currency: "USD",
        },
      },
      {
        reportId: "overdue-items",
        query: "custodian=cust-1",
        mock: vi.mocked(overdueItemsReport),
        expected: { custodianId: "cust-1", currency: "USD" },
      },
      {
        reportId: "idle-assets",
        query: "days=60&category=cat-1&location=loc-1",
        mock: vi.mocked(idleAssetsReport),
        expected: {
          idleThresholdDays: 60,
          categoryId: "cat-1",
          locationId: "loc-1",
          currency: "USD",
        },
      },
      {
        reportId: "top-booked-assets",
        query: "category=cat-1&location=loc-1",
        mock: vi.mocked(topBookedAssetsReport),
        expected: { categoryId: "cat-1", locationId: "loc-1" },
      },
      {
        reportId: "top-booked-kits",
        // No filter controls on this page, so the only contract is that the
        // export stays org-scoped. Listed rather than omitted: a row here is
        // how the next person knows the case was considered.
        query: "",
        mock: vi.mocked(topBookedKitsReport),
        expected: { organizationId: "org-1" },
      },
      {
        reportId: "asset-inventory",
        query:
          "categories=cat-1,cat-2&locations=loc-1&statuses=AVAILABLE,IN_CUSTODY",
        mock: vi.mocked(assetInventoryReport),
        expected: {
          categoryIds: ["cat-1", "cat-2"],
          locationIds: ["loc-1"],
          statuses: ["AVAILABLE", "IN_CUSTODY"],
          currency: "USD",
        },
      },
      {
        reportId: "asset-utilization",
        query: "category=cat-1&location=loc-1",
        mock: vi.mocked(assetUtilizationReport),
        expected: { categoryId: "cat-1", locationId: "loc-1" },
      },
      {
        reportId: "asset-activity",
        query: "asset=asset-1&category=cat-1",
        mock: vi.mocked(assetActivityReport),
        expected: { assetId: "asset-1", categoryId: "cat-1" },
      },
      {
        reportId: "distribution",
        query: "",
        mock: vi.mocked(assetDistributionReport),
        expected: { organizationId: "org-1", currency: "USD" },
      },
    ];

    beforeEach(() => {
      for (const { mock } of cases()) {
        mock.mockResolvedValue(emptyPayload());
      }
      // Distribution builds its CSV from a breakdown rather than from rows.
      vi.mocked(assetDistributionReport).mockResolvedValue({
        ...emptyPayload<AssetDistributionRow>(),
        distributionBreakdown: arabicBreakdown,
      });
    });

    it.each(cases())(
      "$reportId forwards the page's params to its query function",
      async ({ reportId, query, mock, expected }) => {
        await runLoaderWith(
          query ? `reportId=${reportId}&${query}` : `reportId=${reportId}`
        );

        expect(mock).toHaveBeenCalledWith(expect.objectContaining(expected));
      }
    );

    it("reads the workspace currency rather than assuming the default", async () => {
      requirePermissionMock.mockResolvedValue({
        organizationId: "org-1",
        currentOrganization: { currency: "EUR" },
      } as Awaited<ReturnType<typeof requirePermission>>);

      await runLoaderWith("reportId=custody-snapshot&teamMember=tm-1");

      expect(custodySnapshotReportMock).toHaveBeenCalledWith(
        expect.objectContaining({ currency: "EUR" })
      );
    });

    it("drops monthly-trends' category and location rather than claiming to filter on them", async () => {
      // `monthlyBookingTrendsReport` accepts both and uses neither. Forwarding
      // them would advertise a filtering this export does not perform, so the
      // loader deliberately omits them — pinned here so a later "consistency"
      // edit has to confront the dead argument first.
      vi.mocked(monthlyBookingTrendsReport).mockResolvedValue(
        emptyPayload<MonthlyBookingTrendRow>()
      );

      await runLoaderWith(
        "reportId=monthly-booking-trends&category=cat-1&location=loc-1"
      );

      // Establish the call before reading it. The assertions below are
      // NEGATIVE, so a report function that was never reached has to fail as
      // "expected 1 call, got 0" rather than as a TypeError on `calls[0]` —
      // and must never be mistaken for the absence it is checking for.
      expect(monthlyBookingTrendsReport).toHaveBeenCalledTimes(1);

      const args = vi.mocked(monthlyBookingTrendsReport).mock.calls[0][0];
      expect(args).not.toHaveProperty("categoryId");
      expect(args).not.toHaveProperty("locationId");
    });
  });
});
