/**
 * Reports Module — Type Definitions
 *
 * Defines the data contracts for the reports system. These types are used by:
 * - Report loaders (server-side data fetching)
 * - Report components (client-side rendering)
 * - Report registry (configuration)
 *
 * @see {@link file://./registry.ts}
 * @see {@link file://./helpers.server.ts}
 */

import type { BookingStatus, Currency } from "@prisma/client";

// -----------------------------------------------------------------------------
// KPI Types
// -----------------------------------------------------------------------------

/** Format hints for KPI value display */
export type KpiFormat = "number" | "currency" | "percent" | "duration";

/**
 * A single KPI card's data. Pre-aggregated by the loader — components never
 * compute these from row arrays.
 */
export interface ReportKpi {
  /** Unique identifier for the KPI within this report */
  id: string;
  /** Human-readable label (e.g., "Completed on time") */
  label: string;
  /** The main value (already formatted as string for display flexibility) */
  value: string;
  /** Raw numeric value for sorting/comparison (optional) */
  rawValue?: number;
  /** Format hint for the value */
  format: KpiFormat;
  /** Period-over-period delta (e.g., "+12%", "-5") — null if not applicable */
  delta?: string | null;
  /** Whether delta is positive, negative, or neutral */
  deltaType?: "positive" | "negative" | "neutral";
  /** Label for the comparison period (e.g., "vs prior 30d") */
  deltaPeriodLabel?: string;
  /** Optional link destination when KPI is clicked */
  href?: string;
  /** Optional description for tooltips or additional context */
  description?: string;
}

// -----------------------------------------------------------------------------
// Timeframe Types
// -----------------------------------------------------------------------------

/** Preset timeframe options */
export type TimeframePreset =
  | "today"
  | "last_7d"
  | "last_30d"
  | "last_90d"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year"
  | "all_time"
  | "custom";

/**
 * Resolved timeframe with actual dates. Used by loaders to query data.
 */
export interface ResolvedTimeframe {
  preset: TimeframePreset;
  from: Date;
  to: Date;
  /** Human-readable label (e.g., "Last 30 days", "Jan 1 - Jan 31") */
  label: string;
}

// -----------------------------------------------------------------------------
// Filter Types
// -----------------------------------------------------------------------------

/** Filter types supported by reports */
export type FilterType =
  | "status"
  | "location"
  | "category"
  | "team_member"
  | "asset"
  | "booking";

/** A single filter value */
export interface ReportFilter {
  type: FilterType;
  value: string;
  label: string;
}

/** Active filters for a report */
export interface ReportFilters {
  timeframe: ResolvedTimeframe;
  filters: ReportFilter[];
}

// -----------------------------------------------------------------------------
// Chart Types
// -----------------------------------------------------------------------------

/** A single data point for time-series charts */
export interface ChartDataPoint {
  /** ISO date string or formatted label */
  date: string;
  /** The primary metric value */
  value: number;
  /** Optional secondary metric value (for comparison) */
  compareValue?: number;
  /** Optional label for the data point */
  label?: string;
}

/** Series configuration for charts */
export interface ChartSeries {
  id: string;
  name: string;
  data: ChartDataPoint[];
  color?: string;
}

// -----------------------------------------------------------------------------
// Report Payload Types
// -----------------------------------------------------------------------------

/**
 * Standard loader response shape for all reports. Every report loader returns
 * this structure; specific reports extend `rows` with their own row type.
 */
export interface ReportPayload<TRow = Record<string, unknown>> {
  /** Report metadata */
  report: {
    id: string;
    title: string;
    description: string;
  };
  /** Applied filters (echoed back for URL state sync) */
  filters: ReportFilters;
  /** Pre-aggregated KPIs — never compute these client-side */
  kpis: ReportKpi[];
  /** Table rows */
  rows: TRow[];
  /** Optional chart data */
  chartSeries?: ChartSeries[];
  /** Query execution time in milliseconds (for debugging) */
  computedMs: number;
  /** Total row count before pagination (for "showing X of Y") */
  totalRows: number;
  /** Current page (1-indexed) */
  page: number;
  /** Rows per page */
  pageSize: number;

  // Compliance report specific fields (optional - only present for compliance reports)
  /** Compliance rate data with prior period comparison */
  complianceData?: ComplianceData;
  /** Weekly compliance trend data */
  complianceTrend?: ComplianceTrendPoint[];
  /** Custodian performance breakdown */
  custodianPerformance?: CustodianPerformanceData[];

  // Top Booked Assets report specific fields
  /** The #1 most booked asset (independent of pagination) */
  topBookedAsset?: TopBookedAssetRow | null;
}

// -----------------------------------------------------------------------------
// Compliance Visualization Types
// -----------------------------------------------------------------------------

