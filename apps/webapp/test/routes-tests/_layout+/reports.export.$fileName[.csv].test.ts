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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import {
  assetDistributionReport,
  assetInventoryReport,
  bookingComplianceReport,
  custodySnapshotReport,
} from "~/modules/reports/helpers.server";
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
   * The export endpoint receives the page's full query string (the client
   * forwards every current search param), and each report case must hand the
   * params its page-loader counterpart honors to the same query function —
   * otherwise a filtered page silently exports the unfiltered workspace.
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

    it("forwards the custody-snapshot page filters and workspace currency", async () => {
      requirePermissionMock.mockResolvedValue({
        organizationId: "org-1",
        currentOrganization: { currency: "EUR" },
      } as any);
      custodySnapshotReportMock.mockResolvedValue({ rows: [] } as any);

      await runLoaderWith(
        "reportId=custody-snapshot&teamMember=tm-1&location=loc-1"
      );

      expect(custodySnapshotReportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          teamMemberId: "tm-1",
          locationId: "loc-1",
          currency: "EUR",
        })
      );
    });

    it("forwards the asset-inventory page filters", async () => {
      assetInventoryReportMock.mockResolvedValue({ rows: [] } as any);

      await runLoaderWith(
        "reportId=asset-inventory&categories=cat-1,cat-2&locations=loc-1&statuses=AVAILABLE,IN_CUSTODY"
      );

      expect(assetInventoryReportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          categoryIds: ["cat-1", "cat-2"],
          locationIds: ["loc-1"],
          statuses: ["AVAILABLE", "IN_CUSTODY"],
          currency: "USD",
        })
      );
    });

    it("forwards the booking-compliance sort so CSV row order matches the page", async () => {
      bookingComplianceReportMock.mockResolvedValue({ rows: [] } as any);

      await runLoaderWith(
        "reportId=booking-compliance&sortBy=custodian&sortOrder=asc"
      );

      expect(bookingComplianceReportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: "custodian",
          sortOrder: "asc",
        })
      );
    });
  });
});
