/**
 * Report CSV Export Route
 *
 * Generates a CSV file for the requested report with current filters.
 * Follows the same pattern as assets.export.$fileName[.csv].tsx.
 *
 * @see {@link file://../../modules/reports/helpers.server.ts}
 */

import { AUDIT_STATUS_LABELS } from "@shelf/labels";
import { data, type LoaderFunctionArgs } from "react-router";

import { auditCompletionReport } from "~/modules/reports/audit-completion.server";
import { formatDateForCsv } from "~/modules/reports/csv-format";
import {
  resolveTimeframe,
  bookingComplianceReport,
  custodySnapshotReport,
  overdueItemsReport,
  idleAssetsReport,
  topBookedAssetsReport,
  topBookedKitsReport,
  assetInventoryReport,
  assetUtilizationReport,
  assetActivityReport,
  assetDistributionReport,
  monthlyBookingTrendsReport,
} from "~/modules/reports/helpers.server";
import { getReportById } from "~/modules/reports/registry";
import type { AuditCompletionRow } from "~/modules/reports/types";
import type {
  TimeframePreset,
  BookingComplianceRow,
  CustodySnapshotRow,
  OverdueItemRow,
  IdleAssetRow,
  TopBookedAssetRow,
  TopBookedKitRow,
  AssetInventoryRow,
  AssetUtilizationRow,
  AssetActivityRow,
  DistributionBreakdown,
  MonthlyBookingTrendRow,
} from "~/modules/reports/types";
import { getClientHint } from "~/utils/client-hints";
import { csvResponse } from "~/utils/csv-utf8";
import { type ResolvedFormatPrefs } from "~/utils/date-format";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
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
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.reports,
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

    // Resolve the acting user's date/time formatting preferences so timeframe
    // labels (e.g. custom ranges) render in their configured format.
    const formatPrefs = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    const timeframe = resolveTimeframe(
      timeframePreset,
      customFrom ? new Date(customFrom) : undefined,
      customTo ? new Date(customTo) : undefined,
      formatPrefs
    );

    // Generate CSV based on report type
    let csvString: string;

    switch (reportId) {
      case "booking-compliance": {
        const reportData = await bookingComplianceReport({
          organizationId,
          timeframe,
          // Anchor trend-chart axis labels in the acting user's timezone (D2).
          timeZone: formatPrefs.timeZone,
          page: 1,
          pageSize: 10000, // Export up to 10k rows
        });
        csvString = generateBookingComplianceCsv(
          reportData.rows as BookingComplianceRow[],
          formatPrefs
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
          reportData.rows as CustodySnapshotRow[],
          formatPrefs
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
          reportData.rows as OverdueItemRow[],
          formatPrefs
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
        csvString = generateIdleAssetsCsv(
          reportData.rows as IdleAssetRow[],
          formatPrefs
        );
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

      case "top-booked-kits": {
        const reportData = await topBookedKitsReport({
          organizationId,
          timeframe,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateTopBookedKitsCsv(
          reportData.rows as TopBookedKitRow[]
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
          reportData.rows as AssetInventoryRow[],
          formatPrefs
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
          reportData.rows as AssetActivityRow[],
          formatPrefs
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

      case "audit-completion": {
        const reportData = await auditCompletionReport({
          organizationId,
          // The CSV must carry the same assignment scoping as the page —
          // an export is just the page's data in a file.
          userId,
          isSelfServiceOrBase,
          timeframe,
          page: 1,
          pageSize: 10000,
        });
        csvString = generateAuditCompletionCsv(
          reportData.rows as AuditCompletionRow[],
          formatPrefs
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

    return csvResponse(csvString, {
      headers: {
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
function generateBookingComplianceCsv(
  rows: BookingComplianceRow[],
  prefs: ResolvedFormatPrefs
): string {
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
    row.bookingName,
    formatStatus(row.status),
    row.custodian || "",
    row.assetCount.toString(),
    // Datetime columns: include the time part.
    formatDateForCsv(row.scheduledStart, prefs, { includeTime: true }),
    formatDateForCsv(row.scheduledEnd, prefs, { includeTime: true }),
    formatReturnStatus(row.isOnTime, row.latenessMs),
  ]);

  return buildCsv(headers, csvRows);
}

/**
 * Generate CSV for Custody Snapshot report.
 */
function generateCustodySnapshotCsv(
  rows: CustodySnapshotRow[],
  prefs: ResolvedFormatPrefs
): string {
  const headers = [
    "Asset ID",
    "Asset Name",
    "Category",
    "Location",
    "Assigned To",
    "Assigned Date",
    "Days Held",
    "Units Held",
    "Unit Value",
    "Total Value",
  ];

  const csvRows = rows.map((row) => [
    row.assetId,
    row.assetName,
    row.category || "",
    row.location || "",
    row.custodianName,
    // Datetime column: include the time part.
    formatDateForCsv(row.assignedAt, prefs, { includeTime: true }),
    row.daysInCustody.toString(),
    // Units held in THIS custody row (`Custody.quantity`), the multiplier
    // for this surface; null means one unit.
    (row.quantity ?? 1).toString(),
    row.valuation?.toString() || "",
    row.valuation == null
      ? ""
      : (row.valuation * (row.quantity ?? 1)).toString(),
  ]);

  return buildCsv(headers, csvRows);
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
 * Assembles a CSV document, escaping EVERY cell.
 *
 * Escaping lives here and nowhere else. Headers and body cells alike pass
 * through {@link escapeCsvField}, so a contributor adding a column gets a safe
 * cell with no per-field decision to make. Cells carry user-controlled
 * workspace values — custodian and member names, categories, locations — so
 * the guarantee has to be unconditional rather than applied where it looks
 * needed.
 *
 * Callers pass raw values: a cell escaped before it arrives is escaped twice.
 *
 * @param headers - Column headers, escaped like any other cell
 * @param rows - Row cells, already stringified and formatted, NOT escaped
 * @returns The complete CSV document
 */
function buildCsv(headers: string[], rows: string[][]): string {
  return [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ].join("\n");
}

/**
 * Escape a field for CSV format.
 */
function escapeCsvField(field: string): string {
  // Neutralize spreadsheet formula injection (CWE-1236): a value starting with
  // =, +, -, or @ can execute as a formula in Excel/Google Sheets. Prefix such
  // values with a single quote so the cell is treated as literal text. Applied
  // here in the shared helper so every report export is protected.
  const safeField = /^[=+\-@]/.test(field) ? `'${field}` : field;
  // `\r` is quoted alongside `\n`: a bare carriage return terminates a record in
  // consumers that accept CR as a line ending, so an unquoted one lets a
  // user-controlled value split the row and forge structure — which also puts
  // the injected content at the start of a "line", back inside formula range.
  if (
    safeField.includes(",") ||
    safeField.includes('"') ||
    safeField.includes("\n") ||
    safeField.includes("\r")
  ) {
    return `"${safeField.replace(/"/g, '""')}"`;
  }
  return safeField;
}

/**
 * Generate CSV for Overdue Items report.
 */
function generateOverdueItemsCsv(
  rows: OverdueItemRow[],
  prefs: ResolvedFormatPrefs
): string {
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
    row.bookingName,
    row.custodian || "",
    row.assetCount.toString(),
    // Datetime column: include the time part.
    formatDateForCsv(row.scheduledEnd, prefs, { includeTime: true }),
    row.daysOverdue.toString(),
    row.valueAtRisk?.toString() || "",
  ]);

  return buildCsv(headers, csvRows);
}

/**
 * Generate CSV for Idle Assets report.
 */
function generateIdleAssetsCsv(
  rows: IdleAssetRow[],
  prefs: ResolvedFormatPrefs
): string {
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
    row.assetName,
    row.category || "",
    row.location || "",
    // Date-only column: no time part.
    row.lastBookedAt ? formatDateForCsv(row.lastBookedAt, prefs) : "Never",
    row.daysSinceLastUse.toString(),
    row.valuation?.toString() || "",
  ]);

  return buildCsv(headers, csvRows);
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
    row.assetName,
    row.category || "",
    row.location || "",
    row.bookingCount.toString(),
    row.totalDaysBooked.toString(),
    row.bookingCount > 0
      ? (row.totalDaysBooked / row.bookingCount).toFixed(1)
      : "0",
  ]);

  return buildCsv(headers, csvRows);
}

/**
 * Generate CSV for Top Booked Kits report.
 */
function generateTopBookedKitsCsv(rows: TopBookedKitRow[]): string {
  const headers = [
    "Rank",
    "Kit ID",
    "Kit Name",
    "Category",
    "Location",
    "Booking Count",
    "Total Days Booked",
    "Avg Days per Booking",
  ];

  const csvRows = rows.map((row, index) => [
    (index + 1).toString(),
    row.kitId,
    row.kitName,
    row.category || "",
    row.location || "",
    row.bookingCount.toString(),
    row.totalDaysBooked.toString(),
    row.bookingCount > 0
      ? (row.totalDaysBooked / row.bookingCount).toFixed(1)
      : "0",
  ]);

  return buildCsv(headers, csvRows);
}

/**
 * Generate CSV for Asset Inventory report.
 */
function generateAssetInventoryCsv(
  rows: AssetInventoryRow[],
  prefs: ResolvedFormatPrefs
): string {
  const headers = [
    "Asset ID",
    "Asset Name",
    "Category",
    "Location",
    "Status",
    "Custodian",
    "Quantity",
    "Unit Value",
    "Total Value",
    "Created Date",
    "QR Code ID",
  ];

  const csvRows = rows.map((row) => [
    row.assetId,
    row.assetName,
    row.category || "",
    row.location || "",
    formatAssetStatus(row.status),
    row.custodian || "",
    // Workspace stock, the value multiplier for this surface; null means one.
    (row.quantity ?? 1).toString(),
    row.valuation?.toString() || "",
    row.valuation == null
      ? ""
      : (row.valuation * (row.quantity ?? 1)).toString(),
    // Date-only column: no time part.
    formatDateForCsv(row.createdAt, prefs),
    row.qrId || "",
  ]);

  return buildCsv(headers, csvRows);
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
    row.assetName,
    row.category || "",
    row.location || "",
    row.bookingCount.toString(),
    row.daysInUse.toString(),
    row.totalDays.toString(),
    `${row.utilizationRate}%`,
  ]);

  return buildCsv(headers, csvRows);
}

/**
 * Generate CSV for Asset Activity report.
 */
function generateAssetActivityCsv(
  rows: AssetActivityRow[],
  prefs: ResolvedFormatPrefs
): string {
  const headers = [
    "Date",
    "Asset ID",
    "Asset Name",
    "Activity Type",
    "Description",
    "Performed By",
  ];

  const csvRows = rows.map((row) => [
    // Datetime column ("Date & Time"): include the time part.
    formatDateForCsv(row.occurredAt, prefs, { includeTime: true }),
    row.assetId,
    row.assetName,
    formatActivityType(row.activityType),
    row.description || "",
    row.performedBy || "System",
  ]);

  return buildCsv(headers, csvRows);
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
      row.groupName,
      row.assetCount.toString(),
      `${row.percentage.toFixed(1)}%`,
      row.totalValue?.toString() || "",
    ]);

  const allRows = [
    ...formatRows("Category", breakdown.byCategory),
    ...formatRows("Location", breakdown.byLocation),
    ...formatRows("Status", breakdown.byStatus),
  ];

  return buildCsv(headers, allRows);
}

/**
 * Generate CSV for the Audit Completion report.
 *
 * Columns match the UI table: raw counters, accuracy, and the lifecycle
 * dates. Status uses the shared `AUDIT_STATUS_LABELS` words so the export
 * reads the same as every badge in the app.
 */
function generateAuditCompletionCsv(
  rows: AuditCompletionRow[],
  prefs: ResolvedFormatPrefs
): string {
  const headers = [
    "Audit ID",
    "Name",
    "Status",
    "Expected",
    "Found",
    "Missing",
    "Unexpected",
    "Accuracy",
    "Created By",
    "Started",
    "Due Date",
    "Completed",
  ];

  const csvRows = rows.map((row) => [
    row.id,
    row.name,
    AUDIT_STATUS_LABELS[row.status] || row.status,
    row.expectedAssetCount.toString(),
    row.foundAssetCount.toString(),
    // Null until completion (counter still counts "not scanned"): empty cell.
    row.missingAssetCount !== null ? row.missingAssetCount.toString() : "",
    row.unexpectedAssetCount.toString(),
    // Null accuracy (0 expected assets) exports as an empty cell, not "0%".
    row.accuracy !== null ? `${row.accuracy}%` : "",
    row.createdByName,
    // Datetime columns: include the time part; empty when unset.
    row.startedAt
      ? formatDateForCsv(row.startedAt, prefs, { includeTime: true })
      : "",
    row.dueDate
      ? formatDateForCsv(row.dueDate, prefs, { includeTime: true })
      : "",
    row.completedAt
      ? formatDateForCsv(row.completedAt, prefs, { includeTime: true })
      : "",
  ]);

  return buildCsv(headers, csvRows);
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

  return buildCsv(headers, csvRows);
}