/** Compliance rate data with period comparison */
export interface ComplianceData {
  /** Bookings completed on time */
  onTime: number;
  /** Bookings completed late */
  late: number;
  /** Compliance rate as percentage (0-100), null if no completed bookings */
  rate: number | null;
  /** Comparison to prior period */
  priorPeriod?: {
    rate: number;
    delta: number;
    periodLabel: string;
    /** Prior period start date (for custom ranges) */
    fromDate?: Date;
    /** Prior period end date (for custom ranges) */
    toDate?: Date;
  };
}

/** Weekly compliance trend point */
export interface ComplianceTrendPoint {
  /** Period label (e.g., "Mon 21", "Week 1", "Mar 3-9") */
  label: string;
  /** Start of the period */
  weekStart: Date;
  /** Compliance rate for this period (null if no completions) */
  rate: number | null;
  /** Bookings completed on time */
  onTime: number;
  /** Bookings completed late */
  late: number;
  /** Total completions this period */
  total: number;
}

/** At-risk booking data */
export interface AtRiskBookingData {
  id: string;
  name: string;
  custodian: string | null;
  scheduledEnd: Date;
  assetCount: number;
  hoursUntilDue: number;
}

/** Custodian performance data */
export interface CustodianPerformanceData {
  custodianId: string | null;
  custodianName: string;
  onTime: number;
  late: number;
  total: number;
  rate: number;
}

// -----------------------------------------------------------------------------
// R2: Booking Compliance Report Types
// -----------------------------------------------------------------------------

/** Row type for the Booking Compliance report */
export interface BookingComplianceRow {
  id: string;
  bookingId: string;
  bookingName: string;
  status: BookingStatus;
  custodian: string | null;
  assetCount: number;
  scheduledStart: Date;
  scheduledEnd: Date;
  actualCheckout: Date | null;
  actualCheckin: Date | null;
  isOnTime: boolean;
  isOverdue: boolean;
  /** How late the return was in milliseconds (negative = early, positive = late) */
  latenessMs: number | null;
}

/**
 * KPI IDs emitted by the Booking Compliance report.
 *
 * Compliance rate / on-time / late breakdowns are now exposed via the
 * `complianceData` payload (sourced from `computeComplianceRate`) so the
 * KPI list is intentionally minimal.
 */
export type BookingComplianceKpiId = "total_bookings" | "currently_overdue";

// -----------------------------------------------------------------------------
// R6: Overdue Items Report Types
// -----------------------------------------------------------------------------

/** Row type for the Overdue Items report */
export interface OverdueItemRow {
  id: string;
  bookingId: string;
  bookingName: string;
  custodian: string | null;
  custodianId: string | null;
  assetCount: number;
  /** Number of assets already checked in (partial returns) */
  checkedInCount: number;
  /** Number of assets still outstanding (not yet returned) */
  uncheckedCount: number;
  scheduledEnd: Date;
  daysOverdue: number;
  /** Total value of assets in this booking (if available) */
  valueAtRisk: number | null;
}

/** KPI IDs for the Overdue Items report */
export type OverdueItemsKpiId =
  | "total_overdue"
  | "total_assets_at_risk"
  | "total_value_at_risk"
  | "avg_days_overdue"
  | "longest_overdue";

// -----------------------------------------------------------------------------
// R4: Idle Assets Report Types
// -----------------------------------------------------------------------------

/** Row type for the Idle Assets report */
export interface IdleAssetRow {
  id: string;
  assetId: string;
  assetName: string;
  /** Asset thumbnail image URL */
  thumbnailImage: string | null;
  category: string | null;
  location: string | null;
  /** Date of last booking checkout, null if never booked */
  lastBookedAt: Date | null;
  /** Days since last activity */
  daysSinceLastUse: number;
  /** Current asset status */
  status: string;
  /** Asset valuation if set */
  valuation: number | null;
}

/** KPI IDs for the Idle Assets report */
export type IdleAssetsKpiId =
  | "total_idle"
  | "idle_percentage"
  | "total_idle_value"
  | "avg_days_idle";

// -----------------------------------------------------------------------------
// R5: Custody Snapshot Report Types
// -----------------------------------------------------------------------------

/** Row type for the Custody Snapshot report */
export interface CustodySnapshotRow {
  id: string;
  assetId: string;
  assetName: string;
  /** Asset thumbnail image URL */
  thumbnailImage: string | null;
  category: string | null;
  location: string | null;
  custodianId: string;
  custodianName: string;
  /** When custody was assigned */
  assignedAt: Date;
  /** Days in custody */
  daysInCustody: number;
  /** Asset valuation if set */
  valuation: number | null;
}

