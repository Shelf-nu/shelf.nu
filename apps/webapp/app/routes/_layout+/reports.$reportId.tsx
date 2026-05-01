/**
 * Report Runner Route
 *
 * Dynamic route that renders a specific report based on the reportId param.
 * The route owns three concerns:
 *   1. Permission + data loading via the per-report `*Report` server helpers.
 *   2. The page chrome (header, export buttons, timeframe filter bar, footer).
 *   3. Dispatch to the right Content component based on `reportId`.
 *
 * Each report's UI lives in its own `*-content.tsx` file under
 * `~/components/reports/` (one component per file, matching the existing
 * shelf convention for that folder). This keeps the route file thin and
 * lets each report evolve independently.
 *
 * @see {@link file://../../modules/reports/registry.ts}
 * @see {@link file://../../modules/reports/helpers.server.ts}
 * @see {@link file://../../components/reports/index.ts}
 */

import { useCallback, useState } from "react";
import { useSetAtom } from "jotai";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData, useNavigate, useNavigation } from "react-router";

import { showNotificationAtom } from "~/atoms/notifications";
import Header from "~/components/layout/header";
import {
  AssetActivityContent,
  AssetDistributionContent,
  AssetInventoryContent,
  AssetUtilizationContent,
  BookingComplianceContent,
  CustodySnapshotContent,
  IdleAssetsContent,
  IdleThresholdSelector,
  MonthlyBookingTrendsContent,
  OverdueItemsContent,
  ReportEmptyState,
  ReportFooter,
  ReportPdf,
  TimeframePicker,
  TimeframeRangeIndicator,
  TopBookedAssetsContent,
} from "~/components/reports";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import {
  resolveTimeframe,
  bookingComplianceReport,
  overdueItemsReport,
  idleAssetsReport,
  custodySnapshotReport,
  topBookedAssetsReport,
  assetDistributionReport,
  assetInventoryReport,
  monthlyBookingTrendsReport,
  assetUtilizationReport,
  assetActivityReport,
  type BookingComplianceSortColumn,
} from "~/modules/reports/helpers.server";
import { getReportById } from "~/modules/reports/registry";
import type {
  AssetActivityRow,
  AssetInventoryRow,
  AssetUtilizationRow,
  BookingComplianceRow,
  ChartSeries,
  CustodySnapshotRow,
  DistributionBreakdown,
  IdleAssetRow,
  MonthlyBookingTrendRow,
  OverdueItemRow,
  ReportPayload,
  TimeframePreset,
  TopBookedAssetRow,
} from "~/modules/reports/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.report?.title || "Report") },
];

/**
 * Adds the report-specific name to the breadcrumb trail (e.g.
 * "Reports > Top Booked Assets"). The parent `reports.tsx` layout supplies
 * the leading "Reports" crumb.
 */
