/**
 * @file Report content dispatcher.
 *
 * Routes the loader's payload to the right per-report Content component
 * based on `reportId`. Also owns the empty-state branch so the route
 * page doesn't have to know about it.
 *
 * This is the seam where the route-loaded payload (loosely typed via
 * `ReportPayload<any>` upstream) gets cast to the per-report row type
 * each Content component expects. The casts mirror what the original
 * inline switch in the route did before the extraction.
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 */

import type {
  AssetActivityRow,
  AssetInventoryRow,
  AssetUtilizationRow,
  BookingComplianceRow,
  ChartSeries,
  ComplianceData,
  CustodySnapshotRow,
  DistributionBreakdown,
  IdleAssetRow,
  MonthlyBookingTrendRow,
  OverdueItemRow,
  ReportKpi,
  ResolvedTimeframe,
  TopBookedAssetRow,
} from "~/modules/reports/types";

import { AssetActivityContent } from "./asset-activity-content";
import { AssetDistributionContent } from "./asset-distribution-content";
import { AssetInventoryContent } from "./asset-inventory-content";
import { AssetUtilizationContent } from "./asset-utilization-content";
import { BookingComplianceContent } from "./booking-compliance-content";
import { CustodySnapshotContent } from "./custody-snapshot-content";
import { IdleAssetsContent } from "./idle-assets-content";
import { MonthlyBookingTrendsContent } from "./monthly-booking-trends-content";
import { OverdueItemsContent } from "./overdue-items-content";
import { ReportEmptyState } from "./report-empty-state";
import { TopBookedAssetsContent } from "./top-booked-assets-content";
import type { ReportRowHandlers } from "./use-report-row-handlers";

/** Props for {@link ReportContentSwitch}. */
type Props = {
  /** Active report id; drives which Content component renders. */
  reportId: string;
  /** Page slice of rows for this report (typed loosely; cast per
   *  branch to the report's row type). */
  rows: unknown[];
  /** KPI cards aggregated for the page. */
  kpis: ReportKpi[];
  /** Total row count across all pages (display in tables). */
  totalRows: number;
  /** Resolved timeframe — used by some Content components for the
   *  hero label. */
  timeframe: ResolvedTimeframe;
  /** Booking-compliance-only payload extra. */
  complianceData?: ComplianceData;
  /** Top-booked-assets-only payload extra (the singular #1 asset). */
  topBookedAsset?: TopBookedAssetRow | null;
  /** Distribution-only payload extra. */
  distributionBreakdown?: DistributionBreakdown;
  /** Monthly-booking-trends-only payload extra. */
  chartSeries?: ChartSeries[];
  /** Stable row-click handlers from `useReportRowHandlers`. */
  handlers: ReportRowHandlers;
};

/**
 * Renders the right Content component for `reportId`, or an empty
 * state when there are no rows.
 */
export function ReportContentSwitch({
  reportId,
  rows,
  kpis,
  totalRows,
  timeframe,
  complianceData,
  topBookedAsset,
  distributionBreakdown,
  chartSeries,
  handlers,
}: Props) {
  // Distribution is the one report with no row table — it's purely
  // donut-driven, so `hasData` is meaningless there. Always render it
  // and let `AssetDistributionContent` handle its own empty state.
  if (reportId === "distribution") {
    return (
      <AssetDistributionContent
        kpis={kpis}
        distributionBreakdown={distributionBreakdown}
      />
    );
  }

  // Every other report falls back to a shared empty state when no
  // rows came back.
  if (rows.length === 0) {
    return (
      <div className="rounded border border-gray-200 bg-white">
        <ReportEmptyState
          reason="no_data"
          title={getEmptyStateTitle(reportId)}
          description={getEmptyStateDescription(reportId)}
          ctaTo={getEmptyStateCta(reportId)?.to}
          ctaLabel={getEmptyStateCta(reportId)?.label}
        />
      </div>
    );
  }

  switch (reportId) {
    case "booking-compliance":
      return (
        <BookingComplianceContent
          rows={rows as BookingComplianceRow[]}
          complianceData={complianceData}
          totalBookings={totalRows}
          timeframeLabel={timeframe.label}
          onRowClick={handlers.onBookingRowClick}
        />
      );

    case "overdue-items":
      return (
        <OverdueItemsContent
          rows={rows as OverdueItemRow[]}
          kpis={kpis}
          totalRows={totalRows}
          onRowClick={handlers.onBookingRowClick}
        />
      );

    case "idle-assets":
      return (
        <IdleAssetsContent
          rows={rows as IdleAssetRow[]}
          kpis={kpis}
          totalRows={totalRows}
          timeframeLabel={timeframe.label}
          onRowClick={handlers.onAssetRowClick}
        />
      );

    case "custody-snapshot":
      return (
        <CustodySnapshotContent
          rows={rows as CustodySnapshotRow[]}
          kpis={kpis}
          totalRows={totalRows}
          onRowClick={handlers.onAssetRowClick}
        />
      );

    case "top-booked-assets":
      return (
        <TopBookedAssetsContent
          rows={rows as TopBookedAssetRow[]}
          kpis={kpis}
          totalRows={totalRows}
          timeframeLabel={timeframe.label}
          topBookedAsset={topBookedAsset}
          onRowClick={handlers.onAssetRowClick}
        />
      );

    case "asset-inventory":
      return (
        <AssetInventoryContent
          rows={rows as AssetInventoryRow[]}
          kpis={kpis}
          totalRows={totalRows}
          onRowClick={handlers.onAssetRowClick}
        />
      );

    case "monthly-booking-trends":
      return (
        <MonthlyBookingTrendsContent
          rows={rows as MonthlyBookingTrendRow[]}
          kpis={kpis}
          totalRows={totalRows}
          chartSeries={chartSeries}
        />
      );

    case "asset-utilization":
      return (
        <AssetUtilizationContent
          rows={rows as AssetUtilizationRow[]}
          kpis={kpis}
          totalRows={totalRows}
          onRowClick={handlers.onAssetRowClick}
        />
      );

    case "asset-activity":
      return (
        <AssetActivityContent
          rows={rows as AssetActivityRow[]}
          kpis={kpis}
          totalRows={totalRows}
          onRowClick={handlers.onAssetRowClick}
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
}

// -----------------------------------------------------------------------------
// Empty-state copy
//
// Reports are analytics views, not action prompts. The primary guidance
// should help users find data (expand timeframe, adjust filters), not
// necessarily create new data.
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
 * Returns a CTA for the empty state, if appropriate. For analytics
 * reports we intentionally return `null` because "create new data"
 * isn't the right action when viewing reports — the user came here
 * to analyze, not to create.
 */
function getEmptyStateCta(
  _reportId: string
): { to: string; label: string } | null {
  // For now, no reports have a CTA in their empty state.
  // The appropriate action is to adjust the timeframe, which is
  // already available via the TimeframePicker above.
  return null;
}