/** KPI IDs for the Custody Snapshot report */
export type CustodySnapshotKpiId =
  | "total_in_custody"
  | "total_custodians"
  | "total_custody_value"
  | "avg_days_in_custody";

// -----------------------------------------------------------------------------
// R3: Top Booked Assets Report Types
// -----------------------------------------------------------------------------

/** Row type for the Top Booked Assets report */
export interface TopBookedAssetRow {
  id: string;
  assetId: string;
  assetName: string;
  /** Asset thumbnail image URL */
  thumbnailImage: string | null;
  category: string | null;
  location: string | null;
  /** Number of times booked in the timeframe */
  bookingCount: number;
  /** Total days booked */
  totalDaysBooked: number;
  /** Time booked percentage (days booked / days in period) */
  timeBookedRate: number;
}

/** KPI IDs for the Top Booked Assets report */
export type TopBookedAssetsKpiId =
  | "total_bookings"
  | "unique_assets_booked"
  | "avg_bookings_per_asset"
  | "most_booked_asset";

// -----------------------------------------------------------------------------
// R10: Asset Distribution Report Types
// -----------------------------------------------------------------------------

/** Row type for the Asset Distribution report (by category) */
export interface AssetDistributionRow {
  id: string;
  /** Group name (category, location, or status) */
  groupName: string;
  /** Number of assets in this group */
  assetCount: number;
  /** Percentage of total assets */
  percentage: number;
  /** Total value of assets in this group */
  totalValue: number | null;
}

/** Distribution breakdown data */
export interface DistributionBreakdown {
  /** Breakdown by category */
  byCategory: AssetDistributionRow[];
  /** Breakdown by location */
  byLocation: AssetDistributionRow[];
  /** Breakdown by status */
  byStatus: AssetDistributionRow[];
}

/** KPI IDs for the Asset Distribution report */
export type AssetDistributionKpiId =
  | "total_assets"
  | "total_value"
  | "total_categories"
  | "total_locations";

// -----------------------------------------------------------------------------
// R1: Asset Inventory Report Types
// -----------------------------------------------------------------------------

/** Row type for the Asset Inventory report */
export interface AssetInventoryRow {
  id: string;
  assetId: string;
  assetName: string;
  /** Asset thumbnail image URL */
  thumbnailImage: string | null;
  category: string | null;
  location: string | null;
  status: string;
  custodian: string | null;
  /** Asset valuation if set */
  valuation: number | null;
  /** Date asset was created */
  createdAt: Date;
  /** QR code ID if assigned */
  qrId: string | null;
}

/** KPI IDs for the Asset Inventory report */
export type AssetInventoryKpiId =
  | "total_assets"
  | "total_value"
  | "available_count"
  | "in_custody_count";

// -----------------------------------------------------------------------------
// R9: Monthly Booking Trends Report Types
// -----------------------------------------------------------------------------

/** Row type for the Monthly Booking Trends report (monthly aggregates) */
export interface MonthlyBookingTrendRow {
  id: string;
  /** Month label (e.g., "Jan 2024") */
  month: string;
  /** Start of the month */
  monthStart: Date;
  /** Number of bookings created */
  bookingsCreated: number;
  /** Number of bookings completed */
  bookingsCompleted: number;
  /** Number of unique assets booked */
  uniqueAssetsBooked: number;
  /** Month-over-month change percentage */
  momChange: number | null;
}

/** KPI IDs for the Monthly Booking Trends report */
export type MonthlyBookingTrendsKpiId =
  | "total_bookings"
  | "avg_monthly_bookings"
  | "peak_month"
  | "trend_direction";

// -----------------------------------------------------------------------------
// R8: Asset Utilization Report Types
// -----------------------------------------------------------------------------

/** Row type for the Asset Utilization report */
export interface AssetUtilizationRow {
  id: string;
  assetId: string;
  assetName: string;
  /** Asset thumbnail image URL */
  thumbnailImage: string | null;
  category: string | null;
  location: string | null;
  /** Total days in the period */
  totalDays: number;
  /** Days the asset was booked/in use */
  daysInUse: number;
  /** Utilization percentage (0-100) */
  utilizationRate: number;
  /** Number of bookings in the period */
  bookingCount: number;
  /** Asset valuation if set */
  valuation: number | null;
}

/** KPI IDs for the Asset Utilization report */
export type AssetUtilizationKpiId =
  | "avg_utilization"
  | "highly_utilized_count"
  | "underutilized_count"
  | "total_booking_days";

// -----------------------------------------------------------------------------
// R7: Asset Activity Summary Report Types
// -----------------------------------------------------------------------------

/** Activity type for asset activity report */
export type AssetActivityType =
  | "CREATED"
  | "UPDATED"
  | "CUSTODY_ASSIGNED"
  | "CUSTODY_RELEASED"
  | "BOOKING_CHECKED_OUT"
  | "BOOKING_CHECKED_IN"
  | "LOCATION_CHANGED"
  | "CATEGORY_CHANGED";

