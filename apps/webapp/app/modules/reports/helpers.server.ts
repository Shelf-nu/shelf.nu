/**
 * Reports Helpers — Server-Side Data Fetching
 *
 * Report-specific data fetching functions. Each report has a dedicated helper
 * that returns a `ReportPayload` with pre-aggregated KPIs, table rows, and
 * optional chart series.
 *
 * These helpers call into the activity-event reports module for event-driven
 * data and query operational tables directly for current-state snapshots.
 *
 * @see {@link file://./types.ts}
 * @see {@link file://../activity-event/reports.server.ts}
 */

import type {
  ActivityAction,
  AssetStatus,
  BookingStatus,
  Prisma,
} from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import type {
  AssetActivityRow,
  AssetActivityType,
  AssetDistributionRow,
  AssetInventoryRow,
  AssetUtilizationRow,
  BookingComplianceRow,
  ChartDataPoint,
  ChartSeries,
  ComplianceData,
  ComplianceTrendPoint,
  CustodianPerformanceData,
  CustodySnapshotRow,
  DistributionBreakdown,
  IdleAssetRow,
  MonthlyBookingTrendRow,
  OverdueItemRow,
  ReportKpi,
  ReportPayload,
  ResolvedTimeframe,
  TopBookedAssetRow,
} from "./types";
import { bookingStatusTransitionCounts } from "../activity-event/reports.server";

// Re-export timeframe utilities for server use
export { resolveTimeframe } from "./timeframe";

// -----------------------------------------------------------------------------
// Name Formatting
// -----------------------------------------------------------------------------

/**
 * Strip role suffixes from display names.
 * Removes "(Owner)" which is a role indicator added for display, not part of the actual name.
 */
function stripNameSuffix(name: string | null | undefined): string {
  if (!name) return "Unknown";
  return name.replace(/\s*\(Owner\)$/i, "").trim() || "Unknown";
}

// -----------------------------------------------------------------------------
// Compliance Constants
// -----------------------------------------------------------------------------

/**
 * Grace period for on-time returns: 15 minutes after scheduled end time.
 * A booking is considered "on-time" if returned within this window.
 *
 * IMPORTANT: This constant must be used everywhere that calculates on-time vs late.
 */
const COMPLIANCE_GRACE_PERIOD_MS = 15 * 60 * 1000;

/**
 * Check if a booking was returned on-time (within grace period of scheduled end).
 */
function isBookingOnTime(
  scheduledEnd: Date | null,
  completedAt: Date | null
): boolean {
  if (!scheduledEnd || !completedAt) return true; // No data = assume on-time
  const msLate = completedAt.getTime() - scheduledEnd.getTime();
  return msLate <= COMPLIANCE_GRACE_PERIOD_MS;
}

// -----------------------------------------------------------------------------
// R2: Booking Compliance Report
// -----------------------------------------------------------------------------

/** Valid sort columns for booking compliance report */
export type BookingComplianceSortColumn =
  | "bookingName"
  | "status"
  | "custodian"
  | "assetCount"
  | "scheduledStart"
  | "scheduledEnd"
  | "returnStatus"; // Computed column - sorts by latenessMs

interface BookingComplianceArgs {
  organizationId: string;
  timeframe: ResolvedTimeframe;
  statusFilter?: BookingStatus[];
  custodianId?: string;
  locationId?: string;
  page?: number;
  pageSize?: number;
  /** Column to sort by */
  sortBy?: BookingComplianceSortColumn;
  /** Sort direction */
  sortOrder?: "asc" | "desc";
}

/**
 * Generate the Booking Compliance report (R2).
 *
 * This report tracks booking lifecycle compliance:
 * - On-time checkouts and check-ins
 * - Late returns
 * - Currently overdue items
 *
 * KPIs are pre-aggregated via SQL. The chart shows status transition trends.
 *
 * @param args - Report parameters
 * @returns Complete report payload
 */
export async function bookingComplianceReport(
  args: BookingComplianceArgs
): Promise<ReportPayload<BookingComplianceRow>> {
  const {
    organizationId,
    timeframe,
    statusFilter,
    custodianId,
    locationId,
    page = 1,
    pageSize = 50,
    sortBy = "scheduledEnd",
    sortOrder = "desc",
  } = args;

  const startTime = performance.now();

  try {
    // Build the where clause for bookings
    // Compliance can only be measured on bookings that:
    // 1. Had a due date (scheduledEnd/to) within the selected timeframe
    // 2. Have a measurable outcome (COMPLETE or OVERDUE)
    const where: Prisma.BookingWhereInput = {
      organizationId,
      to: { gte: timeframe.from, lte: timeframe.to }, // Due date in timeframe
      status: { in: ["COMPLETE", "OVERDUE"] }, // Measurable outcomes only
    };

    // Allow further status filtering within the measurable statuses
    if (statusFilter && statusFilter.length > 0) {
      const measurableStatuses = statusFilter.filter(
        (s) => s === "COMPLETE" || s === "OVERDUE"
      );
      if (measurableStatuses.length > 0) {
        where.status = { in: measurableStatuses as BookingStatus[] };
      }
    }

    if (custodianId) {
      where.custodianUserId = custodianId;
    }

    // Location filter — match bookings whose pivot rows include at
    // least one asset at the given location. Phase 3a's `BookingAsset`
    // pivot makes this join expressible directly in the where clause.
    if (locationId) {
      where.bookingAssets = {
        some: { asset: { locationId } },
      };
    }

    // Fetch all data in parallel
    const [
      kpis,
      rowsResult,
      chartData,
      complianceData,
      complianceTrend,
      custodianPerformance,
    ] = await Promise.all([
      computeBookingComplianceKpis(organizationId, timeframe, where),
      fetchBookingComplianceRows(where, page, pageSize, sortBy, sortOrder),
      bookingStatusTransitionCounts({
        organizationId,
        from: timeframe.from,
        to: timeframe.to,
      }),
      // Compliance rate calculation with prior period comparison
      computeComplianceRate(organizationId, timeframe),
      // Weekly compliance trend
      computeComplianceTrend(organizationId, timeframe),
      // Custodian performance breakdown
      computeCustodianPerformance(organizationId, timeframe),
    ]);

    // Transform chart data
    const chartSeries = [
      {
        id: "status-transitions",
        name: "Status Transitions",
        data: chartData.map(
          (d): ChartDataPoint => ({
            date: d.toStatus,
            value: d.count,
            label: formatStatusLabel(d.toStatus as BookingStatus),
          })
        ),
      },
    ];

    const computedMs = Math.round(performance.now() - startTime);

    return {
      report: {
        id: "booking-compliance",
        title: "Booking Compliance",
        description:
          "Track on-time return rates for bookings within the selected timeframe.",
      },
      filters: {
        timeframe,
        filters: [], // TODO: Populate from args
      },
      kpis,
      rows: rowsResult.rows,
      chartSeries,
      // Compliance visualizations data
      complianceData,
      complianceTrend,
      custodianPerformance,
      computedMs,
      totalRows: rowsResult.totalCount,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Booking Compliance report",
      additionalData: { organizationId, timeframe: timeframe.preset },
    });
  }
}

async function computeBookingComplianceKpis(
  organizationId: string,
  timeframe: ResolvedTimeframe,
  baseWhere: Prisma.BookingWhereInput
): Promise<ReportKpi[]> {
  // Count bookings by status in the timeframe
  // Only COMPLETE and OVERDUE are measurable for compliance
  const [total, complete, overdue] = await Promise.all([
    db.booking.count({ where: baseWhere }),
    db.booking.count({
      where: { ...baseWhere, status: "COMPLETE" },
    }),
    db.booking.count({
      where: { ...baseWhere, status: "OVERDUE" },
    }),
  ]);

  // For "completed on time" we need to check if checkin happened before scheduled end
  // This is a simplified version — full implementation would check ActivityEvent
  const completedOnTime = complete; // Simplified for now
  const completedLate = 0; // Would need ActivityEvent analysis

  // Calculate delta vs prior period (simplified — same length period before)
  const priorPeriodLength = timeframe.to.getTime() - timeframe.from.getTime();
  const priorFrom = new Date(timeframe.from.getTime() - priorPeriodLength);
  const priorTo = new Date(timeframe.from.getTime() - 1);

  const priorTotal = await db.booking.count({
    where: {
      organizationId,
      OR: [
        { from: { gte: priorFrom, lte: priorTo } },
        { to: { gte: priorFrom, lte: priorTo } },
      ],
    },
  });

  // Only show delta when we have current data (showing -100% for 0 is not helpful)
  const showDelta = total > 0 && priorTotal > 0;
  const totalDelta = showDelta
    ? Math.round(((total - priorTotal) / priorTotal) * 100)
    : 0;

  // Calculate compliance rate
  const complianceRate =
    completedOnTime > 0
      ? Math.round((completedOnTime / (completedOnTime + completedLate)) * 100)
      : total > 0
      ? 0
      : 100; // 100% if no bookings yet

  return [
    {
      id: "compliance_rate",
      label: "Compliance Rate",
      value: `${complianceRate}%`,
      rawValue: complianceRate,
      format: "percent",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_bookings",
      label: "Total Bookings",
      value: total.toLocaleString(),
      rawValue: total,
      format: "number",
      delta:
        showDelta && totalDelta !== 0
          ? `${totalDelta > 0 ? "+" : ""}${totalDelta}%`
          : null,
      deltaType:
        totalDelta > 0 ? "positive" : totalDelta < 0 ? "negative" : "neutral",
      deltaPeriodLabel: showDelta
        ? `vs prior ${timeframe.label.toLowerCase()}`
        : undefined,
    },
    {
      id: "completed_on_time",
      label: "On-Time Returns",
      value: completedOnTime.toLocaleString(),
      rawValue: completedOnTime,
      format: "number",
      delta: null,
      deltaType: "positive",
    },
    {
      id: "overdue",
      label: "Overdue",
      value: overdue.toLocaleString(),
      rawValue: overdue,
      format: "number",
      delta: null,
      deltaType: overdue > 0 ? "negative" : "positive",
    },
  ];
}

/**
 * Fetch booking compliance rows with server-side sorting and pagination.
 *
 * For computed columns (returnStatus/latenessMs), we must fetch all rows,
 * compute values, sort in memory, then paginate. This ensures consistent
 * sorting across all pages.
 */
