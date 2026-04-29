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
