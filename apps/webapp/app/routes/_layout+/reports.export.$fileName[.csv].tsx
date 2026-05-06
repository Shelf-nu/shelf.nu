/**
 * Report CSV Export Route
 *
 * Generates a CSV file for the requested report with current filters.
 * Follows the same pattern as assets.export.$fileName[.csv].tsx.
 *
 * @see {@link file://../../modules/reports/helpers.server.ts}
 */

import { data, type LoaderFunctionArgs } from "react-router";

import {
  resolveTimeframe,
  bookingComplianceReport,
  custodySnapshotReport,
  overdueItemsReport,
  idleAssetsReport,
  topBookedAssetsReport,
  assetInventoryReport,
  assetUtilizationReport,
  assetActivityReport,
  assetDistributionReport,
  monthlyBookingTrendsReport,
} from "~/modules/reports/helpers.server";
import { getReportById } from "~/modules/reports/registry";
import type {
  TimeframePreset,
  BookingComplianceRow,
  CustodySnapshotRow,
  OverdueItemRow,
  IdleAssetRow,
  TopBookedAssetRow,
  AssetInventoryRow,
  AssetUtilizationRow,
  AssetActivityRow,
  DistributionBreakdown,
  MonthlyBookingTrendRow,
} from "~/modules/reports/types";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getCurrentSearchParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.export,
    });

    const searchParams = getCurrentSearchParams(request);
    const reportId = searchParams.get("reportId");

    if (!reportId) {
      throw new ShelfError({
        cause: null,
        message: "Report ID is required for export",
        label: "Report",
        status: 400,
      });
    }

    // Validate report exists and supports export
    const reportDef = getReportById(reportId);
    if (!reportDef) {
      throw new ShelfError({
        cause: null,
        message: `Report "${reportId}" not found`,
        label: "Report",
        status: 404,
      });
    }

    if (!reportDef.exportable) {
      throw new ShelfError({
        cause: null,
        message: `Report "${reportDef.title}" does not support export`,
        label: "Report",
        status: 403,
      });
    }

    // Parse filters
    const timeframePreset =
      (searchParams.get("timeframe") as TimeframePreset) || "last_30d";
    const customFrom = searchParams.get("from");
    const customTo = searchParams.get("to");

    const timeframe = resolveTimeframe(
      timeframePreset,
      customFrom ? new Date(customFrom) : undefined,
      customTo ? new Date(customTo) : undefined
    );

    // Generate CSV based on report type
    let csvString: string;

    switch (reportId) {
      case "booking-compliance": {
        const reportData = await bookingComplianceReport({
          organizationId,
          timeframe,
          page: 1,
          pageSize: 10000, // Export up to 10k rows
        });
        csvString = generateBookingComplianceCsv(
          reportData.rows as BookingComplianceRow[]
        );
        break;
      }

      case "custody-snapshot": {
        const reportData = await custodySnapshotReport({
          organizationId,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateCustodySnapshotCsv(
          reportData.rows as CustodySnapshotRow[]
        );
        break;
      }

      case "overdue-items": {
        const reportData = await overdueItemsReport({
          organizationId,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateOverdueItemsCsv(
          reportData.rows as OverdueItemRow[]
        );
        break;
      }

      case "idle-assets": {
        const idleThreshold = parseInt(searchParams.get("days") || "30", 10);
        const reportData = await idleAssetsReport({
          organizationId,
          idleThresholdDays: idleThreshold,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateIdleAssetsCsv(reportData.rows as IdleAssetRow[]);
        break;
      }

      case "top-booked-assets": {
        const reportData = await topBookedAssetsReport({
          organizationId,
          timeframe,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateTopBookedAssetsCsv(
          reportData.rows as TopBookedAssetRow[]
        );
        break;
      }

      case "asset-inventory": {
        const reportData = await assetInventoryReport({
          organizationId,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateAssetInventoryCsv(
          reportData.rows as AssetInventoryRow[]
        );
        break;
      }

      case "asset-utilization": {
        const reportData = await assetUtilizationReport({
          organizationId,
          timeframe,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateAssetUtilizationCsv(
          reportData.rows as AssetUtilizationRow[]
        );
        break;
      }

      case "asset-activity": {
        const reportData = await assetActivityReport({
          organizationId,
          timeframe,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateAssetActivityCsv(
          reportData.rows as AssetActivityRow[]
        );
        break;
      }

      case "distribution": {
        const reportData = await assetDistributionReport({
          organizationId,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateDistributionCsv(reportData.distributionBreakdown);
        break;
      }

      case "monthly-booking-trends": {
        const reportData = await monthlyBookingTrendsReport({
          organizationId,
          timeframe,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateMonthlyBookingTrendsCsv(
          reportData.rows as MonthlyBookingTrendRow[]
        );
        break;
      }

      default:
        throw new ShelfError({
          cause: null,
          message: `Export not implemented for report "${reportId}"`,
          label: "Report",
          status: 500,
        });
    }

    // Get filename from URL params (e.g., "booking-compliance-last_30d-2026-04-22")
    const fileName = params.fileName || `${reportId}-export`;

    return new Response(csvString, {
      status: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="${fileName}.csv"`,
        "cache-control": "no-cache",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};

/**
 * Generate CSV for Booking Compliance report.
 *
 * Columns match the UI table display:
 * - Status: booking status (Complete, Ongoing, etc.)
 * - Return Status: "On time" or lateness duration (e.g., "4h 30m late")
 */
function generateBookingComplianceCsv(rows: BookingComplianceRow[]): string {
  const headers = [
    "Booking ID",
    "Booking Name",
    "Status",
    "Booked By",
    "Asset Count",
    "Scheduled Start",
    "Due Date",
    "Return Status",
  ];

  const csvRows = rows.map((row) => [
    row.bookingId,
    escapeCsvField(row.bookingName),
    formatStatus(row.status),
    row.custodian || "",
    row.assetCount.toString(),
    formatDateForCsv(row.scheduledStart),
    formatDateForCsv(row.scheduledEnd),
    formatReturnStatus(row.isOnTime, row.latenessMs),
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

/**
 * Generate CSV for Custody Snapshot report.
 */
function generateCustodySnapshotCsv(rows: CustodySnapshotRow[]): string {
  const headers = [
    "Asset ID",
    "Asset Name",
    "Category",
    "Location",
    "Assigned To",
    "Assigned Date",
    "Days Held",
    "Valuation",
  ];

  const csvRows = rows.map((row) => [
    row.assetId,
    escapeCsvField(row.assetName),
    row.category || "",
    row.location || "",
    row.custodianName,
    formatDateForCsv(row.assignedAt),
    row.daysInCustody.toString(),
    row.valuation?.toString() || "",
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

/**
 * Format booking status for CSV (human-readable).
 */
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

/**
 * Format return status for CSV - matches the UI table display.
 * Shows "On time" or the lateness duration (e.g., "4h 30m late").
 */
function formatReturnStatus(
  isOnTime: boolean,
  latenessMs: number | null
): string {
  if (isOnTime) {
    return "On time";
  }

  if (latenessMs === null) {
    return "Pending";
  }

  // Format lateness as human-readable
  const absMs = Math.abs(latenessMs);
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

  return latenessMs > 0 ? `${value} late` : `${value} early`;
}

/**
 * Escape a field for CSV format.
 */
function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Format date for CSV export.
 */
function formatDateForCsv(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().split("T")[0];
}

/**
 * Generate CSV for Overdue Items report.
 */
function generateOverdueItemsCsv(rows: OverdueItemRow[]): string {
  const headers = [
    "Booking ID",
    "Booking Name",
    "Booked By",
    "Asset Count",
    "Due Date",
    "Days Overdue",
    "Value at Risk",
  ];

  const csvRows = rows.map((row) => [
    row.bookingId,
    escapeCsvField(row.bookingName),
    row.custodian || "",
    row.assetCount.toString(),
    formatDateForCsv(row.scheduledEnd),
    row.daysOverdue.toString(),
    row.valueAtRisk?.toString() || "",
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

/**
 * Generate CSV for Idle Assets report.
 */
function generateIdleAssetsCsv(rows: IdleAssetRow[]): string {
  const headers = [
    "Asset ID",
    "Asset Name",
    "Category",
    "Location",
    "Last Booked",
    "Days Idle",
    "Valuation",
  ];

  const csvRows = rows.map((row) => [
    row.assetId,
    escapeCsvField(row.assetName),
    row.category || "",
    row.location || "",
    row.lastBookedAt ? formatDateForCsv(row.lastBookedAt) : "Never",
    row.daysSinceLastUse.toString(),
    row.valuation?.toString() || "",
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

/**
 * Generate CSV for Top Booked Assets report.
 */
function generateTopBookedAssetsCsv(rows: TopBookedAssetRow[]): string {
  const headers = [
    "Rank",
    "Asset ID",
    "Asset Name",
    "Category",
    "Location",
    "Booking Count",
    "Total Days Booked",
    "Avg Days per Booking",
  ];

  const csvRows = rows.map((row, index) => [
    (index + 1).toString(),
    row.assetId,
    escapeCsvField(row.assetName),
    row.category || "",
    row.location || "",
    row.bookingCount.toString(),
    row.totalDaysBooked.toString(),
    row.bookingCount > 0
      ? (row.totalDaysBooked / row.bookingCount).toFixed(1)
      : "0",
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

/**
 * Generate CSV for Asset Inventory report.
 */
function generateAssetInventoryCsv(rows: AssetInventoryRow[]): string {
  const headers = [
    "Asset ID",
    "Asset Name",
    "Category",
    "Location",
    "Status",
    "Custodian",
    "Valuation",
    "Created Date",
    "QR Code ID",
  ];

  const csvRows = rows.map((row) => [
    row.assetId,
    escapeCsvField(row.assetName),
    row.category || "",
    row.location || "",
    formatAssetStatus(row.status),
    row.custodian || "",
    row.valuation?.toString() || "",
    formatDateForCsv(row.createdAt),
    row.qrId || "",
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

/**
 * Generate CSV for Asset Utilization report.
 */
function generateAssetUtilizationCsv(rows: AssetUtilizationRow[]): string {
  const headers = [
    "Asset ID",
    "Asset Name",
    "Category",
    "Location",
    "Booking Count",
    "Days in Use",
    "Total Days",
    "Utilization Rate",
  ];

  const csvRows = rows.map((row) => [
    row.assetId,
    escapeCsvField(row.assetName),
    row.category || "",
    row.location || "",
    row.bookingCount.toString(),
    row.daysInUse.toString(),
    row.totalDays.toString(),
    `${row.utilizationRate}%`,
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

/**
 * Generate CSV for Asset Activity report.
 */
function generateAssetActivityCsv(rows: AssetActivityRow[]): string {
  const headers = [
    "Date",
    "Asset ID",
    "Asset Name",
    "Activity Type",
    "Description",
    "Performed By",
  ];

  const csvRows = rows.map((row) => [
    formatDateForCsv(row.occurredAt),
    row.assetId,
    escapeCsvField(row.assetName),
    formatActivityType(row.activityType),
    escapeCsvField(row.description || ""),
    row.performedBy || "System",
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}

/**
 * Format asset status for CSV.
 * Labels match asset-status-badge.tsx for consistency.
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
 * Format activity type for CSV.
 */
function formatActivityType(type: string): string {
  const labels: Record<string, string> = {
    CREATED: "Asset created",
    UPDATED: "Asset updated",
    CUSTODY_ASSIGNED: "Custody assigned",
    CUSTODY_RELEASED: "Custody released",
    BOOKING_CHECKED_OUT: "Checked out",
    BOOKING_CHECKED_IN: "Checked in",
    LOCATION_CHANGED: "Location changed",
    CATEGORY_CHANGED: "Category changed",
  };
  return labels[type] || type;
}

/**
 * Generate CSV for Asset Distribution report.
 *
 * Exports all three breakdowns (by category, location, and status) in a single CSV.
 * Each section is labeled with a "Breakdown Type" column for clarity.
 */
function generateDistributionCsv(breakdown: DistributionBreakdown): string {
  const headers = [
    "Breakdown Type",
    "Group",
    "Asset Count",
    "Percentage",
    "Total Valuation",
  ];

  const formatRows = (
    type: string,
    rows: DistributionBreakdown["byCategory"]
  ) =>
    rows.map((row) => [
      type,
      escapeCsvField(row.groupName),
      row.assetCount.toString(),
      `${row.percentage.toFixed(1)}%`,
      row.totalValue?.toString() || "",
    ]);

  const allRows = [
    ...formatRows("Category", breakdown.byCategory),
    ...formatRows("Location", breakdown.byLocation),
    ...formatRows("Status", breakdown.byStatus),
  ];

  return [headers.join(","), ...allRows.map((row) => row.join(","))].join("\n");
}

/**
 * Generate CSV for Monthly Booking Trends report.
 */
function generateMonthlyBookingTrendsCsv(
  rows: MonthlyBookingTrendRow[]
): string {
  const headers = [
    "Month",
    "Bookings Created",
    "Bookings Completed",
    "Unique Assets Booked",
    "Month-over-Month Change",
  ];

  const csvRows = rows.map((row) => [
    row.month,
    row.bookingsCreated.toString(),
    row.bookingsCompleted.toString(),
    row.uniqueAssetsBooked.toString(),
    row.momChange !== null
      ? `${row.momChange > 0 ? "+" : ""}${row.momChange}%`
      : "—",
  ]);

  return [headers.join(","), ...csvRows.map((row) => row.join(","))].join("\n");
}
