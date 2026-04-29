/**
 * Report Skeleton Component
 *
 * Loading state for report pages. Shows placeholder shapes for KPIs,
 * charts, and table rows while data is loading.
 *
 * @see {@link file://../../components/shared/skeleton.tsx}
 */

import { Skeleton } from "~/components/shared/skeleton";
import { tw } from "~/utils/tw";

export interface ReportSkeletonProps {
  /** Number of KPI cards to show */
  kpiCount?: number;
  /** Number of table rows to show */
  rowCount?: number;
  /** Whether to show chart skeleton */
  showChart?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Full-page skeleton for report loading state.
 *
 * Matches the ReportShell layout with:
 * - KPI grid
 * - Optional chart
 * - Table rows
 */
export function ReportSkeleton({
  kpiCount = 4,
  rowCount = 10,
  showChart = true,
  className,
}: ReportSkeletonProps) {
  return (
    <div className={tw("space-y-6", className)}>
      {/* KPI Grid Skeleton */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: kpiCount }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>

      {/* Chart Skeleton */}
      {showChart && <ChartSkeleton />}

      {/* Table Skeleton */}
      <TableSkeleton rowCount={rowCount} />
    </div>
  );
}

/**
 * Single KPI card skeleton.
 */
export function KpiCardSkeleton() {
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      {/* Label */}
      <Skeleton className="h-3 w-20" />
      {/* Value */}
      <Skeleton className="mt-2 h-7 w-16" />
      {/* Delta */}
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  );
}

/**
 * Chart area skeleton.
 */
export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div className="rounded border border-gray-200 bg-white" style={{ height }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-24" />
      </div>

      {/* Chart area */}
      <div className="flex h-full items-end justify-between gap-2 p-4 pb-8">
        {/* Simulated bars */}
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            style={{
              height: `${Math.random() * 60 + 20}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Table skeleton with header and rows.
 */
export function TableSkeleton({ rowCount = 10 }: { rowCount?: number }) {
  return (
    <div className="rounded border border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-gray-200 px-4 py-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>

      {/* Rows */}
      {Array.from({ length: rowCount }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-gray-100 px-4 py-3"
        >
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export default ReportSkeleton;
