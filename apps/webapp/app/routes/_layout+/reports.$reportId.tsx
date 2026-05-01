/**
 * Report Runner Route
 *
 * Dynamic route that renders a specific report based on the reportId param.
 * The route owns three concerns:
 *   1. Permission + data loading via the per-report `*Report` server helpers.
 *   2. The page chrome (header, footer).
 *   3. Stitching together the small set of composition primitives
 *      (`ReportExportActions`, `ReportFilterBar`, `ReportContentSwitch`)
 *      that live under `~/components/reports/`.
 *
 * Each piece below — including the row-click handlers (`useReportRowHandlers`)
 * and the CSV export flow (`useCsvExport`) — lives in its own module so
 * the page component stays a thin wiring layer.
 *
 * @see {@link file://../../modules/reports/registry.ts}
 * @see {@link file://../../modules/reports/helpers.server.ts}
 * @see {@link file://../../components/reports/index.ts}
 */

import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData, useNavigation } from "react-router";

import Header from "~/components/layout/header";
import {
  ReportContentSwitch,
  ReportExportActions,
  ReportFilterBar,
  ReportFooter,
  useCsvExport,
  useReportRowHandlers,
} from "~/components/reports";
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
  ChartSeries,
  ComplianceData,
  DistributionBreakdown,
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
  const navigation = useNavigation();
  const handlers = useReportRowHandlers();

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
    distributionBreakdown,
    chartSeries,
  } = loaderData as typeof loaderData & {
    complianceData?: ComplianceData;
    topBookedAsset?: TopBookedAssetRow | null;
    distributionBreakdown?: DistributionBreakdown;
    chartSeries?: ChartSeries[];
  };

  const { isExporting, handleExport } = useCsvExport(
    reportId,
    filters.timeframe.preset
  );

  const hasData = rows.length > 0;

  return (
    <>
      <Header>
        <ReportExportActions
          reportId={reportId}
          timeframe={filters.timeframe}
          hasData={hasData}
          isExporting={isExporting}
          onCsvExport={handleExport}
        />
      </Header>

      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 md:mt-4 md:px-0">
        <ReportFilterBar
          reportId={reportId}
          timeframe={filters.timeframe}
          isLoading={isLoading}
        />

        <div className={tw("transition-opacity", isLoading && "opacity-60")}>
          <ReportContentSwitch
            reportId={reportId}
            rows={rows}
            kpis={kpis}
            totalRows={totalRows}
            timeframe={filters.timeframe}
            complianceData={complianceData}
            topBookedAsset={topBookedAsset}
            distributionBreakdown={distributionBreakdown}
            chartSeries={chartSeries}
            handlers={handlers}
          />
        </div>

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
