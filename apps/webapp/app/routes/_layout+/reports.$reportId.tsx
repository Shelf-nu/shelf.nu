/**
 * Report Runner Route
 *
 * Dynamic route that renders a specific report based on the reportId param.
 * Handles loading data, applying filters, and rendering the appropriate report.
 *
 * @see {@link file://../../modules/reports/registry.ts}
 * @see {@link file://../../modules/reports/helpers.server.ts}
 */

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useSetAtom } from "jotai";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  data,
  Link,
  useLoaderData,
  useNavigate,
  useNavigation,
} from "react-router";

import { showNotificationAtom } from "~/atoms/notifications";
import Header from "~/components/layout/header";
import {
  ReportFooter,
  TimeframePicker,
  ReportTable,
  StatusCell,
  DateCell,
  NumberCell,
  AssetCell,
  ReportEmptyState,
  ComplianceHero,
  ReportPdf,
  BarChart,
  ChartCard,
  DistributionDonut,
} from "~/components/reports";
import { Button } from "~/components/shared/button";
import { InfoTooltip } from "~/components/shared/info-tooltip";
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
  BookingComplianceRow,
  OverdueItemRow,
  IdleAssetRow,
  CustodySnapshotRow,
  TopBookedAssetRow,
  AssetInventoryRow,
  MonthlyBookingTrendRow,
  AssetUtilizationRow,
  AssetActivityRow,
  DistributionBreakdown,
  ChartSeries,
  ReportKpi,
  ReportPayload,
  TimeframePreset,
  ResolvedTimeframe,
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

  const navigate = useNavigate();

  // Navigate to booking when row is clicked
  const handleBookingRowClick = (row: BookingComplianceRow) => {
    void navigate(`/bookings/${row.bookingId}`);
  };

  // Navigate to booking when overdue row is clicked
  const handleOverdueRowClick = (row: OverdueItemRow) => {
    void navigate(`/bookings/${row.bookingId}`);
  };

  // Navigate to asset when idle asset row is clicked
  const handleIdleAssetRowClick = (row: IdleAssetRow) => {
    void navigate(`/assets/${row.assetId}`);
  };

  // Navigate to asset when custody row is clicked
  const handleCustodyRowClick = (row: CustodySnapshotRow) => {
    void navigate(`/assets/${row.assetId}`);
  };

  // Navigate to asset when top booked row is clicked
  const handleTopBookedRowClick = (row: TopBookedAssetRow) => {
    void navigate(`/assets/${row.assetId}`);
  };

  // Navigate to asset when inventory row is clicked
  const handleInventoryRowClick = (row: AssetInventoryRow) => {
    void navigate(`/assets/${row.assetId}`);
  };

  // Navigate to asset when utilization row is clicked
  const handleUtilizationRowClick = (row: AssetUtilizationRow) => {
    void navigate(`/assets/${row.assetId}`);
  };

  // Navigate to asset when activity row is clicked
  const handleActivityRowClick = (row: AssetActivityRow) => {
    void navigate(`/assets/${row.assetId}`);
  };

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

      {/* Content area matching app patterns.
          `flex-1` cascades from the parent `<main>` (SidebarInset), which is a
          `flex flex-col h-dvh` container. That makes this column exactly the
          remaining viewport height under the app Header. Combined with the
          `flex-1 min-h-0` main content area below, the table card fills the
          available space and the footer (pagination + computed-in) stays
          pinned at the bottom of the viewport. */}
      {/* `-mb-8` cancels most of the SidebarInset's `pb-10`, keeping the
          pagination footer close to the viewport bottom on report pages
          without changing the global main padding. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-2 md:-mb-8 md:mt-4 md:px-0">
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

        {/* Main content area — `flex-1 min-h-0` lets it grow within the route's
            flex column and lets children using `flex-1` (e.g. the data table)
            shrink past their content height to enable internal scrolling. */}
        <div
          className={tw(
            "flex min-h-0 flex-1 flex-col transition-opacity",
            isLoading && "opacity-60"
          )}
        >
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
// Filter components
// -----------------------------------------------------------------------------

/**
 * Shows the actual date range and day count for the selected timeframe.
 * Helps users understand why "This quarter" might show fewer bookings than "Last 90 days"
 * (e.g., Q2 starting Apr 1 is only 24 days so far vs a full 90 days).
 */
