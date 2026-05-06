/**
 * Compliance Hero Metric
 *
 * Clean, understated display of the main compliance rate.
 * Answers the key question: "How are we doing?"
 */

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { tw } from "~/utils/tw";

export interface ComplianceHeroProps {
  /** Overall compliance rate (0-100), null if no data */
  rate: number | null;
  /** On-time completions count */
  onTime: number;
  /** Late completions count */
  late: number;
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
  /** Label for the selected timeframe (e.g., "Last 30 days") */
  timeframeLabel?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Format the prior period label, showing dates for custom ranges.
 */
function formatPriorPeriodLabel(
  periodLabel: string,
  fromDate?: Date,
  toDate?: Date
): string {
  // For custom ranges, show the actual dates
  if (periodLabel === "prior period" && fromDate && toDate) {
    const formatDate = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${formatDate(fromDate)} – ${formatDate(toDate)}`;
  }
  return periodLabel;
}

/**
 * Hero metric card showing the main compliance rate.
 */
export function ComplianceHero({
  rate,
  onTime,
  late,
  priorPeriod,
  timeframeLabel,
  className,
}: ComplianceHeroProps) {
  const total = onTime + late;
  const priorLabel = priorPeriod
    ? formatPriorPeriodLabel(
        priorPeriod.periodLabel,
        priorPeriod.fromDate,
        priorPeriod.toDate
      )
    : "";

  return (
    <div className={tw("rounded border border-gray-200 bg-white", className)}>
      <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
        {/* Main metric */}
        <div className="flex items-center gap-4">
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-semibold text-gray-900">
              {rate !== null ? `${rate}%` : "—"}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-sm font-medium text-gray-700">
              On-Time Return Rate
            </span>

            {/* Period comparison */}
            {priorPeriod && priorPeriod.delta !== 0 && (
              <span className="flex items-center gap-1 text-xs">
                {priorPeriod.delta > 0 ? (
                  <>
                    <TrendingUp className="size-3 text-green-600" />
                    <span className="text-green-600">
                      +{priorPeriod.delta}%
                    </span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="size-3 text-orange-600" />
                    <span className="text-orange-600">
                      {priorPeriod.delta}%
                    </span>
                  </>
                )}
                <span className="text-gray-500">vs {priorLabel}</span>
              </span>
            )}

            {priorPeriod && priorPeriod.delta === 0 && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <Minus className="size-3" />
                <span>Same as {priorLabel}</span>
              </span>
            )}

            {!priorPeriod && total > 0 && (
              <span className="text-xs text-gray-400">{timeframeLabel}</span>
            )}

            {total === 0 && (
              <span className="text-xs text-gray-400">
                No completed bookings in period
              </span>
            )}

            {total > 0 && late > 0 && (
              <span className="text-xs text-gray-500">
                {late} of {total} bookings returned late
              </span>
            )}
          </div>
        </div>

        {/* Supporting stats */}
        <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">On-time</span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-green-500" />
              <span className="text-lg font-medium text-gray-900">
                {onTime}
              </span>
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-xs text-gray-500">Late</span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-orange-500" />
              <span className="text-lg font-medium text-gray-900">{late}</span>
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-xs text-gray-500">Total</span>
            <span className="text-lg font-medium text-gray-900">{total}</span>
          </div>
        </div>
      </div>

      {/* Calculation explanation */}
      {total > 0 && (
        <div className="border-t border-gray-100 px-4 py-2 md:px-6">
          <p className="text-xs text-gray-400">
            <span className="font-medium text-gray-500">
              How it's calculated:
            </span>{" "}
            {onTime} on-time ÷ {total} total = {rate}% (rounded to nearest whole
            number). Bookings with a due date in this period are counted:
            completed and archived bookings are "on-time" if returned within 15
            minutes of the scheduled end; overdue bookings always count as late.
          </p>
        </div>
      )}
    </div>
  );
}

export default ComplianceHero;
