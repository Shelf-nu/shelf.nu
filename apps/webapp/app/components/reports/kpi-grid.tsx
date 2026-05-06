/**
 * KPI Grid Component
 *
 * Responsive grid layout for displaying multiple KPI cards.
 * Adapts from 2 columns on mobile to 4 columns on desktop.
 *
 * @see {@link file://./kpi-card.tsx}
 */

import type { ReportKpi } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

import { KpiCard } from "./kpi-card";

export interface KpiGridProps {
  /** Array of KPIs to display */
  kpis: ReportKpi[];
  /** Whether to show delta indicators on cards */
  showDeltas?: boolean;
  /** Additional CSS classes for the grid container */
  className?: string;
  /** Number of columns on large screens (default: 4) */
  columns?: 2 | 3 | 4;
}

/**
 * Responsive grid of KPI cards.
 *
 * Layout:
 * - Mobile: 2 columns
 * - Tablet: 3 columns
 * - Desktop: 4 columns (configurable)
 */
export function KpiGrid({
  kpis,
  showDeltas = true,
  className,
  columns = 4,
}: KpiGridProps) {
  if (kpis.length === 0) {
    return null;
  }

  const columnClasses = {
    2: "md:grid-cols-2",
    3: "md:grid-cols-3",
    4: "md:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div
      className={tw(
        "grid grid-cols-2 gap-4",
        columnClasses[columns],
        className
      )}
    >
      {kpis.map((kpi) => (
        <KpiCard key={kpi.id} kpi={kpi} showDelta={showDeltas} />
      ))}
    </div>
  );
}

export default KpiGrid;