function TimeframeRangeIndicator({
  timeframe,
}: {
  timeframe: ResolvedTimeframe;
}) {
  const { from, to } = timeframe;

  // Calculate day count (inclusive of both start and end dates)
  // Normalize both dates to midnight to avoid time-of-day issues
  const fromMidnight = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate()
  );
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const dayCount =
    Math.round(
      (toMidnight.getTime() - fromMidnight.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

  // Format dates compactly
  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

  // Check if dates span different years
  const fromYear = from.getFullYear();
  const toYear = to.getFullYear();
  const showYear = fromYear !== toYear || toYear !== new Date().getFullYear();

  const fromStr =
    formatDate(from) + (showYear && fromYear !== toYear ? `, ${fromYear}` : "");
  const toStr = formatDate(to) + (showYear ? `, ${toYear}` : "");

  return (
    <span className="hidden text-xs text-gray-500 sm:inline-flex sm:items-center sm:gap-1.5">
      <span>
        {fromStr} – {toStr}
      </span>
      <span className="text-gray-300">·</span>
      <span className="font-medium text-gray-600">
        {dayCount} day{dayCount !== 1 ? "s" : ""}
      </span>
    </span>
  );
}

/**
 * Idle threshold selector for the Idle Assets report.
 * Allows users to define what "idle" means: 30, 60, or 90+ days of inactivity.
 */
function IdleThresholdSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (days: number) => void;
  disabled?: boolean;
}) {
  const thresholds = [
    { days: 30, label: "30 days" },
    { days: 60, label: "60 days" },
    { days: 90, label: "90 days" },
  ];

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-600">Unused for:</span>
      <div className="flex items-center gap-1 rounded border border-gray-200 bg-white p-1">
        {thresholds.map((t) => (
          <button
            key={t.days}
            type="button"
            onClick={() => onChange(t.days)}
            disabled={disabled}
            className={tw(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1",
              "disabled:cursor-not-allowed disabled:opacity-50",
              value === t.days
                ? "bg-primary-600 text-white"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Report-specific content components
// -----------------------------------------------------------------------------

function BookingComplianceContent({
  rows,
  complianceData,
  totalBookings,
  timeframeLabel,
  onRowClick,
}: {
  rows: BookingComplianceRow[];
  complianceData?: {
    onTime: number;
    late: number;
    rate: number | null;
    priorPeriod?: { rate: number; delta: number; periodLabel: string };
  };
  totalBookings: number;
  timeframeLabel?: string;
  onRowClick?: (row: BookingComplianceRow) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Map column accessorKey to server sort column
  const columnToSortColumn: Record<string, BookingComplianceSortColumn> = {
    bookingName: "bookingName",
    status: "status",
    custodian: "custodian",
    assetCount: "assetCount",
    scheduledEnd: "scheduledEnd",
    latenessMs: "returnStatus",
  };

  // Read current sort from URL
  const currentSortBy = searchParams.get("sortBy") || "scheduledEnd";
  const currentSortOrder = searchParams.get("sortOrder") || "desc";

  // Map server sort column back to column ID for TanStack
  const sortColumnToAccessor: Record<string, string> = {
    bookingName: "bookingName",
    status: "status",
    custodian: "custodian",
    assetCount: "assetCount",
    scheduledEnd: "scheduledEnd",
    returnStatus: "latenessMs",
  };
  const initialSortColumn =
    sortColumnToAccessor[currentSortBy] || "scheduledEnd";

  // Handle sort change - update URL to trigger server-side sort
  const handleSortChange = (columnId: string, direction: "asc" | "desc") => {
    const serverColumn = columnToSortColumn[columnId];
    if (!serverColumn) return;

    const params = new URLSearchParams(searchParams);
    params.set("sortBy", serverColumn);
    params.set("sortOrder", direction);
    // Reset to page 1 when sort changes
    params.set("page", "1");
    setSearchParams(params, { replace: true });
  };

  // Column definitions for the booking compliance table
  const columns: ColumnDef<BookingComplianceRow>[] = [
    {
      accessorKey: "bookingName",
      header: "Booking",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.bookingName}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status;
        const variant = getStatusVariant(status);
        return <StatusCell status={formatStatus(status)} variant={variant} />;
      },
    },
    {
      accessorKey: "custodian",
      header: "Booked by",
      cell: ({ row }) =>
        row.original.custodian || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "assetCount",
      header: "Assets",
      cell: ({ row }) => <NumberCell value={row.original.assetCount} />,
    },
    {
      accessorKey: "scheduledEnd",
      header: "Due Date",
      cell: ({ row }) => <DateCell date={row.original.scheduledEnd} />,
    },
    {
      accessorKey: "latenessMs",
      header: "Return Status",
      cell: ({ row }) => {
        const { isOnTime, latenessMs } = row.original;
        if (isOnTime) {
          return <StatusCell status="On time" variant="success" />;
        }
        // Format lateness as human-readable
        const lateness = formatLateness(latenessMs);
        return (
          <span className="text-sm font-medium text-orange-600">
            {lateness}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* The Answer */}
      <ComplianceHero
        rate={complianceData?.rate ?? 0}
        onTime={complianceData?.onTime ?? 0}
        late={complianceData?.late ?? 0}
        priorPeriod={complianceData?.priorPeriod}
        timeframeLabel={timeframeLabel}
      />

      {/* Booking details table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Booking Details
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalBookings}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          fillParent
          onRowClick={onRowClick}
          manualSorting
          initialSorting={[
            { id: initialSortColumn, desc: currentSortOrder === "desc" },
          ]}
          onSortChange={handleSortChange}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No bookings found"
              description="No bookings match the current filters."
            />
          }
        />
      </div>
    </div>
  );
}

// Helper functions
function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "Draft",
    RESERVED: "Reserved",
    ONGOING: "Ongoing",
    OVERDUE: "Overdue",
    COMPLETE: "Complete",
    CANCELLED: "Cancelled",
    ARCHIVED: "Archived",
  };
  return labels[status] || status;
}

function getStatusVariant(
  status: string
): "success" | "warning" | "error" | "neutral" {
  switch (status) {
    case "COMPLETE":
      return "success";
    case "ONGOING":
    case "RESERVED":
      return "neutral";
    case "OVERDUE":
      return "error";
    case "CANCELLED":
    case "DRAFT":
    case "ARCHIVED":
    default:
      return "neutral";
  }
}

/**
 * Map asset status to badge variant.
 * Matches the colors used in asset-status-badge.tsx:
 * - AVAILABLE → green (success)
 * - IN_CUSTODY → blue
 * - CHECKED_OUT → violet
 */
function getAssetStatusVariant(
  status: string
): "success" | "blue" | "violet" | "neutral" {
  switch (status) {
    case "AVAILABLE":
      return "success";
    case "IN_CUSTODY":
      return "blue";
    case "CHECKED_OUT":
      return "violet";
    default:
      return "neutral";
  }
}

/**
 * Format asset status for display.
 * Matches the labels from asset-status-badge.tsx.
 */
function formatAssetStatus(status: string): string {
  const labels: Record<string, string> = {
    AVAILABLE: "Available",
    IN_CUSTODY: "In custody",
    CHECKED_OUT: "Checked out",
  };
  return labels[status] || status;
}

/**
 * Format lateness as human-readable string.
 * Positive ms = late, negative ms = early.
 */
function formatLateness(ms: number | null): string {
  if (ms === null) return "—";

  const absMs = Math.abs(ms);
  const minutes = Math.floor(absMs / (1000 * 60));
  const hours = Math.floor(absMs / (1000 * 60 * 60));
  const days = Math.floor(absMs / (1000 * 60 * 60 * 24));

  let value: string;
  if (days > 0) {
    const remainingHours = hours % 24;
    value = remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  } else if (hours > 0) {
    const remainingMinutes = minutes % 60;
    value =
      remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  } else {
    value = `${minutes}m`;
  }

  return ms > 0 ? `${value} late` : `${value} early`;
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

// -----------------------------------------------------------------------------
// R6: Overdue Items Content
// -----------------------------------------------------------------------------

function OverdueItemsContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: {
  rows: OverdueItemRow[];
  kpis: ReportKpi[];
  totalRows: number;
  onRowClick?: (row: OverdueItemRow) => void;
}) {
  // Column definitions for overdue items table
  const columns: ColumnDef<OverdueItemRow>[] = [
    {
      accessorKey: "bookingName",
      header: "Booking",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.bookingName}</span>
      ),
    },
    {
      accessorKey: "custodian",
      header: "Booked by",
      cell: ({ row }) =>
        row.original.custodian || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "assetCount",
      header: "Assets",
      cell: ({ row }) => <NumberCell value={row.original.assetCount} />,
    },
    {
      accessorKey: "scheduledEnd",
      header: "Due Date",
      cell: ({ row }) => <DateCell date={row.original.scheduledEnd} />,
    },
    {
      accessorKey: "daysOverdue",
      header: "Days Overdue",
      cell: ({ row }) => {
        const days = row.original.daysOverdue;
        return (
          <span
            className={tw(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              days > 7
                ? "bg-red-100 text-red-700"
                : days > 3
                ? "bg-orange-100 text-orange-700"
                : "bg-yellow-100 text-yellow-700"
            )}
          >
            {days} days
          </span>
        );
      },
    },
    {
      accessorKey: "valueAtRisk",
      header: "Value",
      cell: ({ row }) =>
        row.original.valueAtRisk ? (
          `$${row.original.valueAtRisk.toLocaleString()}`
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
  ];

  // Extract KPI values for hero display
  const totalOverdue =
    (kpis.find((k) => k.id === "total_overdue")?.rawValue as number) || 0;
  const assetsAtRisk =
    (kpis.find((k) => k.id === "total_assets_at_risk")?.rawValue as number) ||
    0;
  const valueAtRisk =
    (kpis.find((k) => k.id === "total_value_at_risk")?.rawValue as number) || 0;
  const longestOverdue =
    (kpis.find((k) => k.id === "longest_overdue")?.rawValue as number) || 0;

  return (
    <div className="space-y-4">
      {/* Hero section with key metrics */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span
                className={tw(
                  "text-3xl font-semibold",
                  totalOverdue > 0 ? "text-red-600" : "text-green-600"
                )}
              >
                {totalOverdue}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Items Not Returned
              </span>
              {totalOverdue > 0 ? (
                <span className="text-xs text-gray-500">
                  {assetsAtRisk} assets across {totalOverdue} booking
                  {totalOverdue !== 1 ? "s" : ""}
                </span>
              ) : (
                <span className="text-xs text-green-600">
                  All items returned on schedule
                </span>
              )}
            </div>
          </div>

          {/* Supporting stats */}
          {totalOverdue > 0 && (
            <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
              <div className="flex flex-col">
                <span className="text-xs text-gray-500">Total Value</span>
                <span className="text-lg font-medium text-gray-900">
                  {valueAtRisk > 0 ? `$${valueAtRisk.toLocaleString()}` : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-gray-500">Longest Overdue</span>
                <span className="text-lg font-medium text-red-600">
                  {longestOverdue > 0 ? `${longestOverdue} days` : "—"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Data table */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Items Waiting for Return
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          maxHeight="500px"
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No items waiting"
              description="All items have been returned on schedule."
            />
          }
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// R4: Idle Assets Content
// -----------------------------------------------------------------------------

function IdleAssetsContent({
  rows,
  kpis,
  totalRows,
  timeframeLabel,
  onRowClick,
}: {
  rows: IdleAssetRow[];
  kpis: ReportKpi[];
  totalRows: number;
  timeframeLabel?: string;
  onRowClick?: (row: IdleAssetRow) => void;
}) {
  // Column definitions for unused assets table
  // Order: What → Urgency → Context → Value → Status (tells a story)
  const columns: ColumnDef<IdleAssetRow>[] = [
    {
      accessorKey: "assetName",
      header: "Asset",
      cell: ({ row }) => (
        <AssetCell
          name={row.original.assetName}
          thumbnailImage={row.original.thumbnailImage}
        />
      ),
    },
    {
      accessorKey: "daysSinceLastUse",
      header: "Unused For",
      cell: ({ row }) => {
        const days = row.original.daysSinceLastUse;
        return (
          <span
            className={tw(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              days > 90
                ? "bg-red-100 text-red-700"
                : days > 60
                ? "bg-orange-100 text-orange-700"
                : "bg-yellow-100 text-yellow-700"
            )}
          >
            {days} days
          </span>
        );
      },
    },
    {
      accessorKey: "lastBookedAt",
      header: "Last Used",
      cell: ({ row }) =>
        row.original.lastBookedAt ? (
          <DateCell date={row.original.lastBookedAt} />
        ) : (
          <span className="text-gray-400">Never</span>
        ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) =>
        row.original.location || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "valuation",
      header: "Value",
      cell: ({ row }) =>
        row.original.valuation ? (
          `$${row.original.valuation.toLocaleString()}`
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
  ];

  // Extract KPI values
  const totalIdle =
    (kpis.find((k) => k.id === "total_idle")?.rawValue as number) || 0;
  const idlePercentage =
    (kpis.find((k) => k.id === "idle_percentage")?.rawValue as number) || 0;
  const totalIdleValue =
    (kpis.find((k) => k.id === "total_idle_value")?.rawValue as number) || 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span
                className={tw(
                  "text-3xl font-semibold",
                  totalIdle > 10
                    ? "text-orange-600"
                    : totalIdle > 0
                    ? "text-yellow-600"
                    : "text-green-600"
                )}
              >
                {totalIdle}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Unused Assets
              </span>
              <span className="text-xs text-gray-500">
                {idlePercentage}% of inventory
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Value</span>
              <span className="text-lg font-medium text-gray-900">
                {totalIdleValue > 0
                  ? `$${totalIdleValue.toLocaleString()}`
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Data table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">Unused Assets</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          fillParent
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No idle assets"
              description={`All your assets have been used within the selected threshold${
                timeframeLabel ? ` (${timeframeLabel.toLowerCase()})` : ""
              }.`}
            />
          }
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// R5: Custody Snapshot Content
// -----------------------------------------------------------------------------

function CustodySnapshotContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: {
  rows: CustodySnapshotRow[];
  kpis: ReportKpi[];
  totalRows: number;
  onRowClick?: (row: CustodySnapshotRow) => void;
}) {
  // Calculate max days for relative bar width
  const maxDays = Math.max(...rows.map((r) => r.daysInCustody), 1);

  // Column definitions for custody snapshot table
  const columns: ColumnDef<CustodySnapshotRow>[] = [
    {
      accessorKey: "assetName",
      header: "Asset",
      cell: ({ row }) => (
        <AssetCell
          name={row.original.assetName}
          thumbnailImage={row.original.thumbnailImage}
        />
      ),
    },
    {
      accessorKey: "custodianName",
      header: "Assigned to",
      cell: ({ row }) => row.original.custodianName,
    },
    {
      accessorKey: "daysInCustody",
      header: "Days Held",
      cell: ({ row }) => {
        const days = row.original.daysInCustody;
        const percentage = Math.min((days / maxDays) * 100, 100);
        return (
          <div className="flex items-center gap-3">
            {/* Tenure bar - visual indicator of relative duration */}
            <div className="relative h-2 w-16 overflow-hidden rounded-full bg-gray-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary-500 transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>
            {/* Days value */}
            <span className="min-w-16 text-sm font-medium tabular-nums text-gray-900">
              {days} <span className="font-normal text-gray-500">days</span>
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "assignedAt",
      header: "Assigned",
      cell: ({ row }) => <DateCell date={row.original.assignedAt} />,
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) =>
        row.original.location || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "valuation",
      header: "Value",
      cell: ({ row }) =>
        row.original.valuation ? (
          `$${row.original.valuation.toLocaleString()}`
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
  ];

  // Extract KPI values
  const totalInCustody =
    (kpis.find((k) => k.id === "total_in_custody")?.rawValue as number) || 0;
  const totalCustodians =
    (kpis.find((k) => k.id === "total_custodians")?.rawValue as number) || 0;
  const totalCustodyValue =
    (kpis.find((k) => k.id === "total_custody_value")?.rawValue as number) || 0;
  const avgDaysInCustody =
    (kpis.find((k) => k.id === "avg_days_in_custody")?.rawValue as number) || 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalInCustody}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Assets Currently Assigned
              </span>
              <span className="text-xs text-gray-500">
                Across {totalCustodians} team member
                {totalCustodians !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Value</span>
              <span className="text-lg font-medium text-gray-900">
                {totalCustodyValue > 0
                  ? `$${totalCustodyValue.toLocaleString()}`
                  : "—"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Avg. Tenure</span>
              <span className="text-lg font-medium text-gray-900">
                {avgDaysInCustody > 0
                  ? `${Math.round(avgDaysInCustody)} days`
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Data table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Current Assignments
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          fillParent
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No assets assigned"
              description="No assets are currently assigned to team members."
            />
          }
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// R3: Top Booked Assets Content
// -----------------------------------------------------------------------------

function TopBookedAssetsContent({
  rows,
  kpis,
  totalRows,
  timeframeLabel,
  topBookedAsset,
  onRowClick,
}: {
  rows: TopBookedAssetRow[];
  kpis: ReportKpi[];
  totalRows: number;
  timeframeLabel?: string;
  /** The #1 most booked asset - independent of pagination */
  topBookedAsset?: TopBookedAssetRow | null;
  onRowClick?: (row: TopBookedAssetRow) => void;
}) {
  // Column definitions for top booked assets table
  const columns: ColumnDef<TopBookedAssetRow>[] = [
    {
      accessorKey: "assetName",
      header: "Asset",
      cell: ({ row }) => (
        <AssetCell
          name={row.original.assetName}
          thumbnailImage={row.original.thumbnailImage}
        />
      ),
    },
    {
      accessorKey: "bookingCount",
      header: "Bookings",
      cell: ({ row }) => (
        <Link
          to={`/assets/${row.original.assetId}/bookings`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-200"
          title="View all bookings for this asset"
        >
          {row.original.bookingCount}
        </Link>
      ),
    },
    {
      accessorKey: "totalDaysBooked",
      header: "Total Days",
      cell: ({ row }) => (
        <span className="text-sm text-gray-700">
          {row.original.totalDaysBooked}
        </span>
      ),
    },
    {
      id: "avgDuration",
      header: () => (
        <span className="flex items-center gap-1">
          Avg Duration
          <InfoTooltip
            iconClassName="size-3.5"
            content={
              <p>
                <strong>Average booking duration</strong> — How long this asset
                is typically kept per booking. Calculated as total days booked ÷
                number of bookings.
              </p>
            }
          />
        </span>
      ),
      // Compute average duration for sorting
      accessorFn: (row) =>
        row.bookingCount > 0 ? row.totalDaysBooked / row.bookingCount : 0,
      cell: ({ row }) => {
        const avgDays = row.getValue("avgDuration") as number;

        // Visual bar capped at 14 days (2 weeks) as reference max
        const barPercent = Math.min((avgDays / 14) * 100, 100);

        return (
          <div className="flex items-center gap-2">
            <div className="h-2 w-12 overflow-hidden rounded-full bg-gray-100">
              <div
                className={tw(
                  "h-full rounded-full",
                  avgDays >= 7
                    ? "bg-blue-600"
                    : avgDays >= 3
                    ? "bg-blue-400"
                    : "bg-blue-200"
                )}
                style={{ width: `${barPercent}%` }}
              />
            </div>
            <span className="whitespace-nowrap text-xs text-gray-600">
              {avgDays >= 1
                ? `${avgDays.toFixed(1)}d`
                : `${Math.round(avgDays * 24)}h`}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) =>
        row.original.location || <span className="text-gray-400">—</span>,
    },
  ];

  // Extract KPI values
  const totalBookings =
    (kpis.find((k) => k.id === "total_bookings")?.rawValue as number) || 0;
  const uniqueAssetsBooked =
    (kpis.find((k) => k.id === "unique_assets_booked")?.rawValue as number) ||
    0;
  const avgBookingsPerAsset =
    (kpis.find((k) => k.id === "avg_bookings_per_asset")?.rawValue as number) ||
    0;

  // Most booked asset comes from server (independent of pagination)
  const topAsset = topBookedAsset || null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalBookings}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Bookings
              </span>
              <span className="text-xs text-gray-500">
                {uniqueAssetsBooked} assets booked
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Avg per Asset</span>
              <span className="text-lg font-medium text-gray-900">
                {avgBookingsPerAsset.toFixed(1)}
              </span>
            </div>

            {/* Most booked asset with image */}
            {topAsset && (
              <div className="flex flex-col">
                <span className="text-xs text-gray-500">Most Booked</span>
                <Link
                  to={`/assets/${topAsset.assetId}`}
                  className="group -mx-1.5 mt-0.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-gray-50"
                >
                  <img
                    src={
                      topAsset.thumbnailImage ||
                      "/static/images/asset-placeholder.jpg"
                    }
                    alt=""
                    className="size-8 rounded object-cover ring-1 ring-gray-200"
                  />
                  <div className="flex min-w-0 flex-col">
                    <span
                      className="max-w-[200px] truncate text-sm font-medium text-gray-900 group-hover:text-primary-600"
                      title={topAsset.assetName}
                    >
                      {topAsset.assetName}
                    </span>
                    <span className="text-xs text-gray-500">
                      {topAsset.bookingCount} booking
                      {topAsset.bookingCount !== 1 ? "s" : ""} · #1 most booked
                    </span>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Context guidance */}
        <div className="border-t border-gray-100 bg-gray-50/50 px-4 py-2 md:px-6">
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-600">
              Understanding this report:
            </span>{" "}
            Shows which assets are booked most frequently during{" "}
            <span className="font-medium">
              {(timeframeLabel || "the selected period").toLowerCase()}
            </span>
            . <span className="italic">Total Days</span> = cumulative booking
            days. <span className="italic">Avg Duration</span> = typical booking
            length per checkout. Use longer timeframes (30+ days) for meaningful
            duration trends.
          </p>
        </div>
      </div>

      {/* Data table — fills remaining vertical space inside the route's flex column
          and scrolls internally when row count exceeds the visible area. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">Top Assets</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          fillParent
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No booking data"
              description="No assets have been booked within the selected timeframe."
            />
          }
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// R10: Asset Distribution Content
// -----------------------------------------------------------------------------

function AssetDistributionContent({
  kpis,
  distributionBreakdown,
}: {
  kpis: ReportKpi[];
  distributionBreakdown?: DistributionBreakdown;
}) {
  const navigate = useNavigate();

  // Navigate to assets filtered by the clicked item
  // IDs match the special filter values: "uncategorized", "without-location", or actual IDs
  const handleCategoryClick = (item: { id: string }) => {
    void navigate(`/assets?category=${encodeURIComponent(item.id)}`);
  };

  const handleLocationClick = (item: { id: string }) => {
    void navigate(`/assets?location=${encodeURIComponent(item.id)}`);
  };

  const handleStatusClick = (item: { id: string }) => {
    void navigate(`/assets?status=${encodeURIComponent(item.id)}`);
  };

  // Extract KPI values
  const totalAssets =
    (kpis.find((k) => k.id === "total_assets")?.rawValue as number) || 0;
  const totalValue =
    (kpis.find((k) => k.id === "total_value")?.rawValue as number) || 0;
  const totalCategories =
    (kpis.find((k) => k.id === "total_categories")?.rawValue as number) || 0;
  const totalLocations =
    (kpis.find((k) => k.id === "total_locations")?.rawValue as number) || 0;

  return (
    <div className="space-y-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalAssets}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Assets
              </span>
              <span className="text-xs text-gray-500">
                Across {totalCategories} categories, {totalLocations} locations
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Value</span>
              <span className="text-lg font-medium text-gray-900">
                {totalValue > 0 ? `$${totalValue.toLocaleString()}` : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Distribution donut charts - clickable to filter assets */}
      {distributionBreakdown && (
        <div className="grid gap-6 lg:grid-cols-3">
          <DistributionDonut
            title="By Category"
            data={distributionBreakdown.byCategory}
            emptyMessage="No categories defined"
            maxLegendItems={5}
            onItemClick={handleCategoryClick}
          />
          <DistributionDonut
            title="By Location"
            data={distributionBreakdown.byLocation}
            emptyMessage="No locations defined"
            maxLegendItems={5}
            onItemClick={handleLocationClick}
          />
          <DistributionDonut
            title="By Status"
            data={distributionBreakdown.byStatus}
            emptyMessage="No status data"
            maxLegendItems={5}
            onItemClick={handleStatusClick}
          />
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// R1: Asset Inventory Content
// -----------------------------------------------------------------------------

function AssetInventoryContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: {
  rows: AssetInventoryRow[];
  kpis: ReportKpi[];
  totalRows: number;
  onRowClick?: (row: AssetInventoryRow) => void;
}) {
  // Column definitions for inventory table
  const columns: ColumnDef<AssetInventoryRow>[] = [
    {
      accessorKey: "assetName",
      header: "Asset",
      cell: ({ row }) => (
        <AssetCell
          name={row.original.assetName}
          thumbnailImage={row.original.thumbnailImage}
        />
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusCell
          status={formatAssetStatus(row.original.status)}
          variant={getAssetStatusVariant(row.original.status)}
        />
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) =>
        row.original.location || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "custodian",
      header: "Assigned to",
      cell: ({ row }) =>
        row.original.custodian || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "valuation",
      header: "Value",
      cell: ({ row }) =>
        row.original.valuation ? (
          `$${row.original.valuation.toLocaleString()}`
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => <DateCell date={row.original.createdAt} />,
    },
  ];

  // Extract KPI values
  const totalAssets =
    (kpis.find((k) => k.id === "total_assets")?.rawValue as number) || 0;
  const totalValue =
    (kpis.find((k) => k.id === "total_value")?.rawValue as number) || 0;
  const availableCount =
    (kpis.find((k) => k.id === "available_count")?.rawValue as number) || 0;
  const inCustodyCount =
    (kpis.find((k) => k.id === "in_custody_count")?.rawValue as number) || 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalAssets}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Assets
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Value</span>
              <span className="text-lg font-medium text-gray-900">
                {totalValue > 0 ? `$${totalValue.toLocaleString()}` : "—"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Not in use</span>
              <span className="text-lg font-medium text-gray-900">
                {availableCount}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Assigned</span>
              <span className="text-lg font-medium text-gray-900">
                {inCustodyCount}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Data table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">Assets</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          fillParent
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No assets"
              description="Your inventory is empty."
            />
          }
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// R9: Monthly Booking Trends Content
// -----------------------------------------------------------------------------

function MonthlyBookingTrendsContent({
  rows,
  kpis,
  totalRows,
  chartSeries,
}: {
  rows: MonthlyBookingTrendRow[];
  kpis: ReportKpi[];
  totalRows: number;
  chartSeries?: ChartSeries[];
}) {
  // Column definitions for trends table
  const columns: ColumnDef<MonthlyBookingTrendRow>[] = [
    {
      accessorKey: "month",
      header: "Month",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.month}</span>
      ),
    },
    {
      accessorKey: "bookingsCreated",
      header: "Bookings Created",
      cell: ({ row }) => <NumberCell value={row.original.bookingsCreated} />,
    },
    {
      accessorKey: "bookingsCompleted",
      header: "Bookings Completed",
      cell: ({ row }) => <NumberCell value={row.original.bookingsCompleted} />,
    },
    {
      accessorKey: "momChange",
      header: "vs Last Month",
      cell: ({ row }) => {
        const change = row.original.momChange;
        if (change === null) return <span className="text-gray-400">—</span>;
        return (
          <span
            className={tw(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              change > 0
                ? "bg-green-100 text-green-700"
                : change < 0
                ? "bg-red-100 text-red-700"
                : "bg-gray-100 text-gray-700"
            )}
          >
            {change > 0 ? "+" : ""}
            {change}%
          </span>
        );
      },
    },
  ];

  // Extract KPI values
  const totalBookings =
    (kpis.find((k) => k.id === "total_bookings")?.rawValue as number) || 0;
  const avgMonthly =
    (kpis.find((k) => k.id === "avg_monthly_bookings")?.rawValue as number) ||
    0;
  const peakMonth = kpis.find((k) => k.id === "peak_month")?.value || "—";
  const trendKpi = kpis.find((k) => k.id === "trend_direction");
  const trendDirection = trendKpi?.value || "Stable";
  const trendDeltaStr = trendKpi?.delta;
  const trendDelta = trendDeltaStr ? Number(trendDeltaStr) : null;
  const trendDescription = trendKpi?.description;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalBookings}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Bookings
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Average per Month</span>
              <span className="text-lg font-medium text-gray-900">
                {avgMonthly}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Peak Month</span>
              <span className="text-lg font-medium text-gray-900">
                {peakMonth}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">
                Trend (Last 2 Months)
              </span>
              <div
                className="group relative cursor-help"
                title={
                  trendDescription ||
                  "Compares the most recent month to the previous month"
                }
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={tw(
                      "text-lg font-medium",
                      trendDirection === "Increasing"
                        ? "text-green-600"
                        : trendDirection === "Decreasing"
                        ? "text-red-600"
                        : "text-gray-900"
                    )}
                  >
                    {trendDirection}
                  </span>
                  {trendDelta !== null && (
                    <span
                      className={tw(
                        "text-sm",
                        trendDelta > 0 ? "text-green-600" : "text-red-600"
                      )}
                    >
                      ({trendDelta > 0 ? "+" : ""}
                      {trendDelta})
                    </span>
                  )}
                </div>
                {/* Hover tooltip with more details */}
                {trendDescription && (
                  <div className="invisible absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:visible group-hover:opacity-100">
                    {trendDescription}
                    <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bar chart - proper Recharts visualization */}
      {chartSeries && chartSeries[0]?.data.length > 0 && (
        <ChartCard title="Booking Volume by Month">
          <div className="h-64">
            <BarChart
              series={chartSeries}
              radius={4}
              tooltipFormatter={(value) => `${value} bookings`}
            />
          </div>
        </ChartCard>
      )}

      {/* Data table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Monthly Breakdown
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          fillParent
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No trend data"
              description="No bookings in the selected timeframe."
            />
          }
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// R8: Asset Utilization Content
// -----------------------------------------------------------------------------

function AssetUtilizationContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: {
  rows: AssetUtilizationRow[];
  kpis: ReportKpi[];
  totalRows: number;
  onRowClick?: (row: AssetUtilizationRow) => void;
}) {
  // Column definitions for utilization table
  const columns: ColumnDef<AssetUtilizationRow>[] = [
    {
      accessorKey: "assetName",
      header: "Asset",
      cell: ({ row }) => (
        <AssetCell
          name={row.original.assetName}
          thumbnailImage={row.original.thumbnailImage}
        />
      ),
    },
    {
      accessorKey: "utilizationRate",
      header: "Usage Rate",
      cell: ({ row }) => {
        const rate = row.original.utilizationRate;
        return (
          <div className="flex items-center gap-2">
            <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-primary-500"
                style={{ width: `${Math.min(rate, 100)}%` }}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums text-gray-900">
              {rate}%
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "daysInUse",
      header: "Days Booked",
      cell: ({ row }) => (
        <span>
          {row.original.daysInUse} / {row.original.totalDays}
        </span>
      ),
    },
    {
      accessorKey: "bookingCount",
      header: "Bookings",
      cell: ({ row }) => <NumberCell value={row.original.bookingCount} />,
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category || <span className="text-gray-400">—</span>,
    },
    {
      accessorKey: "valuation",
      header: "Value",
      cell: ({ row }) =>
        row.original.valuation ? (
          `$${row.original.valuation.toLocaleString()}`
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
  ];

  // Extract KPI values
  const avgUtilization =
    (kpis.find((k) => k.id === "avg_utilization")?.rawValue as number) || 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric with visual bar */}
          <div className="flex items-center gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums text-gray-900">
                  {avgUtilization}%
                </span>
                <span className="text-sm font-medium text-gray-500">
                  average usage
                </span>
              </div>
              <div className="h-2 w-48 overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-primary-500"
                  style={{ width: `${Math.min(avgUtilization, 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Assets</span>
              <span className="text-lg font-medium text-gray-900">
                {totalRows}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Total Booking Days</span>
              <span className="text-lg font-medium text-gray-900">
                {kpis.find((k) => k.id === "total_booking_days")?.value || "0"}
              </span>
            </div>
          </div>
        </div>

        {/* How utilization is calculated */}
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 md:px-6">
          <p className="text-xs text-gray-500">
            <span className="font-medium text-gray-700">
              How it's calculated:
            </span>{" "}
            Usage rate = (total days booked ÷ days in period) × 100. Rates above
            100% indicate overlapping bookings where the asset was reserved
            multiple times simultaneously—a sign of high demand.
          </p>
        </div>
      </div>

      {/* Data table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Asset Usage Rates
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          fillParent
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No usage data"
              description="No booking activity to calculate usage rates."
            />
          }
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// R7: Asset Activity Content
// -----------------------------------------------------------------------------

function AssetActivityContent({
  rows,
  kpis,
  totalRows,
  onRowClick,
}: {
  rows: AssetActivityRow[];
  kpis: ReportKpi[];
  totalRows: number;
  onRowClick?: (row: AssetActivityRow) => void;
}) {
  // Column definitions for activity table
  const columns: ColumnDef<AssetActivityRow>[] = [
    {
      accessorKey: "assetName",
      header: "Asset",
      cell: ({ row }) => (
        <AssetCell
          name={row.original.assetName}
          thumbnailImage={row.original.thumbnailImage}
        />
      ),
    },
    {
      accessorKey: "activityType",
      header: "Activity",
      cell: ({ row }) => {
        const type = row.original.activityType;
        // Plain English labels — no jargon or internal codes
        const labels: Record<string, string> = {
          CREATED: "Asset created",
          UPDATED: "Asset updated",
          CUSTODY_ASSIGNED: "Assigned to team member",
          CUSTODY_RELEASED: "Returned from team member",
          BOOKING_CHECKED_OUT: "Checked out",
          BOOKING_CHECKED_IN: "Checked in",
          LOCATION_CHANGED: "Location changed",
          CATEGORY_CHANGED: "Category changed",
        };
        // Semantic colors for activity types
        const colors: Record<string, string> = {
          CREATED: "bg-green-100 text-green-700",
          UPDATED: "bg-blue-100 text-blue-700",
          CUSTODY_ASSIGNED: "bg-violet-100 text-violet-700",
          CUSTODY_RELEASED: "bg-violet-100 text-violet-700",
          BOOKING_CHECKED_OUT: "bg-orange-100 text-orange-700",
          BOOKING_CHECKED_IN: "bg-green-100 text-green-700",
          LOCATION_CHANGED: "bg-blue-100 text-blue-700",
          CATEGORY_CHANGED: "bg-blue-100 text-blue-700",
        };
        return (
          <span
            className={tw(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              colors[type] || "bg-gray-100 text-gray-700"
            )}
          >
            {labels[type] || type}
          </span>
        );
      },
    },
    {
      accessorKey: "performedBy",
      header: "Changed by",
      cell: ({ row }) =>
        row.original.performedBy || (
          <span className="text-gray-400">System</span>
        ),
    },
    {
      accessorKey: "occurredAt",
      header: "Date & Time",
      cell: ({ row }) => <DateCell date={row.original.occurredAt} />,
    },
  ];

  // Extract KPI values
  const totalActivities =
    (kpis.find((k) => k.id === "total_activities")?.rawValue as number) || 0;
  const custodyChanges =
    (kpis.find((k) => k.id === "custody_changes")?.rawValue as number) || 0;
  const bookingActivities =
    (kpis.find((k) => k.id === "booking_activities")?.rawValue as number) || 0;
  const mostActiveAsset =
    kpis.find((k) => k.id === "most_active_asset")?.value || "—";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric */}
          <div className="flex items-center gap-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-semibold text-gray-900">
                {totalActivities}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Total Activities
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Assignments</span>
              <span className="text-lg font-medium text-gray-900">
                {custodyChanges}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Check-ins/outs</span>
              <span className="text-lg font-medium text-gray-900">
                {bookingActivities}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Most Active Asset</span>
              <span
                className="max-w-[120px] truncate text-lg font-medium text-gray-900"
                title={mostActiveAsset}
              >
                {mostActiveAsset}
              </span>
            </div>
          </div>
        </div>

        {/* Activity types legend */}
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 md:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs font-medium text-gray-700">
              Activity types:
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Asset created
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Updated / Moved
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">
              Custody changed
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
              Checked out
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Checked in
            </span>
          </div>
        </div>
      </div>

      {/* Data table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Recent Activity
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          fillParent
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No activity"
              description="No asset activity recorded in this timeframe."
            />
          }
        />
      </div>
    </div>
  );
}