async function fetchBookingComplianceRows(
  where: Prisma.BookingWhereInput,
  page: number,
  pageSize: number,
  sortBy: BookingComplianceSortColumn = "scheduledEnd",
  sortOrder: "asc" | "desc" = "desc"
): Promise<{ rows: BookingComplianceRow[]; totalCount: number }> {
  // Fetch ALL matching bookings (no pagination at DB level)
  // This is necessary for computed column sorting (returnStatus/latenessMs)
  const bookings = await db.booking.findMany({
    where,
    select: {
      id: true,
      name: true,
      status: true,
      from: true,
      to: true,
      updatedAt: true,
      custodianUser: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      custodianTeamMember: {
        select: {
          name: true,
        },
      },
      // Phase 3a renamed the implicit `Asset <-> Booking` M2M to the
      // explicit `BookingAsset` pivot. `_count.assets` no longer exists;
      // count the pivot rows instead.
      _count: {
        select: {
          bookingAssets: true,
        },
      },
    },
  });

  // Transform to row objects with computed fields
  const allRows: BookingComplianceRow[] = bookings.map((b) => {
    // Calculate lateness: positive = late, negative = early
    const latenessMs =
      b.to && b.updatedAt
        ? new Date(b.updatedAt).getTime() - new Date(b.to).getTime()
        : null;

    return {
      id: b.id,
      bookingId: b.id,
      bookingName: b.name || `Booking ${b.id.slice(0, 8)}`,
      status: b.status,
      custodian: b.custodianUser
        ? stripNameSuffix(
            `${b.custodianUser.firstName || ""} ${
              b.custodianUser.lastName || ""
            }`.trim()
          )
        : b.custodianTeamMember
        ? stripNameSuffix(b.custodianTeamMember.name)
        : null,
      assetCount: b._count.bookingAssets,
      scheduledStart: b.from!,
      scheduledEnd: b.to!,
      actualCheckout: null,
      actualCheckin: null,
      isOnTime: isBookingOnTime(b.to, b.updatedAt),
      isOverdue: b.status === "OVERDUE",
      latenessMs,
    };
  });

  // Sort all rows by the requested column
  const sortedRows = sortBookingComplianceRows(allRows, sortBy, sortOrder);

  // Apply pagination
  const paginatedRows = sortedRows.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  return {
    rows: paginatedRows,
    totalCount: allRows.length,
  };
}

/**
 * Sort booking compliance rows by the specified column.
 */
/**
 * Sort booking compliance rows by the specified column.
 * Null/empty values always sort last, regardless of sort direction.
 */
function sortBookingComplianceRows(
  rows: BookingComplianceRow[],
  sortBy: BookingComplianceSortColumn,
  sortOrder: "asc" | "desc"
): BookingComplianceRow[] {
  const multiplier = sortOrder === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    switch (sortBy) {
      case "bookingName":
        return a.bookingName.localeCompare(b.bookingName) * multiplier;

      case "status":
        return a.status.localeCompare(b.status) * multiplier;

      case "custodian":
        // Null custodians ALWAYS sort last (don't apply multiplier to null handling)
        if (!a.custodian && !b.custodian) return 0;
        if (!a.custodian) return 1; // a (null) always after b
        if (!b.custodian) return -1; // b (null) always after a
        return a.custodian.localeCompare(b.custodian) * multiplier;

      case "assetCount":
        return (a.assetCount - b.assetCount) * multiplier;

      case "scheduledStart":
        return (
          (new Date(a.scheduledStart).getTime() -
            new Date(b.scheduledStart).getTime()) *
          multiplier
        );

      case "scheduledEnd":
        return (
          (new Date(a.scheduledEnd).getTime() -
            new Date(b.scheduledEnd).getTime()) *
          multiplier
        );

      case "returnStatus":
        // Null latenessMs (pending) ALWAYS sort last (don't apply multiplier to null handling)
        if (a.latenessMs === null && b.latenessMs === null) return 0;
        if (a.latenessMs === null) return 1; // a (pending) always after b
        if (b.latenessMs === null) return -1; // b (pending) always after a
        return (a.latenessMs - b.latenessMs) * multiplier;

      default:
        return 0;
    }
  });
}

