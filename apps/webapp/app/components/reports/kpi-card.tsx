/**
 * KPI Card Component
 *
 * Displays a single key performance indicator with optional delta comparison.
 * Designed for the reports UI with a compact, monochrome aesthetic.
 *
 * Features:
 * - Large, prominent value display
 * - Period-over-period delta with directional indicator
 * - Optional click-through link
 * - Accessible with proper semantic markup
 *
 * @see {@link file://./kpi-grid.tsx}
 */

import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Link } from "react-router";

import type { ReportKpi } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

export interface KpiCardProps {
  /** KPI data to display */
  kpi: ReportKpi;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show the delta indicator */
  showDelta?: boolean;
}

/**
 * A single KPI card displaying a metric with optional trend indicator.
 *
 * Compact styling: small label, large value, subtle delta.
 * Monochrome with semantic color only for delta direction.
 */
export function KpiCard({ kpi, className, showDelta = true }: KpiCardProps) {
  const content = (
    <div
      className={tw(
        "flex flex-col rounded border border-gray-200 bg-white p-4 md:p-6",
        "transition-all duration-150",
        kpi.href &&
          "cursor-pointer hover:border-primary-200 hover:bg-primary-25",
        className
      )}
    >
      {/* Label */}
      <p className="text-xs font-medium text-gray-600">{kpi.label}</p>

      {/* Value */}
      <p className="mt-1 text-2xl font-semibold text-gray-900">{kpi.value}</p>

      {/* Delta */}
      {showDelta && kpi.delta && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-gray-500">
          <DeltaIcon type={kpi.deltaType} />
          <span
            className={tw(
              "font-medium",
              kpi.deltaType === "positive" && "text-success-600",
              kpi.deltaType === "negative" && "text-error-600",
              kpi.deltaType === "neutral" && "text-gray-500"
            )}
          >
            {kpi.delta}
          </span>
          {kpi.deltaPeriodLabel && (
            <span className="text-gray-400">{kpi.deltaPeriodLabel}</span>
          )}
        </div>
      )}
    </div>
  );

  if (kpi.href) {
    return (
      <Link to={kpi.href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

function DeltaIcon({ type }: { type?: "positive" | "negative" | "neutral" }) {
  const iconClass = "h-3 w-3";

  switch (type) {
    case "positive":
      return <TrendingUp className={tw(iconClass, "text-success-600")} />;
    case "negative":
      return <TrendingDown className={tw(iconClass, "text-error-600")} />;
    default:
      return <Minus className={tw(iconClass, "text-gray-400")} />;
  }
}

export default KpiCard;