/** Row type for the Asset Activity Summary report */
export interface AssetActivityRow {
  id: string;
  assetId: string;
  assetName: string;
  /** Asset thumbnail image URL */
  thumbnailImage: string | null;
  /** Type of activity */
  activityType: AssetActivityType;
  /** Human-readable description */
  description: string;
  /** When the activity occurred */
  occurredAt: Date;
  /** User who performed the action (if applicable) */
  performedBy: string | null;
  /** Additional context (e.g., booking name, custodian name) */
  context: string | null;
}

/** KPI IDs for the Asset Activity Summary report */
export type AssetActivityKpiId =
  | "total_activities"
  | "custody_changes"
  | "booking_activities"
  | "most_active_asset";

// -----------------------------------------------------------------------------
// PDF Export Types
// -----------------------------------------------------------------------------

/** Base fields common to all report PDFs */
export interface ReportPdfMetaBase {
  reportId: string;
  reportTitle: string;
  reportDescription: string;
  organizationName: string;
  organizationImageId: string | null;
  organizationUpdatedAt: Date;
  generatedAt: string;
  totalCount: number;
  /**
   * ISO 4217 currency code of the workspace whose data the PDF is rendering.
   * Used by the PDF renderer to format monetary values via `formatCurrency`.
   */
  currency: Currency;
  /**
   * BCP 47 locale tag (e.g. `"en-GB"`, `"fr-FR"`) resolved from the request's
   * client hints. Drives currency + number formatting in the PDF.
   */
  locale: string;
}

/** Data structure for compliance report PDF generation */
export interface CompliancePdfMeta extends ReportPdfMetaBase {
  reportId: "booking-compliance";
  timeframeLabel: string;
  timeframeFrom: string;
  timeframeTo: string;
  complianceRate: number;
  onTimeCount: number;
  lateCount: number;
  overdueCount: number;
  priorPeriod?: {
    rate: number;
    delta: number;
    periodLabel: string;
  };
  custodianPerformance: Array<{
    custodianName: string;
    rate: number;
    onTime: number;
    late: number;
    total: number;
  }>;
  rows: Array<{
    bookingId: string;
    bookingName: string;
    status: string;
    custodian: string | null;
    assetCount: number;
    scheduledStart: string;
    scheduledEnd: string;
    isOnTime: boolean;
    returnStatus: string;
  }>;
}

/** Data structure for asset inventory report PDF */
export interface AssetInventoryPdfMeta extends ReportPdfMetaBase {
  reportId: "asset-inventory";
  totalValuation: number;
  statusBreakdown: {
    available: number;
    inCustody: number;
    checkedOut: number;
  };
  rows: Array<{
    assetId: string;
    assetName: string;
    status: string;
    category: string | null;
    location: string | null;
    custodian: string | null;
    valuation: number | null;
    qrId: string | null;
  }>;
}

/** Data structure for custody snapshot report PDF */
export interface CustodySnapshotPdfMeta extends ReportPdfMetaBase {
  reportId: "custody-snapshot";
  totalAssetsInCustody: number;
  totalCustodians: number;
  totalValuation: number;
  rows: Array<{
    assetId: string;
    assetName: string;
    category: string | null;
    location: string | null;
    custodianName: string;
    assignedAt: string;
    daysInCustody: number;
    valuation: number | null;
  }>;
}

/** Union type for all report PDF metadata */
export type ReportPdfMeta =
  | CompliancePdfMeta
  | AssetInventoryPdfMeta
  | CustodySnapshotPdfMeta;

// -----------------------------------------------------------------------------
// Report Definition Types
// -----------------------------------------------------------------------------

/** Supported filter types for a report */
export type ReportFilterConfig = {
  type: FilterType;
  label: string;
  multi?: boolean;
};

/**
 * Report definition in the registry. Describes a report's metadata and
 * capabilities without containing any runtime logic.
 */
export interface ReportDefinition {
  /** Unique report identifier (URL-safe slug) */
  id: string;
  /** Human-readable title */
  title: string;
  /** Short description shown in the reports index */
  description: string;
  /** Category for grouping in the index */
  category: "bookings" | "assets" | "custody" | "audits" | "overview";
  /** Icon name from Lucide */
  icon: string;
  /** Whether the report is available (false = "Coming soon") */
  enabled: boolean;
  /** Supported filters */
  filters: ReportFilterConfig[];
  /** Whether the report includes charts */
  hasChart: boolean;
  /** Whether CSV export is available */
  exportable: boolean;
  /** Required permission action (defaults to "read") */
  requiredAction?: "read" | "export";
}