export const handle = {
  breadcrumb: (match: { data?: { report?: { title?: string } } }) =>
    match?.data?.report?.title || "Report",
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { reportId } = params;
  if (!reportId) {
    throw new ShelfError({
      cause: null,
      message: "Report ID is required",
      label: "Report",
    });
  }

  // Validate report exists and is enabled
  const reportDef = getReportById(reportId);
  if (!reportDef) {
    throw new ShelfError({
      cause: null,
      message: `Report "${reportId}" not found`,
      label: "Report",
      status: 404,
    });
  }

  if (!reportDef.enabled) {
    throw new ShelfError({
      cause: null,
      message: `Report "${reportDef.title}" is not yet available`,
      label: "Report",
      status: 403,
    });
  }

  // Check permissions
  const { organizationId } = await requirePermission({
    userId,
    request,
    entity: PermissionEntity.asset,
    action: PermissionAction.read,
  });

  // Parse search params for filters
  const url = new URL(request.url);
  const timeframePreset =
    (url.searchParams.get("timeframe") as TimeframePreset) || "last_30d";
  const customFrom = url.searchParams.get("from");
  const customTo = url.searchParams.get("to");

  const timeframe = resolveTimeframe(
    timeframePreset,
    customFrom ? new Date(customFrom) : undefined,
    customTo ? new Date(customTo) : undefined
  );

  // Load report data based on report ID
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reportData: ReportPayload<any>;

  switch (reportId) {
    case "booking-compliance": {
      // Parse sort params for server-side sorting
      const sortBy = (url.searchParams.get("sortBy") ||
        "scheduledEnd") as BookingComplianceSortColumn;
      const sortOrder = (url.searchParams.get("sortOrder") || "desc") as
        | "asc"
        | "desc";
      reportData = await bookingComplianceReport({
        organizationId,
        timeframe,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
        sortBy,
        sortOrder,
      });
      break;
    }

    case "overdue-items":
      reportData = await overdueItemsReport({
        organizationId,
        custodianId: url.searchParams.get("custodian") || undefined,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
      });
      break;

    case "idle-assets":
      reportData = await idleAssetsReport({
        organizationId,
        idleThresholdDays: parseInt(url.searchParams.get("days") || "30", 10),
        categoryId: url.searchParams.get("category") || undefined,
        locationId: url.searchParams.get("location") || undefined,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
      });
      break;

    case "custody-snapshot":
      reportData = await custodySnapshotReport({
        organizationId,
        teamMemberId: url.searchParams.get("teamMember") || undefined,
        locationId: url.searchParams.get("location") || undefined,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
      });
      break;

    case "top-booked-assets":
      reportData = await topBookedAssetsReport({
        organizationId,
        timeframe,
        categoryId: url.searchParams.get("category") || undefined,
        locationId: url.searchParams.get("location") || undefined,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
      });
      break;

    case "distribution":
      reportData = await assetDistributionReport({
        organizationId,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
      });
      break;

    case "asset-inventory":
      reportData = await assetInventoryReport({
        organizationId,
        categoryIds:
          url.searchParams.get("categories")?.split(",").filter(Boolean) ||
          undefined,
        locationIds:
          url.searchParams.get("locations")?.split(",").filter(Boolean) ||
          undefined,
        statuses:
          url.searchParams.get("statuses")?.split(",").filter(Boolean) ||
          undefined,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
      });
      break;

    case "monthly-booking-trends":
      reportData = await monthlyBookingTrendsReport({
        organizationId,
        timeframe,
        categoryId: url.searchParams.get("category") || undefined,
        locationId: url.searchParams.get("location") || undefined,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "12", 10),
      });
      break;

    case "asset-utilization":
      reportData = await assetUtilizationReport({
        organizationId,
        timeframe,
        categoryId: url.searchParams.get("category") || undefined,
        locationId: url.searchParams.get("location") || undefined,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
      });
      break;

    case "asset-activity":
      reportData = await assetActivityReport({
        organizationId,
        timeframe,
        assetId: url.searchParams.get("asset") || undefined,
        categoryId: url.searchParams.get("category") || undefined,
        page: parseInt(url.searchParams.get("page") || "1", 10),
        pageSize: parseInt(url.searchParams.get("pageSize") || "50", 10),
      });
      break;

    default:
      throw new ShelfError({
        cause: null,
        message: `Report "${reportId}" is not implemented`,
        label: "Report",
        status: 500,
      });
  }

  return data({
    ...reportData,
    reportId,
    // Standard header object for the app's Header component
    header: {
      title: reportData.report.title,
      subHeading: reportData.report.description,
    },
  });
}

