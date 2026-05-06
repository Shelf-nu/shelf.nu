/**
 * Needs Attention Panel
 *
 * Shows actionable insights: custodians with low compliance,
 * overdue bookings, and recommendations.
 */

import { User, CheckCircle } from "lucide-react";

import type { CustodianPerformanceData } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

// Re-export with alias for backwards compatibility
export type CustodianPerformance = CustodianPerformanceData;

export interface NeedsAttentionProps {
  /** Custodian performance data (sorted worst first) */
  custodianPerformance: CustodianPerformance[];
  /** Overall compliance rate (null if no data) */
  overallRate: number | null;
  /** Label for the selected timeframe (e.g., "Last 30 days") */
  timeframeLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Panel showing actionable insights that need attention.
 */
export function NeedsAttention({
  custodianPerformance,
  overallRate,
  timeframeLabel,
  className,
}: NeedsAttentionProps) {
  // Show custodians with significant late returns (at least 2 bookings, below threshold)
  const threshold =
    overallRate !== null && overallRate >= 50
      ? Math.min(80, overallRate - 10)
      : 50;
  const needsAttention = custodianPerformance.filter(
    (c) => c.total >= 2 && c.rate < threshold
  );
  const hasIssues = needsAttention.length > 0;

  return (
    <div
      className={tw(
        "flex flex-col rounded border border-gray-200 bg-white",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-gray-900">
            Team Performance
          </h3>
          {timeframeLabel && (
            <span className="text-xs text-gray-400">{timeframeLabel}</span>
          )}
        </div>
        {hasIssues && (
          <span className="text-xs text-gray-500">
            {needsAttention.length} below threshold
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {!hasIssues ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <CheckCircle className="size-5 text-green-600" />
            <p className="text-sm text-gray-600">Compliance is healthy</p>
            <p className="max-w-[200px] text-xs text-gray-400">
              No team members need attention.
            </p>
          </div>
        ) : (
          <div className="py-2">
            {needsAttention.slice(0, 5).map((custodian) => (
              <div
                key={custodian.custodianId || "none"}
                className="flex items-center justify-between px-4 py-2 md:px-6"
              >
                <div className="flex items-center gap-3">
                  <User className="size-4 shrink-0 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-900">
                      {custodian.custodianName}
                    </p>
                    <p className="text-xs text-gray-500">
                      {custodian.late} late of {custodian.total}
                    </p>
                  </div>
                </div>
                <span
                  className={tw(
                    "text-sm font-medium",
                    custodian.rate >= 80
                      ? "text-green-600"
                      : custodian.rate >= 50
                      ? "text-orange-600"
                      : "text-red-600"
                  )}
                >
                  {custodian.rate}%
                </span>
              </div>
            ))}
            {needsAttention.length > 5 && (
              <p className="px-4 py-1 text-xs text-gray-400 md:px-6">
                +{needsAttention.length - 5} more
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default NeedsAttention;
