/**
 * Reports Components — Barrel Export
 *
 * All report UI primitives exported from a single entry point.
 *
 * @example
 * ```ts
 * import {
 *   ReportShell,
 *   KpiGrid,
 *   TimeframePicker,
 *   ReportTable,
 *   BarChart,
 * } from "~/components/reports";
 * ```
 */

// Layout
export { ReportShell, ReportFooter } from "./report-shell";

// KPIs
export { KpiCard } from "./kpi-card";
export { KpiGrid } from "./kpi-grid";
export type { KpiCardProps } from "./kpi-card";
export type { KpiGridProps } from "./kpi-grid";

// Timeframe
export { TimeframePicker } from "./timeframe-picker";
export type { TimeframePickerProps } from "./timeframe-picker";

// Table
export {
  ReportTable,
  StatusCell,
  DateCell,
  NumberCell,
  BooleanCell,
  AssetCell,
} from "./report-table";
export type { ReportTableProps } from "./report-table";

// Charts
export { ChartCard } from "./chart-card";
export { AreaChart } from "./area-chart";
export { BarChart } from "./bar-chart";
export { LazyAreaChart, LazyBarChart } from "./charts.lazy";
export type { ChartCardProps } from "./chart-card";
export type { AreaChartProps } from "./area-chart";
export type { BarChartProps } from "./bar-chart";

// Compliance Visualizations
export { ComplianceDonut } from "./compliance-donut";
export { AtRiskBookings } from "./at-risk-bookings";
export { ComplianceTrend } from "./compliance-trend";
export { ComplianceHero } from "./compliance-hero";
export { NeedsAttention } from "./needs-attention";
export type { ComplianceDonutProps } from "./compliance-donut";
export type { AtRiskBookingsProps, AtRiskBooking } from "./at-risk-bookings";
export type {
  ComplianceTrendProps,
  ComplianceTrendPoint,
} from "./compliance-trend";
export type { ComplianceHeroProps } from "./compliance-hero";
export type {
  NeedsAttentionProps,
  CustodianPerformance,
} from "./needs-attention";

// Distribution Visualizations
export { DistributionDonut } from "./distribution-donut";
export type {
  DistributionDonutProps,
  DistributionItem,
} from "./distribution-donut";

// Actions
export { ExportReportButton } from "./export-report-button";
export type { ExportReportButtonProps } from "./export-report-button";

// PDF Export
export { ComplianceReportPdf } from "./compliance-report-pdf";
export type { ComplianceReportPdfProps } from "./compliance-report-pdf";
export { ReportPdf } from "./report-pdf";
export type { ReportPdfProps } from "./report-pdf";

// Pagination
export { ReportPagination } from "./report-pagination";
export type { ReportPaginationProps } from "./report-pagination";

// States
export { ReportEmptyState } from "./report-empty-state";
export {
  ReportSkeleton,
  KpiCardSkeleton,
  ChartSkeleton,
  TableSkeleton,
} from "./report-skeleton";
export type {
  ReportEmptyStateProps,
  ReportEmptyReason,
} from "./report-empty-state";
export type { ReportSkeletonProps } from "./report-skeleton";

// Filter / range UI helpers used by the reports route
export { TimeframeRangeIndicator } from "./timeframe-range-indicator";
export { IdleThresholdSelector } from "./idle-threshold-selector";

// Per-report Content components — each owns its own table columns,
// hero, and KPI extraction. Used by ReportContentSwitch (below).
export { BookingComplianceContent } from "./booking-compliance-content";
export { OverdueItemsContent } from "./overdue-items-content";
export { IdleAssetsContent } from "./idle-assets-content";
export { CustodySnapshotContent } from "./custody-snapshot-content";
export { TopBookedAssetsContent } from "./top-booked-assets-content";
export { AssetDistributionContent } from "./asset-distribution-content";
export { AssetInventoryContent } from "./asset-inventory-content";
export { MonthlyBookingTrendsContent } from "./monthly-booking-trends-content";
export { AssetUtilizationContent } from "./asset-utilization-content";
export { AssetActivityContent } from "./asset-activity-content";

// Route-level page composition pieces — these are the chunks the
// reports.$reportId route stitches together.
export { ReportExportActions } from "./report-export-actions";
export { ReportFilterBar } from "./report-filter-bar";
export { ReportContentSwitch } from "./report-content-switch";

// Reports route hooks
export { useReportRowHandlers } from "./use-report-row-handlers";
export type { ReportRowHandlers } from "./use-report-row-handlers";
export { useCsvExport } from "./use-csv-export";