export default function ReportPage() {
  const loaderData = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isExporting, setIsExporting] = useState(false);
  const showNotification = useSetAtom(showNotificationAtom);
  const navigation = useNavigation();
  const navigate = useNavigate();

  // Show loading state when navigating (timeframe change, pagination, etc.)
  const isLoading = navigation.state === "loading";

  const {
    reportId,
    kpis,
    rows,
    filters,
    computedMs,
    totalRows,
    page,
    pageSize,
    complianceData,
    topBookedAsset,
  } = loaderData as typeof loaderData & {
    complianceData?: {
      onTime: number;
      late: number;
      rate: number | null;
      priorPeriod?: { rate: number; delta: number; periodLabel: string };
    };
    topBookedAsset?: TopBookedAssetRow | null;
  };

  // Handle timeframe changes
  const handleTimeframeChange = (newTimeframe: typeof filters.timeframe) => {
    const params = new URLSearchParams(searchParams);
    params.set("timeframe", newTimeframe.preset);
    if (newTimeframe.preset === "custom") {
      params.set("from", newTimeframe.from.toISOString());
      params.set("to", newTimeframe.to.toISOString());
    } else {
      params.delete("from");
      params.delete("to");
    }
    params.delete("page"); // Reset to page 1 when filter changes
    setSearchParams(params, { replace: true });
  };

  // Handle CSV export with proper download handling
  const handleExport = async () => {
    setIsExporting(true);

    // Build export URL with current filters
    const exportParams = new URLSearchParams(searchParams);
    exportParams.set("reportId", reportId);

    // Generate filename based on report and timeframe
    const dateStr = new Date().toISOString().split("T")[0];
    const fileName = `${reportId}-${filters.timeframe.preset}-${dateStr}.csv`;

    const exportUrl = `/reports/export/${fileName}?${exportParams.toString()}`;

    try {
      // Fetch the CSV
      const response = await fetch(exportUrl);

      if (!response.ok) {
        throw new Error("Export failed");
      }

      // Create blob and trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      // Show success notification
      showNotification({
        title: "Export complete",
        message: `Downloaded ${fileName}`,
        icon: { name: "success", variant: "success" },
        senderId: null,
      });
    } catch (_error) {
      showNotification({
        title: "Export failed",
        message: "Unable to download the report. Please try again.",
        icon: { name: "trash", variant: "error" },
        senderId: null,
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Row-click handlers are wrapped in `useCallback` so their identity is stable
  // across re-renders. Without this, every ReportPage re-render produced a new
  // `onRowClick` prop for the report content components, which propagated down
  // through TanStack `flexRender` and forced AssetCell/AssetImage to remount —
  // creating an image-fetch storm visible in the network panel.
  const handleBookingRowClick = useCallback(
    (row: BookingComplianceRow) => {
      void navigate(`/bookings/${row.bookingId}`);
    },
    [navigate]
  );

  const handleOverdueRowClick = useCallback(
    (row: OverdueItemRow) => {
      void navigate(`/bookings/${row.bookingId}`);
    },
    [navigate]
  );

  const handleIdleAssetRowClick = useCallback(
    (row: IdleAssetRow) => {
      void navigate(`/assets/${row.assetId}`);
    },
    [navigate]
  );

  const handleCustodyRowClick = useCallback(
    (row: CustodySnapshotRow) => {
      void navigate(`/assets/${row.assetId}`);
    },
    [navigate]
  );

  const handleTopBookedRowClick = useCallback(
    (row: TopBookedAssetRow) => {
      void navigate(`/assets/${row.assetId}`);
    },
    [navigate]
  );

  const handleInventoryRowClick = useCallback(
    (row: AssetInventoryRow) => {
      void navigate(`/assets/${row.assetId}`);
    },
    [navigate]
  );

  const handleUtilizationRowClick = useCallback(
    (row: AssetUtilizationRow) => {
      void navigate(`/assets/${row.assetId}`);
    },
    [navigate]
  );

  const handleActivityRowClick = useCallback(
    (row: AssetActivityRow) => {
      void navigate(`/assets/${row.assetId}`);
    },
    [navigate]
  );

  // Render report content based on report ID
  const renderReportContent = () => {
    switch (reportId) {
      case "booking-compliance":
        return (
          <BookingComplianceContent
            rows={rows as unknown as BookingComplianceRow[]}
            complianceData={complianceData}
            totalBookings={totalRows}
            timeframeLabel={filters.timeframe.label}
            onRowClick={handleBookingRowClick}
          />
        );

      case "overdue-items":
        return (
          <OverdueItemsContent
            rows={rows as unknown as OverdueItemRow[]}
            kpis={kpis}
            totalRows={totalRows}
            onRowClick={handleOverdueRowClick}
          />
        );

      case "idle-assets":
        return (
          <IdleAssetsContent
            rows={rows as unknown as IdleAssetRow[]}
            kpis={kpis}
            totalRows={totalRows}
            timeframeLabel={filters.timeframe.label}
            onRowClick={handleIdleAssetRowClick}
          />
        );

      case "custody-snapshot":
        return (
          <CustodySnapshotContent
            rows={rows as unknown as CustodySnapshotRow[]}
            kpis={kpis}
            totalRows={totalRows}
            onRowClick={handleCustodyRowClick}
          />
        );

      case "top-booked-assets":
        return (
          <TopBookedAssetsContent
            rows={rows as unknown as TopBookedAssetRow[]}
            kpis={kpis}
            totalRows={totalRows}
            timeframeLabel={filters.timeframe.label}
            topBookedAsset={topBookedAsset}
            onRowClick={handleTopBookedRowClick}
          />
        );

      case "distribution":
        return (
          <AssetDistributionContent
            kpis={kpis}
            distributionBreakdown={
              (
                loaderData as typeof loaderData & {
                  distributionBreakdown?: DistributionBreakdown;
                }
              ).distributionBreakdown
            }
          />
        );

      case "asset-inventory":
        return (
          <AssetInventoryContent
            rows={rows as unknown as AssetInventoryRow[]}
            kpis={kpis}
            totalRows={totalRows}
            onRowClick={handleInventoryRowClick}
          />
        );

      case "monthly-booking-trends":
        return (
          <MonthlyBookingTrendsContent
            rows={rows as unknown as MonthlyBookingTrendRow[]}
            kpis={kpis}
            totalRows={totalRows}
            chartSeries={
              (
                loaderData as typeof loaderData & {
                  chartSeries?: ChartSeries[];
                }
              ).chartSeries
            }
          />
        );

      case "asset-utilization":
        return (
          <AssetUtilizationContent
            rows={rows as unknown as AssetUtilizationRow[]}
            kpis={kpis}
            totalRows={totalRows}
            onRowClick={handleUtilizationRowClick}
          />
        );

      case "asset-activity":
        return (
          <AssetActivityContent
            rows={rows as unknown as AssetActivityRow[]}
            kpis={kpis}
            totalRows={totalRows}
            onRowClick={handleActivityRowClick}
          />
        );

      default:
        return (
          <ReportEmptyState
            reason="error"
            title="Report not implemented"
            description="This report type is not yet supported."
          />
        );
    }
  };

  const hasData = rows.length > 0;

  return (
    <>
      {/* Standard app header with export actions */}
      <Header>
        <div className="flex items-center gap-2">
          {/* PDF Export - primary for B2B (booking-compliance, asset-inventory, custody-snapshot) */}
          {[
            "booking-compliance",
            "asset-inventory",
            "custody-snapshot",
          ].includes(reportId) && (
            <ReportPdf
              reportId={reportId}
              timeframe={filters.timeframe.preset}
              customFrom={
                filters.timeframe.preset === "custom"
                  ? filters.timeframe.from.toISOString()
                  : undefined
              }
              customTo={
                filters.timeframe.preset === "custom"
                  ? filters.timeframe.to.toISOString()
                  : undefined
              }
              hasData={hasData}
            />
          )}
          {/* CSV Export - enabled for all exportable reports */}
          {
            <Button
              type="button"
              variant="secondary"
              onClick={handleExport}
              disabled={!hasData || isExporting}
              title={!hasData ? "No data to export" : "Export report as CSV"}
            >
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          }
        </div>
      </Header>

      {/* Content area matching app patterns */}
      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 md:mt-4 md:px-0">
        {/* Filter bar - varies by report type */}
        {showTimeframePicker(reportId) && (
          <div className="flex items-center justify-between rounded border border-gray-200 bg-white px-4 py-3">
            <div className="flex items-center gap-4">
              <TimeframePicker
                value={filters.timeframe}
                onChange={handleTimeframeChange}
                syncToUrl={false}
                excludePresets={getExcludedPresets(reportId)}
                disabled={isLoading}
              />
              {/* Date range indicator - shows actual dates and day count */}
              <TimeframeRangeIndicator timeframe={filters.timeframe} />
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="animate-spin size-3 rounded-full border-2 border-gray-300 border-t-gray-600" />
                <span>Updating...</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Idle threshold selector for Idle Assets report */}
        {reportId === "idle-assets" && (
          <div className="flex items-center justify-between rounded border border-gray-200 bg-white px-4 py-3">
            <IdleThresholdSelector
              value={parseInt(searchParams.get("days") || "30", 10)}
              onChange={(days) => {
                const params = new URLSearchParams(searchParams);
                params.set("days", days.toString());
                params.delete("page"); // Reset to page 1 when filter changes
                setSearchParams(params, { replace: true });
              }}
              disabled={isLoading}
            />
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="animate-spin size-3 rounded-full border-2 border-gray-300 border-t-gray-600" />
                <span>Updating...</span>
              </div>
            )}
          </div>
        )}

        {/* Main content area */}
        <div className={tw("transition-opacity", isLoading && "opacity-60")}>
          {hasData ? (
            renderReportContent()
          ) : (
            <div className="rounded border border-gray-200 bg-white">
              <ReportEmptyState
                reason="no_data"
                title={getEmptyStateTitle(reportId)}
                description={getEmptyStateDescription(reportId)}
                ctaTo={getEmptyStateCta(reportId)?.to}
                ctaLabel={getEmptyStateCta(reportId)?.label}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="rounded border border-gray-200 bg-white px-4 py-2">
          <ReportFooter
            computedMs={computedMs}
            totalRows={totalRows}
            page={page}
            pageSize={pageSize}
            hideRowCount={
              reportId === "distribution" ||
              reportId === "monthly-booking-trends"
            }
          />
        </div>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Empty state content helpers
//
// These provide contextually appropriate messaging for each report type.
// Key principle: Reports are analytics views, not action prompts. The primary
// guidance should help users find data (expand timeframe, adjust filters),
// not necessarily create new data.
// -----------------------------------------------------------------------------

function getEmptyStateTitle(reportId: string): string {
  switch (reportId) {
    case "booking-compliance":
      return "No bookings to analyze";
    case "overdue-items":
      return "No overdue bookings";
    case "idle-assets":
      return "No idle assets";
    case "custody-snapshot":
      return "No assets in custody";
    case "top-booked-assets":
      return "No booking activity";
    case "distribution":
      return "No assets";
    case "asset-inventory":
      return "No assets in inventory";
    case "monthly-booking-trends":
      return "No booking data";
    case "asset-utilization":
      return "No utilization data";
    case "asset-activity":
      return "No activity recorded";
    default:
      return "No data in this timeframe";
  }
}

function getEmptyStateDescription(reportId: string): string {
  switch (reportId) {
    case "booking-compliance":
      // This is an analytics report - focus on finding data, not creating it.
      // The report analyzes check-out/check-in compliance for bookings that
      // fall within the selected timeframe.
      return "This report tracks whether bookings were checked out and returned on time. Try selecting a longer timeframe to see compliance metrics for past bookings.";
    case "overdue-items":
      return "Great news! All bookings are on track. No items are currently overdue.";
    case "idle-assets":
      return "All your assets have been actively used within the selected timeframe. Consider adjusting the idle threshold to find assets with lower utilization.";
    case "custody-snapshot":
      return "No team members currently have assets assigned to them. Assets appear here when custody is assigned.";
    case "top-booked-assets":
      return "No assets have been booked within the selected timeframe. Try selecting a longer period to see booking activity.";
    case "distribution":
      return "Add assets to your inventory to see distribution breakdowns by category, location, and status.";
    case "asset-inventory":
      return "Your inventory is empty. Add assets to see them listed here with filtering and export options.";
    case "monthly-booking-trends":
      return "No bookings have been created within the selected timeframe. Try selecting a longer period to see trends.";
    case "asset-utilization":
      return "No booking activity within the selected timeframe. Assets need bookings to calculate utilization rates.";
    case "asset-activity":
      return "No activity has been recorded for your assets in this timeframe. Activity appears when assets are updated, booked, or custody changes.";
    default:
      return "Try selecting a different timeframe to find data for this report.";
  }
}

/**
 * Determines if a report should show the timeframe picker.
 *
 * Some reports are "live" or "snapshot" views of current state and don't
 * benefit from timeframe filtering:
 * - Overdue Items: Shows currently overdue bookings (live state)
 * - Custody Snapshot: Shows current asset assignments (live state)
 * - Asset Inventory: Shows current inventory count (snapshot)
 * - Asset Distribution: Shows current distribution breakdown (snapshot)
 * - Idle Assets: Uses an idle threshold (days), not a timeframe range
 */
function showTimeframePicker(reportId: string): boolean {
  const liveOrSnapshotReports = [
    "overdue-items",
    "custody-snapshot",
    "asset-inventory",
    "distribution",
    "idle-assets",
  ];
  return !liveOrSnapshotReports.includes(reportId);
}

/**
 * Returns presets to exclude from the timeframe picker for a given report.
 *
 * Some reports don't benefit from very short timeframes (like "Today") because
 * their metrics only make sense over longer periods (e.g., booking duration
 * averages, monthly trends).
 */
function getExcludedPresets(reportId: string): TimeframePreset[] {
  switch (reportId) {
    // Top Booked Assets: Booking duration metrics need longer timeframes
    // "Today" would show incomplete/meaningless duration averages
    case "top-booked-assets":
    // Monthly Booking Trends: By definition needs multi-month data
    // falls through
    case "monthly-booking-trends":
    // Asset Utilization: Utilization rates need sufficient time to be meaningful
    // falls through
    case "asset-utilization":
      return ["today"];
    default:
      return [];
  }
}

/**
 * Returns a CTA for the empty state, if appropriate.
 *
 * Note: For analytics reports, we intentionally return null because
 * "create new data" isn't the right action when viewing reports.
 * The user came here to analyze, not to create.
 */
function getEmptyStateCta(
  _reportId: string
): { to: string; label: string } | null {
  // For now, no reports have a CTA in their empty state.
  // The appropriate action is to adjust the timeframe, which is
  // already available via the TimeframePicker above.
  return null;
}