function formatStatusLabel(status: BookingStatus): string {
  const labels: Record<BookingStatus, string> = {
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

// -----------------------------------------------------------------------------
// Compliance Rate Calculation
// -----------------------------------------------------------------------------

/**
 * Calculate compliance rate for completed bookings in the timeframe.
 *
 * A booking is "on-time" if it was marked COMPLETE and doesn't have OVERDUE
 * in its history. For now, we use a simplified heuristic based on whether
 * the booking ever had OVERDUE status.
 */
async function computeComplianceRate(
  organizationId: string,
  timeframe: ResolvedTimeframe
): Promise<ComplianceData> {
  // Count completed bookings that were scheduled to end in this timeframe
  // Using `to` (scheduled end date) for consistency with table filtering
  const completedBookings = await db.booking.findMany({
    where: {
      organizationId,
      status: "COMPLETE",
      // Bookings scheduled to end within the timeframe
      to: { gte: timeframe.from, lte: timeframe.to },
    },
    select: {
      id: true,
      from: true,
      to: true,
      updatedAt: true,
    },
  });

  // Calculate on-time vs late
  const { onTime, late } = categorizeCompletions(completedBookings);
  const total = onTime + late;
  // Return null rate when no completed bookings - UI should show "—" instead of misleading "100%"
  const rate = total > 0 ? Math.round((onTime / total) * 100) : null;

  // Calculate prior period for comparison
  const periodLength = timeframe.to.getTime() - timeframe.from.getTime();
  const priorFrom = new Date(timeframe.from.getTime() - periodLength);
  const priorTo = new Date(timeframe.from.getTime() - 1);

  const priorBookings = await db.booking.findMany({
    where: {
      organizationId,
      status: "COMPLETE",
      // Filter by scheduled end date for consistency with main query
      to: { gte: priorFrom, lte: priorTo },
    },
    select: {
      id: true,
      from: true,
      to: true,
      updatedAt: true,
    },
  });

  const priorResults = categorizeCompletions(priorBookings);
  const priorTotal = priorResults.onTime + priorResults.late;
  const priorRate =
    priorTotal > 0
      ? Math.round((priorResults.onTime / priorTotal) * 100)
      : null;

  // Only show comparison if we have valid rates in both periods
  const priorPeriod =
    rate !== null && priorRate !== null
      ? {
          rate: priorRate,
          delta: rate - priorRate,
          periodLabel: getPriorPeriodLabel(timeframe.preset),
          // Include dates for custom ranges so UI can show them
          fromDate: priorFrom,
          toDate: priorTo,
        }
      : undefined;

  return { onTime, late, rate, priorPeriod };
}

/**
 * Categorize completed bookings as on-time or late.
 */
function categorizeCompletions(
  bookings: { to: Date | null; updatedAt: Date | null }[]
): { onTime: number; late: number } {
  let onTime = 0;
  let late = 0;

  for (const booking of bookings) {
    if (isBookingOnTime(booking.to, booking.updatedAt)) {
      onTime++;
    } else {
      late++;
    }
  }

  return { onTime, late };
}

/**
 * Get human-readable label for the prior period.
 */
function getPriorPeriodLabel(preset: string): string {
  switch (preset) {
    case "last_7d":
      return "prior week";
    case "last_30d":
      return "prior 30 days";
    case "last_90d":
      return "prior quarter";
    case "this_quarter":
      return "last quarter";
    case "last_quarter":
      return "Q before";
    case "this_year":
      return "last year";
    default:
      return "prior period";
  }
}

/**
 * Calculate weekly compliance trend within the timeframe.
 *
 * Breaks the timeframe into weeks and calculates compliance rate for each.
 * This enables the trend visualization showing improvement/decline over time.
 */
async function computeComplianceTrend(
  organizationId: string,
  timeframe: ResolvedTimeframe
): Promise<ComplianceTrendPoint[]> {
  const periodMs = timeframe.to.getTime() - timeframe.from.getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  const msPerWeek = 7 * msPerDay;
  const periodDays = periodMs / msPerDay;

  // Adaptive granularity: daily for short periods, weekly for longer
  const useDailyGranularity = periodDays <= 14;
  const bucketMs = useDailyGranularity ? msPerDay : msPerWeek;
  const numBuckets = Math.max(1, Math.ceil(periodMs / bucketMs));

  // Fetch all measurable bookings (COMPLETE and OVERDUE) with due date in timeframe
  const measurableBookings = await db.booking.findMany({
    where: {
      organizationId,
      status: { in: ["COMPLETE", "OVERDUE"] },
      to: { gte: timeframe.from, lte: timeframe.to },
    },
    select: {
      to: true,
      status: true,
      updatedAt: true,
    },
  });

  // Build time buckets
  const trend: ComplianceTrendPoint[] = [];

  for (let i = 0; i < numBuckets; i++) {
    const bucketStart = new Date(timeframe.from.getTime() + i * bucketMs);
    const bucketEnd = new Date(
      Math.min(bucketStart.getTime() + bucketMs - 1, timeframe.to.getTime())
    );

    // Filter bookings with due date in this bucket
    const bucketBookings = measurableBookings.filter((b) => {
      const dueDate = b.to?.getTime() || 0;
      return dueDate >= bucketStart.getTime() && dueDate <= bucketEnd.getTime();
    });

    // Categorize using same grace period logic as hero
    const onTime = bucketBookings.filter((b) =>
      isBookingOnTime(b.to, b.updatedAt)
    ).length;
    const late = bucketBookings.filter(
      (b) => !isBookingOnTime(b.to, b.updatedAt)
    ).length;
    const total = onTime + late;

    // null rate for empty buckets (no data, not 0% compliance)
    const rate = total > 0 ? Math.round((onTime / total) * 100) : null;

    // Format label based on granularity
    const label = useDailyGranularity
      ? formatDayLabel(bucketStart)
      : numBuckets <= 4
      ? `Week ${i + 1}`
      : formatWeekLabel(bucketStart, bucketEnd);

    trend.push({
      label,
      weekStart: bucketStart,
      rate,
      onTime,
      late,
      total,
    });
  }

  return trend;
}

/**
 * Format day as "Mon 21" style label.
 */
function formatDayLabel(date: Date): string {
  const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
  const dayNum = date.getDate();
  return `${dayName} ${dayNum}`;
}

/**
 * Format week range as "Mar 3-9" style label.
 */
function formatWeekLabel(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString("en-US", { month: "short" });
  const startDay = start.getDate();
  const endDay = end.getDate();

  // If same month, show "Mar 3-9"
  // If different months, show "Mar 28-Apr 3"
  const endMonth = end.toLocaleDateString("en-US", { month: "short" });
  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }
  return `${startMonth} ${startDay}-${endMonth} ${endDay}`;
}

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Custodian Performance
// -----------------------------------------------------------------------------

/**
 * Calculate compliance rate by custodian.
 *
 * Returns custodians sorted by worst performance first (lowest compliance rate).
 * This helps identify team members who may need support or process improvements.
 */
async function computeCustodianPerformance(
  organizationId: string,
  timeframe: ResolvedTimeframe
): Promise<CustodianPerformanceData[]> {
  // Fetch completed bookings with custodian info
  const completedBookings = await db.booking.findMany({
    where: {
      organizationId,
      status: "COMPLETE",
      // Filter by scheduled end date for consistency with main compliance query
      to: { gte: timeframe.from, lte: timeframe.to },
    },
    select: {
      to: true,
      updatedAt: true,
      custodianUserId: true,
      custodianUser: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      custodianTeamMemberId: true,
      custodianTeamMember: {
        select: {
          name: true,
        },
      },
    },
  });

  // Group by custodian
  const custodianMap = new Map<
    string,
    {
      name: string;
      onTime: number;
      late: number;
    }
  >();

  for (const booking of completedBookings) {
    const key =
      booking.custodianUserId || booking.custodianTeamMemberId || "__none__";
    const name = booking.custodianUser
      ? stripNameSuffix(
          `${booking.custodianUser.firstName || ""} ${
            booking.custodianUser.lastName || ""
          }`.trim()
        )
      : booking.custodianTeamMember
      ? stripNameSuffix(booking.custodianTeamMember.name)
      : "No Custodian";

    if (!custodianMap.has(key)) {
      custodianMap.set(key, { name, onTime: 0, late: 0 });
    }

    const entry = custodianMap.get(key)!;

    // Use same grace period logic as hero
    if (isBookingOnTime(booking.to, booking.updatedAt)) {
      entry.onTime++;
    } else {
      entry.late++;
    }
  }

  // Convert to array and calculate rates
  const results: CustodianPerformanceData[] = [];

  for (const [key, data] of custodianMap) {
    const total = data.onTime + data.late;
    const rate = total > 0 ? Math.round((data.onTime / total) * 100) : 100;

    results.push({
      custodianId: key === "__none__" ? null : key,
      custodianName: data.name,
      onTime: data.onTime,
      late: data.late,
      total,
      rate,
    });
  }

  // Sort by worst performance first (lowest rate), then by most bookings
  results.sort((a, b) => {
    if (a.rate !== b.rate) return a.rate - b.rate;
    return b.total - a.total;
  });

  return results;
}

// -----------------------------------------------------------------------------
// R6: Overdue Items Report
// -----------------------------------------------------------------------------

interface OverdueItemsArgs {
  organizationId: string;
  custodianId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Overdue Items report (R6).
 *
 * This is a live report showing all currently overdue bookings.
 * No timeframe filter - always shows current state.
 *
 * @param args - Report parameters
 * @returns Complete report payload
 */
export async function overdueItemsReport(
  args: OverdueItemsArgs
): Promise<ReportPayload<OverdueItemRow>> {
  const { organizationId, custodianId, page = 1, pageSize = 50 } = args;

  const startTime = performance.now();

  try {
    // Build where clause
    const where: Prisma.BookingWhereInput = {
      organizationId,
      status: "OVERDUE",
    };

    if (custodianId) {
      where.custodianUserId = custodianId;
    }

    // Fetch data in parallel
    const [rows, totalCount, kpis] = await Promise.all([
      fetchOverdueRows(where, page, pageSize),
      db.booking.count({ where }),
      computeOverdueKpis(organizationId, where),
    ]);

    const computedMs = Math.round(performance.now() - startTime);

    // Create a "now" timeframe for display purposes
    const now = new Date();
    const timeframe: ResolvedTimeframe = {
      preset: "today",
      from: now,
      to: now,
      label: "Current",
    };

    return {
      report: {
        id: "overdue-items",
        title: "Overdue Items",
        description:
          "Live view of all currently overdue bookings requiring immediate attention.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows,
      computedMs,
      totalRows: totalCount,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Overdue Items report",
      additionalData: { organizationId },
    });
  }
}

async function fetchOverdueRows(
  where: Prisma.BookingWhereInput,
  page: number,
  pageSize: number
): Promise<OverdueItemRow[]> {
  const now = new Date();

  const bookings = await db.booking.findMany({
    where,
    orderBy: { to: "asc" }, // Most overdue first (earliest scheduled end)
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      name: true,
      to: true,
      custodianUserId: true,
      custodianUser: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      custodianTeamMember: {
        select: {
          name: true,
        },
      },
      // Phase 3a: walk the BookingAsset pivot to reach the asset for
      // valuation, and count pivot rows for asset count.
      bookingAssets: {
        select: {
          asset: {
            select: { valuation: true },
          },
        },
      },
      _count: {
        select: {
          bookingAssets: true,
        },
      },
    },
  });

  return bookings.map((b) => {
    const scheduledEnd = b.to!;
    const msOverdue = now.getTime() - scheduledEnd.getTime();
    const daysOverdue = Math.max(
      0,
      Math.ceil(msOverdue / (1000 * 60 * 60 * 24))
    );

    // Sum up asset valuations through the pivot.
    const valueAtRisk = b.bookingAssets.reduce(
      (sum, ba) => sum + (ba.asset.valuation || 0),
      0
    );

    return {
      id: b.id,
      bookingId: b.id,
      bookingName: b.name || `Booking ${b.id.slice(0, 8)}`,
      custodian: b.custodianUser
        ? stripNameSuffix(
            `${b.custodianUser.firstName || ""} ${
              b.custodianUser.lastName || ""
            }`.trim()
          )
        : b.custodianTeamMember
        ? stripNameSuffix(b.custodianTeamMember.name)
        : null,
      custodianId: b.custodianUserId,
      assetCount: b._count.bookingAssets,
      scheduledEnd,
      daysOverdue,
      valueAtRisk: valueAtRisk > 0 ? valueAtRisk : null,
    };
  });
}

async function computeOverdueKpis(
  organizationId: string,
  baseWhere: Prisma.BookingWhereInput
): Promise<ReportKpi[]> {
  const now = new Date();

  // Fetch all overdue bookings with asset info via the BookingAsset pivot.
  // `organizationId` is spread into the where alongside `baseWhere` as a
  // defense-in-depth guard — if a caller forgets to scope the base where
  // we still won't leak across orgs.
  const overdueBookings = await db.booking.findMany({
    where: { ...baseWhere, organizationId },
    select: {
      to: true,
      bookingAssets: {
        select: {
          asset: {
            select: { valuation: true },
          },
        },
      },
      _count: {
        select: {
          bookingAssets: true,
        },
      },
    },
  });

  const totalOverdue = overdueBookings.length;
  const totalAssetsAtRisk = overdueBookings.reduce(
    (sum, b) => sum + b._count.bookingAssets,
    0
  );

  // Calculate value at risk by walking the pivot.
  const totalValueAtRisk = overdueBookings.reduce(
    (sum, b) =>
      sum +
      b.bookingAssets.reduce(
        (assetSum, ba) => assetSum + (ba.asset.valuation || 0),
        0
      ),
    0
  );

  // Calculate days overdue
  const daysOverdueList = overdueBookings.map((b) => {
    const scheduledEnd = b.to!;
    const msOverdue = now.getTime() - scheduledEnd.getTime();
    return Math.max(0, Math.ceil(msOverdue / (1000 * 60 * 60 * 24)));
  });

  const avgDaysOverdue =
    daysOverdueList.length > 0
      ? Math.round(
          daysOverdueList.reduce((a, b) => a + b, 0) / daysOverdueList.length
        )
      : 0;

  const longestOverdue =
    daysOverdueList.length > 0 ? Math.max(...daysOverdueList) : 0;

  return [
    {
      id: "total_overdue",
      label: "Overdue Bookings",
      value: totalOverdue.toLocaleString(),
      rawValue: totalOverdue,
      format: "number",
      delta: null,
      deltaType: totalOverdue > 0 ? "negative" : "positive",
    },
    {
      id: "total_assets_at_risk",
      label: "Assets at Risk",
      value: totalAssetsAtRisk.toLocaleString(),
      rawValue: totalAssetsAtRisk,
      format: "number",
      delta: null,
      deltaType: totalAssetsAtRisk > 0 ? "negative" : "positive",
    },
    {
      id: "total_value_at_risk",
      label: "Value at Risk",
      value:
        totalValueAtRisk > 0 ? `$${totalValueAtRisk.toLocaleString()}` : "—",
      rawValue: totalValueAtRisk,
      format: "currency",
      delta: null,
      deltaType: totalValueAtRisk > 0 ? "negative" : "neutral",
    },
    {
      id: "avg_days_overdue",
      label: "Avg. Days Overdue",
      value: avgDaysOverdue > 0 ? `${avgDaysOverdue} days` : "—",
      rawValue: avgDaysOverdue,
      format: "number",
      delta: null,
      deltaType:
        avgDaysOverdue > 3
          ? "negative"
          : avgDaysOverdue > 0
          ? "neutral"
          : "positive",
    },
    {
      id: "longest_overdue",
      label: "Longest Overdue",
      value: longestOverdue > 0 ? `${longestOverdue} days` : "—",
      rawValue: longestOverdue,
      format: "number",
      delta: null,
      deltaType:
        longestOverdue > 7
          ? "negative"
          : longestOverdue > 0
          ? "neutral"
          : "positive",
    },
  ];
}

// -----------------------------------------------------------------------------
// R4: Idle Assets Report
// -----------------------------------------------------------------------------

interface IdleAssetsArgs {
  organizationId: string;
  /** Number of days without activity to consider "idle" (default: 30) */
  idleThresholdDays?: number;
  categoryId?: string;
  locationId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Idle Assets report (R4).
 *
 * Identifies assets that haven't been booked or checked out recently.
 * Helps with inventory optimization and identifying underutilized assets.
 *
 * @param args - Report parameters
 * @returns Complete report payload
 */
export async function idleAssetsReport(
  args: IdleAssetsArgs
): Promise<ReportPayload<IdleAssetRow>> {
  const {
    organizationId,
    idleThresholdDays = 30,
    categoryId,
    locationId,
    page = 1,
    pageSize = 50,
  } = args;

  const startTime = performance.now();

  try {
    // Calculate the cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - idleThresholdDays);

    // Build asset where clause
    const assetWhere: Prisma.AssetWhereInput = {
      organizationId,
    };

    if (categoryId) {
      assetWhere.categoryId = categoryId;
    }

    if (locationId) {
      assetWhere.locationId = locationId;
    }

    // Fetch data
    const [rows, totalCount, kpis] = await Promise.all([
      fetchIdleAssetRows(
        organizationId,
        assetWhere,
        cutoffDate,
        page,
        pageSize
      ),
      countIdleAssets(organizationId, assetWhere, cutoffDate),
      computeIdleAssetsKpis(organizationId, assetWhere, cutoffDate),
    ]);

    const computedMs = Math.round(performance.now() - startTime);

    // Create timeframe for display
    const now = new Date();
    const timeframe: ResolvedTimeframe = {
      preset: "last_30d",
      from: cutoffDate,
      to: now,
      label: `Idle for ${idleThresholdDays}+ days`,
    };

    return {
      report: {
        id: "idle-assets",
        title: "Idle Assets",
        description:
          "Find assets that haven't been booked or checked out recently.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows,
      computedMs,
      totalRows: totalCount,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Idle Assets report",
      additionalData: { organizationId, idleThresholdDays },
    });
  }
}

/**
 * Fetch idle asset rows with last booking date.
 *
 * An asset is considered idle if it hasn't been part of any booking
 * that was checked out since the cutoff date.
 */
async function fetchIdleAssetRows(
  organizationId: string,
  assetWhere: Prisma.AssetWhereInput,
  cutoffDate: Date,
  page: number,
  pageSize: number
): Promise<IdleAssetRow[]> {
  const now = new Date();

  // Get assets with their last booking checkout. Phase 3a: walk the
  // `BookingAsset` pivot for both the exclusion filter and the
  // most-recent-completed sub-query. `organizationId` is enforced
  // explicitly here for defense-in-depth alongside the caller's
  // `assetWhere`.
  const assets = await db.asset.findMany({
    where: {
      ...assetWhere,
      organizationId,
      NOT: {
        bookingAssets: {
          some: {
            booking: {
              status: { in: ["ONGOING", "OVERDUE"] },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "asc" }, // Least recently updated first
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      title: true,
      thumbnailImage: true,
      status: true,
      valuation: true,
      updatedAt: true,
      category: {
        select: {
          name: true,
        },
      },
      location: {
        select: {
          name: true,
        },
      },
      // Pull the most-recent COMPLETE booking via the pivot. We sort
      // pivot rows by their related booking's `to` desc and take the
      // first one to find the last completed booking for this asset.
      bookingAssets: {
        where: {
          booking: { status: "COMPLETE" },
        },
        orderBy: { booking: { to: "desc" } },
        take: 1,
        select: {
          booking: { select: { to: true } },
        },
      },
    },
  });

  // Filter to only include assets that are actually idle (no recent booking)
  const idleAssets = assets.filter((asset) => {
    const lastBookingEnd = asset.bookingAssets[0]?.booking.to;
    if (!lastBookingEnd) return true; // Never booked = idle
    return lastBookingEnd < cutoffDate;
  });

  return idleAssets.map((asset) => {
    const lastBookedAt = asset.bookingAssets[0]?.booking.to || null;
    const daysSinceLastUse = lastBookedAt
      ? Math.ceil(
          (now.getTime() - lastBookedAt.getTime()) / (1000 * 60 * 60 * 24)
        )
      : Math.ceil(
          (now.getTime() - asset.updatedAt.getTime()) / (1000 * 60 * 60 * 24)
        );

    return {
      id: asset.id,
      assetId: asset.id,
      assetName: asset.title,
      thumbnailImage: asset.thumbnailImage,
      category: asset.category?.name || null,
      location: asset.location?.name || null,
      lastBookedAt,
      daysSinceLastUse,
      status: asset.status,
      valuation: asset.valuation,
    };
  });
}

/**
 * Count total idle assets matching the criteria.
 */
async function countIdleAssets(
  organizationId: string,
  assetWhere: Prisma.AssetWhereInput,
  cutoffDate: Date
): Promise<number> {
  // Get all potentially idle assets — Phase 3a: walk the BookingAsset
  // pivot for both the exclusion filter and the most-recent-completed
  // sub-query. `organizationId` is enforced explicitly as a
  // defense-in-depth guard alongside the caller-supplied `assetWhere`.
  const assets = await db.asset.findMany({
    where: {
      ...assetWhere,
      organizationId,
      NOT: {
        bookingAssets: {
          some: {
            booking: {
              status: { in: ["ONGOING", "OVERDUE"] },
            },
          },
        },
      },
    },
    select: {
      id: true,
      bookingAssets: {
        where: {
          booking: { status: "COMPLETE" },
        },
        orderBy: { booking: { to: "desc" } },
        take: 1,
        select: {
          booking: { select: { to: true } },
        },
      },
    },
  });

  // Filter to only truly idle assets
  return assets.filter((asset) => {
    const lastBookingEnd = asset.bookingAssets[0]?.booking.to;
    if (!lastBookingEnd) return true;
    return lastBookingEnd < cutoffDate;
  }).length;
}

async function computeIdleAssetsKpis(
  organizationId: string,
  assetWhere: Prisma.AssetWhereInput,
  cutoffDate: Date
): Promise<ReportKpi[]> {
  const now = new Date();

  // Get total asset count for percentage
  const totalAssets = await db.asset.count({
    where: {
      organizationId,
    },
  });

  // Get idle assets with details — Phase 3a: walk the BookingAsset
  // pivot for both the exclusion filter and the most-recent-completed
  // sub-query. Org scoping is enforced explicitly here so the helper is
  // safe even if `assetWhere` ever loses its organizationId clause.
  const idleAssets = await db.asset.findMany({
    where: {
      ...assetWhere,
      organizationId,
      NOT: {
        bookingAssets: {
          some: {
            booking: {
              status: { in: ["ONGOING", "OVERDUE"] },
            },
          },
        },
      },
    },
    select: {
      id: true,
      valuation: true,
      updatedAt: true,
      bookingAssets: {
        where: {
          booking: { status: "COMPLETE" },
        },
        orderBy: { booking: { to: "desc" } },
        take: 1,
        select: {
          booking: { select: { to: true } },
        },
      },
    },
  });

  // Filter to truly idle and calculate metrics
  const trulyIdle = idleAssets.filter((asset) => {
    const lastBookingEnd = asset.bookingAssets[0]?.booking.to;
    if (!lastBookingEnd) return true;
    return lastBookingEnd < cutoffDate;
  });

  const totalIdle = trulyIdle.length;
  const idlePercentage =
    totalAssets > 0 ? Math.round((totalIdle / totalAssets) * 100) : 0;

  // Calculate total value of idle assets
  const totalIdleValue = trulyIdle.reduce(
    (sum, asset) => sum + (asset.valuation || 0),
    0
  );

  // Calculate average days idle
  const daysIdleList = trulyIdle.map((asset) => {
    const lastBookedAt = asset.bookingAssets[0]?.booking.to;
    if (!lastBookedAt) {
      return Math.ceil(
        (now.getTime() - asset.updatedAt.getTime()) / (1000 * 60 * 60 * 24)
      );
    }
    return Math.ceil(
      (now.getTime() - lastBookedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
  });

  const avgDaysIdle =
    daysIdleList.length > 0
      ? Math.round(
          daysIdleList.reduce((a, b) => a + b, 0) / daysIdleList.length
        )
      : 0;

  return [
    {
      id: "total_idle",
      label: "Idle Assets",
      value: totalIdle.toLocaleString(),
      rawValue: totalIdle,
      format: "number",
      delta: null,
      deltaType:
        totalIdle > 10 ? "negative" : totalIdle > 0 ? "neutral" : "positive",
    },
    {
      id: "idle_percentage",
      label: "% of Inventory",
      value: `${idlePercentage}%`,
      rawValue: idlePercentage,
      format: "percent",
      delta: null,
      deltaType:
        idlePercentage > 20
          ? "negative"
          : idlePercentage > 10
          ? "neutral"
          : "positive",
    },
    {
      id: "total_idle_value",
      label: "Idle Value",
      value: totalIdleValue > 0 ? `$${totalIdleValue.toLocaleString()}` : "—",
      rawValue: totalIdleValue,
      format: "currency",
      delta: null,
      deltaType:
        totalIdleValue > 10000
          ? "negative"
          : totalIdleValue > 0
          ? "neutral"
          : "positive",
    },
    {
      id: "avg_days_idle",
      label: "Avg. Days Idle",
      value: avgDaysIdle > 0 ? `${avgDaysIdle} days` : "—",
      rawValue: avgDaysIdle,
      format: "number",
      delta: null,
      deltaType:
        avgDaysIdle > 60
          ? "negative"
          : avgDaysIdle > 30
          ? "neutral"
          : "positive",
    },
  ];
}

// -----------------------------------------------------------------------------
// R5: Custody Snapshot Report
// -----------------------------------------------------------------------------

interface CustodySnapshotArgs {
  organizationId: string;
  teamMemberId?: string;
  locationId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Custody Snapshot report (R5).
 *
 * Live view of all assets currently in custody.
 * Answers: "Who has what right now?"
 *
 * @param args - Report parameters
 * @returns Complete report payload
 */
export async function custodySnapshotReport(
  args: CustodySnapshotArgs
): Promise<ReportPayload<CustodySnapshotRow>> {
  const { organizationId, teamMemberId, page = 1, pageSize = 50 } = args;

  const startTime = performance.now();

  try {
    // Build where clause for custody records
    const where: Prisma.CustodyWhereInput = {
      asset: {
        organizationId,
      },
    };

    if (teamMemberId) {
      where.teamMemberId = teamMemberId;
    }

    // Fetch data in parallel
    const [rows, totalCount, kpis] = await Promise.all([
      fetchCustodyRows(where, page, pageSize),
      db.custody.count({ where }),
      computeCustodyKpis(organizationId, where),
    ]);

    const computedMs = Math.round(performance.now() - startTime);

    // Create a "now" timeframe for display
    const now = new Date();
    const timeframe: ResolvedTimeframe = {
      preset: "today",
      from: now,
      to: now,
      label: "Current",
    };

    return {
      report: {
        id: "custody-snapshot",
        title: "Custody Snapshot",
        description:
          "Live view of all assets currently in custody and their assigned team members.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows,
      computedMs,
      totalRows: totalCount,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Custody Snapshot report",
      additionalData: { organizationId },
    });
  }
}

async function fetchCustodyRows(
  where: Prisma.CustodyWhereInput,
  page: number,
  pageSize: number
): Promise<CustodySnapshotRow[]> {
  const now = new Date();

  const custodyRecords = await db.custody.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      createdAt: true,
      custodian: {
        select: {
          id: true,
          name: true,
        },
      },
      asset: {
        select: {
          id: true,
          title: true,
          thumbnailImage: true,
          valuation: true,
          category: {
            select: { name: true },
          },
          location: {
            select: { name: true },
          },
        },
      },
    },
  });

  return custodyRecords.map((c) => {
    const assignedAt = c.createdAt;
    const daysInCustody = Math.ceil(
      (now.getTime() - assignedAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      id: c.id,
      assetId: c.asset.id,
      assetName: c.asset.title,
      thumbnailImage: c.asset.thumbnailImage,
      category: c.asset.category?.name || null,
      location: c.asset.location?.name || null,
      custodianId: c.custodian.id,
      custodianName: stripNameSuffix(c.custodian.name),
      assignedAt,
      daysInCustody,
      valuation: c.asset.valuation,
    };
  });
}

async function computeCustodyKpis(
  organizationId: string,
  baseWhere: Prisma.CustodyWhereInput
): Promise<ReportKpi[]> {
  const now = new Date();

  // Fetch custody data for KPIs. `Custody` has no direct organizationId
  // column, so we scope through the related asset as a defense-in-depth
  // guard alongside the caller-supplied `baseWhere`.
  const custodyRecords = await db.custody.findMany({
    where: { ...baseWhere, asset: { organizationId } },
    select: {
      createdAt: true,
      teamMemberId: true,
      asset: {
        select: {
          valuation: true,
        },
      },
    },
  });

  const totalInCustody = custodyRecords.length;

  // Count unique custodians
  const uniqueCustodians = new Set(custodyRecords.map((c) => c.teamMemberId))
    .size;

  // Calculate total value
  const totalValue = custodyRecords.reduce(
    (sum, c) => sum + (c.asset.valuation || 0),
    0
  );

  // Calculate average days in custody
  const daysInCustodyList = custodyRecords.map((c) =>
    Math.ceil((now.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  );
  const avgDaysInCustody =
    daysInCustodyList.length > 0
      ? Math.round(
          daysInCustodyList.reduce((a, b) => a + b, 0) /
            daysInCustodyList.length
        )
      : 0;

  return [
    {
      id: "total_in_custody",
      label: "Assets in Custody",
      value: totalInCustody.toLocaleString(),
      rawValue: totalInCustody,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_custodians",
      label: "Team Members",
      value: uniqueCustodians.toLocaleString(),
      rawValue: uniqueCustodians,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_custody_value",
      label: "Total Value",
      value: totalValue > 0 ? `$${totalValue.toLocaleString()}` : "—",
      rawValue: totalValue,
      format: "currency",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "avg_days_in_custody",
      label: "Avg. Days Held",
      value: avgDaysInCustody > 0 ? `${avgDaysInCustody} days` : "—",
      rawValue: avgDaysInCustody,
      format: "number",
      delta: null,
      deltaType: avgDaysInCustody > 30 ? "neutral" : "positive",
    },
  ];
}

// -----------------------------------------------------------------------------
// R3: Top Booked Assets Report
// -----------------------------------------------------------------------------

interface TopBookedAssetsArgs {
  organizationId: string;
  timeframe: ResolvedTimeframe;
  categoryId?: string;
  locationId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Top Booked Assets report (R3).
 *
 * Identifies most frequently booked assets.
 * Answers: "What assets are most in demand?"
 *
 * @param args - Report parameters
 * @returns Complete report payload
 */
export async function topBookedAssetsReport(
  args: TopBookedAssetsArgs
): Promise<ReportPayload<TopBookedAssetRow>> {
  const {
    organizationId,
    timeframe,
    categoryId,
    locationId,
    page = 1,
    pageSize = 50,
  } = args;

  const startTime = performance.now();

  try {
    // Build asset where clause
    const assetWhere: Prisma.AssetWhereInput = {
      organizationId,
    };

    if (categoryId) {
      assetWhere.categoryId = categoryId;
    }

    if (locationId) {
      assetWhere.locationId = locationId;
    }

    // Fetch data
    const [rowsResult, kpis] = await Promise.all([
      fetchTopBookedAssetRows(
        organizationId,
        assetWhere,
        timeframe,
        page,
        pageSize
      ),
      computeTopBookedKpis(organizationId, assetWhere, timeframe),
    ]);

    const computedMs = Math.round(performance.now() - startTime);

    return {
      report: {
        id: "top-booked-assets",
        title: "Top Booked Assets",
        description:
          "Identify your most frequently booked assets and their utilization patterns.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows: rowsResult.rows,
      computedMs,
      totalRows: rowsResult.totalCount,
      page,
      pageSize,
      topBookedAsset: rowsResult.topAsset,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Top Booked Assets report",
      additionalData: { organizationId, timeframe: timeframe.preset },
    });
  }
}

async function fetchTopBookedAssetRows(
  organizationId: string,
  assetWhere: Prisma.AssetWhereInput,
  timeframe: ResolvedTimeframe,
  page: number,
  pageSize: number
): Promise<{
  rows: TopBookedAssetRow[];
  totalCount: number;
  topAsset: TopBookedAssetRow | null;
}> {
  // Get all bookings in the timeframe with their assets — Phase 3a:
  // walk the BookingAsset pivot. The `where: assetWhere` on the pivot
  // is expressed as a nested `asset:` filter; the same shape applies to
  // the `select` so we can pick fields off the asset.
  const bookings = await db.booking.findMany({
    where: {
      organizationId,
      OR: [
        { from: { gte: timeframe.from, lte: timeframe.to } },
        { to: { gte: timeframe.from, lte: timeframe.to } },
      ],
      status: { notIn: ["DRAFT", "CANCELLED"] },
    },
    select: {
      from: true,
      to: true,
      bookingAssets: {
        where: { asset: assetWhere },
        select: {
          asset: {
            select: {
              id: true,
              title: true,
              thumbnailImage: true,
              category: { select: { name: true } },
              location: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // Aggregate by asset
  const assetMap = new Map<
    string,
    {
      asset: {
        id: string;
        title: string;
        thumbnailImage: string | null;
        category: string | null;
        location: string | null;
      };
      bookingCount: number;
      totalDays: number;
    }
  >();

  const periodDays = Math.ceil(
    (timeframe.to.getTime() - timeframe.from.getTime()) / (1000 * 60 * 60 * 24)
  );

  for (const booking of bookings) {
    const bookingDays =
      booking.from && booking.to
        ? Math.ceil(
            (booking.to.getTime() - booking.from.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : 1;

    for (const ba of booking.bookingAssets) {
      const asset = ba.asset;
      if (!assetMap.has(asset.id)) {
        assetMap.set(asset.id, {
          asset: {
            id: asset.id,
            title: asset.title,
            thumbnailImage: asset.thumbnailImage,
            category: asset.category?.name || null,
            location: asset.location?.name || null,
          },
          bookingCount: 0,
          totalDays: 0,
        });
      }

      const entry = assetMap.get(asset.id)!;
      entry.bookingCount++;
      entry.totalDays += bookingDays;
    }
  }

  // Convert to array and sort by booking count
  const results = Array.from(assetMap.values())
    .map((entry) => ({
      id: entry.asset.id,
      assetId: entry.asset.id,
      assetName: entry.asset.title,
      thumbnailImage: entry.asset.thumbnailImage,
      category: entry.asset.category,
      location: entry.asset.location,
      bookingCount: entry.bookingCount,
      totalDaysBooked: entry.totalDays,
      timeBookedRate:
        periodDays > 0
          ? Math.min(100, Math.round((entry.totalDays / periodDays) * 100))
          : 0,
    }))
    .sort((a, b) => b.bookingCount - a.bookingCount);

  // The #1 most booked asset (before pagination) - always the first sorted result
  const topAsset = results[0] || null;

  // Apply pagination
  const paginatedRows = results.slice((page - 1) * pageSize, page * pageSize);

  return {
    rows: paginatedRows,
    totalCount: results.length,
    topAsset,
  };
}

async function computeTopBookedKpis(
  organizationId: string,
  assetWhere: Prisma.AssetWhereInput,
  timeframe: ResolvedTimeframe
): Promise<ReportKpi[]> {
  // Get booking counts
  const bookings = await db.booking.findMany({
    where: {
      organizationId,
      OR: [
        { from: { gte: timeframe.from, lte: timeframe.to } },
        { to: { gte: timeframe.from, lte: timeframe.to } },
      ],
      status: { notIn: ["DRAFT", "CANCELLED"] },
    },
    select: {
      bookingAssets: {
        where: { asset: assetWhere },
        select: {
          asset: { select: { id: true, title: true } },
        },
      },
    },
  });

  const totalBookings = bookings.length;

  // Count unique assets booked — Phase 3a: walk the BookingAsset pivot.
  const uniqueAssets = new Set<string>();
  const assetBookingCounts = new Map<string, { name: string; count: number }>();

  for (const booking of bookings) {
    for (const ba of booking.bookingAssets) {
      const asset = ba.asset;
      uniqueAssets.add(asset.id);

      if (!assetBookingCounts.has(asset.id)) {
        assetBookingCounts.set(asset.id, { name: asset.title, count: 0 });
      }
      assetBookingCounts.get(asset.id)!.count++;
    }
  }

  const uniqueAssetsBooked = uniqueAssets.size;
  const avgBookingsPerAsset =
    uniqueAssetsBooked > 0
      ? Math.round((totalBookings / uniqueAssetsBooked) * 10) / 10
      : 0;

  // Find most booked asset
  let mostBookedAsset = "—";
  let mostBookedCount = 0;
  for (const [, data] of assetBookingCounts) {
    if (data.count > mostBookedCount) {
      mostBookedCount = data.count;
      mostBookedAsset = data.name;
    }
  }

  return [
    {
      id: "total_bookings",
      label: "Total Bookings",
      value: totalBookings.toLocaleString(),
      rawValue: totalBookings,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "unique_assets_booked",
      label: "Assets Booked",
      value: uniqueAssetsBooked.toLocaleString(),
      rawValue: uniqueAssetsBooked,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "avg_bookings_per_asset",
      label: "Avg. per Asset",
      value: avgBookingsPerAsset > 0 ? `${avgBookingsPerAsset}x` : "—",
      rawValue: avgBookingsPerAsset,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "most_booked_asset",
      label: "Most Popular",
      value:
        mostBookedAsset.length > 20
          ? `${mostBookedAsset.slice(0, 20)}...`
          : mostBookedAsset,
      rawValue: mostBookedCount,
      format: "number",
      delta: mostBookedCount > 0 ? `${mostBookedCount}x` : null,
      deltaType: "positive",
    },
  ];
}

// -----------------------------------------------------------------------------
// R10: Asset Distribution Report
// -----------------------------------------------------------------------------

interface AssetDistributionArgs {
  organizationId: string;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Asset Distribution report (R10).
 *
 * Breakdown of assets by category, location, and status.
 * Answers: "How is my inventory distributed?"
 *
 * @param args - Report parameters
 * @returns Complete report payload with distribution breakdowns
 */
export async function assetDistributionReport(
  args: AssetDistributionArgs
): Promise<
  ReportPayload<AssetDistributionRow> & {
    distributionBreakdown: DistributionBreakdown;
  }
> {
  const { organizationId, page = 1, pageSize = 50 } = args;

  const startTime = performance.now();

  try {
    // Fetch all distribution data in parallel.
    const [byCategory, byLocation, byStatus, kpis] = await Promise.all([
      computeDistributionByCategory(organizationId),
      computeDistributionByLocation(organizationId),
      computeDistributionByStatus(organizationId),
      computeDistributionKpis(organizationId),
    ]);

    const computedMs = Math.round(performance.now() - startTime);

    // Create a "now" timeframe for display
    const now = new Date();
    const timeframe: ResolvedTimeframe = {
      preset: "today",
      from: now,
      to: now,
      label: "Current",
    };

    // Use category breakdown as the main rows (most useful for table view)
    // Note: byCategory is already sorted by assetCount descending
    const rows = byCategory.slice((page - 1) * pageSize, page * pageSize);

    return {
      report: {
        id: "distribution",
        title: "Asset Distribution",
        description:
          "Breakdown of assets by category, location, and status for inventory planning.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows,
      distributionBreakdown: {
        byCategory,
        byLocation,
        byStatus,
      },
      computedMs,
      totalRows: byCategory.length, // Count of category rows, not total assets
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Asset Distribution report",
      additionalData: { organizationId },
    });
  }
}

async function computeDistributionByCategory(
  organizationId: string
): Promise<AssetDistributionRow[]> {
  const assets = await db.asset.groupBy({
    by: ["categoryId"],
    where: { organizationId },
    _count: { id: true },
    _sum: { valuation: true },
  });

  const totalAssets = assets.reduce((sum, a) => sum + a._count.id, 0);

  // Fetch category names
  const categoryIds = assets
    .map((a) => a.categoryId)
    .filter((id): id is string => id !== null);

  const categories = await db.category.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, name: true },
  });

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  return assets
    .map((a) => ({
      id: a.categoryId || "uncategorized",
      groupName: a.categoryId
        ? categoryMap.get(a.categoryId) || "Unknown"
        : "Uncategorized",
      assetCount: a._count.id,
      percentage:
        totalAssets > 0 ? Math.round((a._count.id / totalAssets) * 100) : 0,
      totalValue: a._sum.valuation,
    }))
    .sort((a, b) => b.assetCount - a.assetCount);
}

async function computeDistributionByLocation(
  organizationId: string
): Promise<AssetDistributionRow[]> {
  const assets = await db.asset.groupBy({
    by: ["locationId"],
    where: { organizationId },
    _count: { id: true },
    _sum: { valuation: true },
  });

  const totalAssets = assets.reduce((sum, a) => sum + a._count.id, 0);

  // Fetch location names
  const locationIds = assets
    .map((a) => a.locationId)
    .filter((id): id is string => id !== null);

  const locations = await db.location.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, name: true },
  });

  const locationMap = new Map(locations.map((l) => [l.id, l.name]));

  return assets
    .map((a) => ({
      id: a.locationId || "without-location",
      groupName: a.locationId
        ? locationMap.get(a.locationId) || "Unknown"
        : "No Location",
      assetCount: a._count.id,
      percentage:
        totalAssets > 0 ? Math.round((a._count.id / totalAssets) * 100) : 0,
      totalValue: a._sum.valuation,
    }))
    .sort((a, b) => b.assetCount - a.assetCount);
}

async function computeDistributionByStatus(
  organizationId: string
): Promise<AssetDistributionRow[]> {
  const assets = await db.asset.groupBy({
    by: ["status"],
    where: { organizationId },
    _count: { id: true },
    _sum: { valuation: true },
  });

  const totalAssets = assets.reduce((sum, a) => sum + a._count.id, 0);

  const statusLabels: Record<string, string> = {
    AVAILABLE: "Available",
    IN_CUSTODY: "In Custody",
    CHECKED_OUT: "Checked Out",
  };

  return assets
    .map((a) => ({
      id: a.status,
      groupName: statusLabels[a.status] || a.status,
      assetCount: a._count.id,
      percentage:
        totalAssets > 0 ? Math.round((a._count.id / totalAssets) * 100) : 0,
      totalValue: a._sum.valuation,
    }))
    .sort((a, b) => b.assetCount - a.assetCount);
}

async function computeDistributionKpis(
  organizationId: string
): Promise<ReportKpi[]> {
  const [totalAssets, totalValue, categoryCount, locationCount] =
    await Promise.all([
      db.asset.count({ where: { organizationId } }),
      db.asset.aggregate({
        where: { organizationId },
        _sum: { valuation: true },
      }),
      db.category.count({ where: { organizationId } }),
      db.location.count({ where: { organizationId } }),
    ]);

  const totalAssetValue = totalValue._sum.valuation || 0;

  return [
    {
      id: "total_assets",
      label: "Total Assets",
      value: totalAssets.toLocaleString(),
      rawValue: totalAssets,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_value",
      label: "Total Value",
      value: totalAssetValue > 0 ? `$${totalAssetValue.toLocaleString()}` : "—",
      rawValue: totalAssetValue,
      format: "currency",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_categories",
      label: "Categories",
      value: categoryCount.toLocaleString(),
      rawValue: categoryCount,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_locations",
      label: "Locations",
      value: locationCount.toLocaleString(),
      rawValue: locationCount,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
  ];
}

// =============================================================================
// R1: Asset Inventory Report
// =============================================================================

interface AssetInventoryArgs {
  organizationId: string;
  categoryIds?: string[];
  locationIds?: string[];
  statuses?: string[];
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Asset Inventory report (R1).
 *
 * Complete snapshot of all assets with filtering and export capabilities.
 *
 * @param args - Report parameters
 * @returns Complete report payload
 */
export async function assetInventoryReport(
  args: AssetInventoryArgs
): Promise<ReportPayload<AssetInventoryRow>> {
  const {
    organizationId,
    categoryIds,
    locationIds,
    statuses,
    page = 1,
    pageSize = 50,
  } = args;

  const startTime = performance.now();

  try {
    // Build where clause
    const where: Prisma.AssetWhereInput = { organizationId };

    if (categoryIds && categoryIds.length > 0) {
      where.categoryId = { in: categoryIds };
    }
    if (locationIds && locationIds.length > 0) {
      where.locationId = { in: locationIds };
    }
    if (statuses && statuses.length > 0) {
      where.status = { in: statuses as AssetStatus[] };
    }

    // Fetch data in parallel
    const [rows, totalCount, kpis] = await Promise.all([
      fetchInventoryRows(where, page, pageSize),
      db.asset.count({ where }),
      computeInventoryKpis(organizationId, where),
    ]);

    const computedMs = Math.round(performance.now() - startTime);

    // Create a "now" timeframe for display
    const now = new Date();
    const timeframe: ResolvedTimeframe = {
      preset: "today",
      from: now,
      to: now,
      label: "Current Inventory",
    };

    return {
      report: {
        id: "asset-inventory",
        title: "Asset Inventory",
        description: "Complete snapshot of your asset inventory.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows,
      computedMs,
      totalRows: totalCount,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Asset Inventory report",
      additionalData: { organizationId },
    });
  }
}

async function fetchInventoryRows(
  where: Prisma.AssetWhereInput,
  page: number,
  pageSize: number
): Promise<AssetInventoryRow[]> {
  const assets = await db.asset.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      title: true,
      thumbnailImage: true,
      status: true,
      valuation: true,
      createdAt: true,
      category: { select: { name: true } },
      location: { select: { name: true } },
      custody: {
        select: {
          custodian: { select: { name: true } },
        },
      },
      qrCodes: {
        take: 1,
        select: { id: true },
      },
    },
  });

  return assets.map((a) => ({
    id: a.id,
    assetId: a.id,
    assetName: a.title,
    thumbnailImage: a.thumbnailImage,
    category: a.category?.name || null,
    location: a.location?.name || null,
    status: a.status,
    // Phase 2 turned `Asset.custody` into a `Custody[]` array, so we
    // pick the first row (assets with no custody resolve to `null`
    // through the optional chain).
    custodian: a.custody[0]?.custodian?.name
      ? stripNameSuffix(a.custody[0].custodian.name)
      : null,
    valuation: a.valuation,
    createdAt: a.createdAt,
    qrId: a.qrCodes[0]?.id || null,
  }));
}

async function computeInventoryKpis(
  organizationId: string,
  where: Prisma.AssetWhereInput
): Promise<ReportKpi[]> {
  // Defense-in-depth: enforce organizationId on every query even though
  // callers' `where` already includes it. Cheap to add, prevents an
  // accidental cross-org leak if the where-builder ever regresses.
  const scopedWhere: Prisma.AssetWhereInput = { ...where, organizationId };
  const [totalAssets, totalValue, statusCounts] = await Promise.all([
    db.asset.count({ where: scopedWhere }),
    db.asset.aggregate({
      where: scopedWhere,
      _sum: { valuation: true },
    }),
    db.asset.groupBy({
      by: ["status"],
      where: scopedWhere,
      _count: { id: true },
    }),
  ]);

  const availableCount =
    statusCounts.find((s) => s.status === "AVAILABLE")?._count.id || 0;
  const inCustodyCount =
    statusCounts.find((s) => s.status === "IN_CUSTODY")?._count.id || 0;
  const totalAssetValue = totalValue._sum.valuation || 0;

  return [
    {
      id: "total_assets",
      label: "Total Assets",
      value: totalAssets.toLocaleString(),
      rawValue: totalAssets,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "total_value",
      label: "Total Value",
      value: totalAssetValue > 0 ? `$${totalAssetValue.toLocaleString()}` : "—",
      rawValue: totalAssetValue,
      format: "currency",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "available_count",
      label: "Available",
      value: availableCount.toLocaleString(),
      rawValue: availableCount,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
    {
      id: "in_custody_count",
      label: "In Custody",
      value: inCustodyCount.toLocaleString(),
      rawValue: inCustodyCount,
      format: "number",
      delta: null,
      deltaType: "neutral",
    },
  ];
}

// =============================================================================
// R9: Monthly Booking Trends Report
// =============================================================================

interface MonthlyBookingTrendsArgs {
  organizationId: string;
  timeframe: ResolvedTimeframe;
  categoryId?: string;
  locationId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Monthly Booking Trends report (R9).
 *
 * Time-series visualization of booking volume with month-over-month comparisons.
 *
 * @param args - Report parameters
 * @returns Complete report payload with chart data
 */
export async function monthlyBookingTrendsReport(
  args: MonthlyBookingTrendsArgs
): Promise<ReportPayload<MonthlyBookingTrendRow>> {
  const { organizationId, timeframe, page = 1, pageSize = 12 } = args;

  const startTime = performance.now();

  try {
    // Fetch all bookings in the timeframe
    const bookings = await db.booking.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: timeframe.from,
          lte: timeframe.to,
        },
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
      },
    });

    // Group by month
    const monthlyData = new Map<
      string,
      {
        monthStart: Date;
        created: number;
        completed: number;
        assetIds: Set<string>;
      }
    >();

    for (const booking of bookings) {
      const monthKey = `${booking.createdAt.getFullYear()}-${String(
        booking.createdAt.getMonth() + 1
      ).padStart(2, "0")}`;
      const monthStart = new Date(
        booking.createdAt.getFullYear(),
        booking.createdAt.getMonth(),
        1
      );

      if (!monthlyData.has(monthKey)) {
        monthlyData.set(monthKey, {
          monthStart,
          created: 0,
          completed: 0,
          assetIds: new Set(),
        });
      }

      const data = monthlyData.get(monthKey)!;
      data.created++;
      if (booking.status === "COMPLETE") {
        data.completed++;
      }
    }

    // Convert to rows with MoM calculation
    const sortedMonths = Array.from(monthlyData.entries()).sort(
      (a, b) => a[1].monthStart.getTime() - b[1].monthStart.getTime()
    );

    const rows: MonthlyBookingTrendRow[] = sortedMonths.map(
      ([key, data], index) => {
        const prevMonth = index > 0 ? sortedMonths[index - 1][1] : null;
        const momChange =
          prevMonth && prevMonth.created > 0
            ? Math.round(
                ((data.created - prevMonth.created) / prevMonth.created) * 100
              )
            : null;

        return {
          id: key,
          month: data.monthStart.toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          }),
          monthStart: data.monthStart,
          bookingsCreated: data.created,
          bookingsCompleted: data.completed,
          uniqueAssetsBooked: data.assetIds.size,
          momChange,
        };
      }
    );

    // Calculate KPIs
    const totalBookings = bookings.length;
    const avgMonthly =
      rows.length > 0 ? Math.round(totalBookings / rows.length) : 0;
    const peakMonth = rows.reduce(
      (max, r) => (r.bookingsCreated > max.bookingsCreated ? r : max),
      rows[0]
    );

    // Trend calculation: compare last two months
    const lastTwoMonths = rows.slice(-2);
    let trendDirection: "up" | "down" | "stable" = "stable";
    let trendChange = 0;
    let trendPrevMonth = "";
    let trendCurrMonth = "";
    let trendPrevValue = 0;
    let trendCurrValue = 0;

    if (lastTwoMonths.length === 2) {
      trendPrevMonth = lastTwoMonths[0].month;
      trendCurrMonth = lastTwoMonths[1].month;
      trendPrevValue = lastTwoMonths[0].bookingsCreated;
      trendCurrValue = lastTwoMonths[1].bookingsCreated;
      trendChange = trendCurrValue - trendPrevValue;
      trendDirection =
        trendChange > 0 ? "up" : trendChange < 0 ? "down" : "stable";
    }

    const kpis: ReportKpi[] = [
      {
        id: "total_bookings",
        label: "Total Bookings",
        value: totalBookings.toLocaleString(),
        rawValue: totalBookings,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
      {
        id: "avg_monthly_bookings",
        label: "Avg. Monthly",
        value: avgMonthly.toLocaleString(),
        rawValue: avgMonthly,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
      {
        id: "peak_month",
        label: "Peak Month",
        value: peakMonth?.month || "—",
        rawValue: peakMonth?.bookingsCreated || 0,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
      {
        id: "trend_direction",
        label: "Trend",
        value:
          trendDirection === "up"
            ? "Increasing"
            : trendDirection === "down"
            ? "Decreasing"
            : "Stable",
        rawValue:
          trendDirection === "up" ? 1 : trendDirection === "down" ? -1 : 0,
        format: "number",
        // Include the actual change as delta for context
        delta: trendChange !== 0 ? String(trendChange) : null,
        deltaType:
          trendDirection === "up"
            ? "positive"
            : trendDirection === "down"
            ? "negative"
            : "neutral",
        // Add metadata for tooltip (stored in description field)
        description:
          lastTwoMonths.length === 2
            ? `${trendCurrMonth}: ${trendCurrValue} vs ${trendPrevMonth}: ${trendPrevValue}`
            : undefined,
      },
    ];

    // Build chart series
    // Order: Completed first (green), Created second (blue) - matches legend display order
    const chartSeries: ChartSeries[] = [
      {
        id: "bookings_completed",
        name: "Bookings Completed",
        data: rows.map((r) => ({
          date: r.month,
          value: r.bookingsCompleted,
          label: r.month,
        })),
        color: "#22c55e",
      },
      {
        id: "bookings_created",
        name: "Bookings Created",
        data: rows.map((r) => ({
          date: r.month,
          value: r.bookingsCreated,
          label: r.month,
        })),
        color: "#3b82f6",
      },
    ];

    const computedMs = Math.round(performance.now() - startTime);

    return {
      report: {
        id: "monthly-booking-trends",
        title: "Monthly Booking Trends",
        description:
          "Booking volume trends over time with month-over-month comparisons.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      chartSeries,
      computedMs,
      totalRows: rows.length,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Monthly Booking Trends report",
      additionalData: { organizationId },
    });
  }
}

// =============================================================================
// R8: Asset Utilization Report
// =============================================================================

interface AssetUtilizationArgs {
  organizationId: string;
  timeframe: ResolvedTimeframe;
  categoryId?: string;
  locationId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Asset Utilization report (R8).
 *
 * Measures how effectively assets are being used based on booking time.
 *
 * @param args - Report parameters
 * @returns Complete report payload
 */
export async function assetUtilizationReport(
  args: AssetUtilizationArgs
): Promise<ReportPayload<AssetUtilizationRow>> {
  const {
    organizationId,
    timeframe,
    categoryId,
    locationId,
    page = 1,
    pageSize = 50,
  } = args;

  const startTime = performance.now();

  try {
    // Build asset where clause
    const assetWhere: Prisma.AssetWhereInput = { organizationId };
    if (categoryId) assetWhere.categoryId = categoryId;
    if (locationId) assetWhere.locationId = locationId;

    // Calculate total days in period
    const totalDays = Math.ceil(
      (timeframe.to.getTime() - timeframe.from.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    // Fetch assets with their bookings in the timeframe — Phase 3a:
    // walk the BookingAsset pivot. Filter pivot rows by their related
    // booking's date window so utilization only counts in-window
    // bookings.
    const assets = await db.asset.findMany({
      where: assetWhere,
      select: {
        id: true,
        title: true,
        thumbnailImage: true,
        valuation: true,
        category: { select: { name: true } },
        location: { select: { name: true } },
        bookingAssets: {
          where: {
            booking: {
              from: { lte: timeframe.to },
              to: { gte: timeframe.from },
            },
          },
          select: {
            booking: {
              select: {
                id: true,
                from: true,
                to: true,
              },
            },
          },
        },
      },
    });

    // Calculate utilization for each asset
    const rows: AssetUtilizationRow[] = assets.map((asset) => {
      let daysInUse = 0;
      const bookingIds = new Set<string>();

      for (const ba of asset.bookingAssets) {
        const booking = ba.booking;
        if (!booking.from || !booking.to) continue;
        bookingIds.add(booking.id);

        // Calculate overlap with timeframe
        const overlapStart = Math.max(
          booking.from.getTime(),
          timeframe.from.getTime()
        );
        const overlapEnd = Math.min(
          booking.to.getTime(),
          timeframe.to.getTime()
        );

        if (overlapEnd > overlapStart) {
          daysInUse += Math.ceil(
            (overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)
          );
        }
      }

      const utilizationRate =
        totalDays > 0 ? Math.round((daysInUse / totalDays) * 100) : 0;

      return {
        id: asset.id,
        assetId: asset.id,
        assetName: asset.title,
        thumbnailImage: asset.thumbnailImage,
        category: asset.category?.name || null,
        location: asset.location?.name || null,
        totalDays,
        daysInUse,
        utilizationRate,
        bookingCount: bookingIds.size,
        valuation: asset.valuation,
      };
    });

    // Sort by utilization rate descending
    rows.sort((a, b) => b.utilizationRate - a.utilizationRate);

    // Calculate KPIs
    const avgUtilization =
      rows.length > 0
        ? Math.round(
            rows.reduce((sum, r) => sum + r.utilizationRate, 0) / rows.length
          )
        : 0;
    const highlyUtilized = rows.filter((r) => r.utilizationRate >= 70).length;
    const underutilized = rows.filter((r) => r.utilizationRate < 30).length;
    const totalBookingDays = rows.reduce((sum, r) => sum + r.daysInUse, 0);

    const kpis: ReportKpi[] = [
      {
        id: "avg_utilization",
        label: "Avg. Utilization",
        value: `${avgUtilization}%`,
        rawValue: avgUtilization,
        format: "percent",
        delta: null,
        deltaType:
          avgUtilization >= 50
            ? "positive"
            : avgUtilization >= 30
            ? "neutral"
            : "negative",
      },
      {
        id: "highly_utilized_count",
        label: "Highly Utilized (>70%)",
        value: highlyUtilized.toLocaleString(),
        rawValue: highlyUtilized,
        format: "number",
        delta: null,
        deltaType: "positive",
      },
      {
        id: "underutilized_count",
        label: "Underutilized (<30%)",
        value: underutilized.toLocaleString(),
        rawValue: underutilized,
        format: "number",
        delta: null,
        deltaType: underutilized > 0 ? "negative" : "neutral",
      },
      {
        id: "total_booking_days",
        label: "Total Booking Days",
        value: totalBookingDays.toLocaleString(),
        rawValue: totalBookingDays,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
    ];

    const computedMs = Math.round(performance.now() - startTime);

    return {
      report: {
        id: "asset-utilization",
        title: "Asset Utilization",
        description:
          "Measure how effectively assets are being used based on booking time.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      computedMs,
      totalRows: rows.length,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Asset Utilization report",
      additionalData: { organizationId },
    });
  }
}

// =============================================================================
// R7: Asset Activity Summary Report
// =============================================================================

interface AssetActivityArgs {
  organizationId: string;
  timeframe: ResolvedTimeframe;
  assetId?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Generate the Asset Activity Summary report (R7).
 *
 * Comprehensive activity history for assets including notes and custody changes.
 *
 * @param args - Report parameters
 * @returns Complete report payload
 */
export async function assetActivityReport(
  args: AssetActivityArgs
): Promise<ReportPayload<AssetActivityRow>> {
  const {
    organizationId,
    timeframe,
    assetId,
    categoryId,
    page = 1,
    pageSize = 50,
  } = args;

  const startTime = performance.now();

  try {
    // Asset-related actions we care about
    const assetActions: ActivityAction[] = [
      "ASSET_CREATED",
      "ASSET_NAME_CHANGED",
      "ASSET_DESCRIPTION_CHANGED",
      "ASSET_CATEGORY_CHANGED",
      "ASSET_LOCATION_CHANGED",
      "ASSET_STATUS_CHANGED",
      "ASSET_VALUATION_CHANGED",
      "ASSET_TAGS_CHANGED",
      "ASSET_CUSTOM_FIELD_CHANGED",
      "CUSTODY_ASSIGNED",
      "CUSTODY_RELEASED",
      "BOOKING_CHECKED_OUT",
      "BOOKING_CHECKED_IN",
    ];

    // Build where clause for ActivityEvent
    const where: Prisma.ActivityEventWhereInput = {
      organizationId,
      occurredAt: { gte: timeframe.from, lte: timeframe.to },
      action: { in: assetActions },
      assetId: assetId ? assetId : { not: null },
    };

    // If filtering by category, get asset IDs first
    let assetIdsInCategory: string[] | undefined;
    if (categoryId) {
      const assetsInCategory = await db.asset.findMany({
        where: { organizationId, categoryId },
        select: { id: true },
      });
      assetIdsInCategory = assetsInCategory.map((a) => a.id);
      where.assetId = { in: assetIdsInCategory };
    }

    // Fetch activity events
    const [events, totalCount] = await Promise.all([
      db.activityEvent.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.activityEvent.count({ where }),
    ]);

    // Get asset details for the events
    const assetIds = [
      ...new Set(events.map((e) => e.assetId).filter(Boolean)),
    ] as string[];
    const assets = await db.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, title: true, thumbnailImage: true },
    });
    const assetMap = new Map(assets.map((a) => [a.id, a]));

    // Map events to rows
    const rows: AssetActivityRow[] = events.map((event) => {
      const asset = event.assetId ? assetMap.get(event.assetId) : null;
      const actorSnapshot = event.actorSnapshot as {
        firstName?: string;
        lastName?: string;
        displayName?: string;
      } | null;

      return {
        id: event.id,
        assetId: event.assetId || "",
        assetName: asset?.title || "Unknown Asset",
        thumbnailImage: asset?.thumbnailImage || null,
        activityType: mapActionToActivityType(event.action),
        description: buildActivityDescription(event),
        occurredAt: event.occurredAt,
        performedBy: actorSnapshot
          ? stripNameSuffix(
              actorSnapshot.displayName ||
                `${actorSnapshot.firstName || ""} ${
                  actorSnapshot.lastName || ""
                }`.trim()
            )
          : null,
        context: null,
      };
    });

    // Calculate KPIs from ALL events (not just current page)
    const allEventsForKpis = await db.activityEvent.groupBy({
      by: ["action"],
      where,
      _count: { id: true },
    });

    const actionCounts = new Map(
      allEventsForKpis.map((g) => [g.action, g._count.id])
    );

    const custodyChanges =
      (actionCounts.get("CUSTODY_ASSIGNED") || 0) +
      (actionCounts.get("CUSTODY_RELEASED") || 0);
    const bookingActivities =
      (actionCounts.get("BOOKING_CHECKED_OUT") || 0) +
      (actionCounts.get("BOOKING_CHECKED_IN") || 0);

    // Find most active asset
    const assetActivityCounts = await db.activityEvent.groupBy({
      by: ["assetId"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 1,
    });

    let mostActiveName = "—";
    if (assetActivityCounts.length > 0 && assetActivityCounts[0].assetId) {
      const mostActiveAsset = await db.asset.findUnique({
        where: { id: assetActivityCounts[0].assetId },
        select: { title: true },
      });
      mostActiveName = mostActiveAsset?.title || "—";
    }

    const kpis: ReportKpi[] = [
      {
        id: "total_activities",
        label: "Total Activities",
        value: totalCount.toLocaleString(),
        rawValue: totalCount,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
      {
        id: "custody_changes",
        label: "Custody Changes",
        value: custodyChanges.toLocaleString(),
        rawValue: custodyChanges,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
      {
        id: "booking_activities",
        label: "Booking Activities",
        value: bookingActivities.toLocaleString(),
        rawValue: bookingActivities,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
      {
        id: "most_active_asset",
        label: "Most Active",
        value: mostActiveName,
        rawValue: assetActivityCounts[0]?._count?.id || 0,
        format: "number",
        delta: null,
        deltaType: "neutral",
      },
    ];

    const computedMs = Math.round(performance.now() - startTime);

    return {
      report: {
        id: "asset-activity",
        title: "Asset Activity Summary",
        description: "Comprehensive activity history for assets.",
      },
      filters: {
        timeframe,
        filters: [],
      },
      kpis,
      rows,
      computedMs,
      totalRows: totalCount,
      page,
      pageSize,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Report",
      message: "Failed to generate Asset Activity Summary report",
      additionalData: { organizationId },
    });
  }
}

/** Map ActivityAction enum to the report's activity type */
function mapActionToActivityType(action: ActivityAction): AssetActivityType {
  switch (action) {
    case "ASSET_CREATED":
      return "CREATED";
    case "ASSET_CATEGORY_CHANGED":
      return "CATEGORY_CHANGED";
    case "ASSET_LOCATION_CHANGED":
      return "LOCATION_CHANGED";
    case "CUSTODY_ASSIGNED":
      return "CUSTODY_ASSIGNED";
    case "CUSTODY_RELEASED":
      return "CUSTODY_RELEASED";
    case "BOOKING_CHECKED_OUT":
      return "BOOKING_CHECKED_OUT";
    case "BOOKING_CHECKED_IN":
      return "BOOKING_CHECKED_IN";
    default:
      return "UPDATED";
  }
}

/** Build human-readable description from activity event */
function buildActivityDescription(event: {
  action: ActivityAction;
  field?: string | null;
  fromValue?: unknown;
  toValue?: unknown;
}): string {
  const actionLabels: Record<string, string> = {
    ASSET_CREATED: "Asset created",
    ASSET_NAME_CHANGED: "Name changed",
    ASSET_DESCRIPTION_CHANGED: "Description updated",
    ASSET_CATEGORY_CHANGED: "Category changed",
    ASSET_LOCATION_CHANGED: "Location changed",
    ASSET_STATUS_CHANGED: "Status changed",
    ASSET_VALUATION_CHANGED: "Valuation changed",
    ASSET_TAGS_CHANGED: "Tags updated",
    ASSET_CUSTOM_FIELD_CHANGED: "Custom field updated",
    CUSTODY_ASSIGNED: "Custody assigned",
    CUSTODY_RELEASED: "Custody released",
    BOOKING_CHECKED_OUT: "Checked out",
    BOOKING_CHECKED_IN: "Checked in",
  };

  const label =
    actionLabels[event.action] || event.action.replace(/_/g, " ").toLowerCase();

  // Add from/to values for change events
  if (
    event.field &&
    event.fromValue !== undefined &&
    event.toValue !== undefined
  ) {
    const from = formatFieldValue(event.fromValue);
    const to = formatFieldValue(event.toValue);
    if (from && to) {
      return `${label}: ${from} → ${to}`;
    }
  }

  return label;
}

/** Format a field value for display */
function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value);
}
