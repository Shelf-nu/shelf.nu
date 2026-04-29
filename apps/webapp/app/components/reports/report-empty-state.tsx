/**
 * Report Empty State Component
 *
 * Displayed when a report has no data for the selected timeframe/filters.
 * Matches the app's existing empty state patterns.
 *
 * @see {@link file://../../components/list/empty-state.tsx}
 * @see {@link file://../../components/dashboard/empty-state.tsx}
 */

import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";

export type ReportEmptyReason = "no_data" | "no_results" | "error";

export interface ReportEmptyStateProps {
  /** Why the report is empty */
  reason?: ReportEmptyReason;
  /** Custom title (overrides default) */
  title?: string;
  /** Custom description (overrides default) */
  description?: string;
  /** Primary CTA link (e.g., "/bookings/new") */
  ctaTo?: string;
  /** Primary CTA label (e.g., "Create a booking") */
  ctaLabel?: string;
  /** Action to clear filters */
  onClearFilters?: () => void;
  /** Additional CSS classes */
  className?: string;
}

const CONTENT: Record<
  ReportEmptyReason,
  { title: string; description: string }
> = {
  no_data: {
    title: "No activity yet",
    description:
      "This report will populate as activity events are recorded. Check back after some bookings or asset changes have occurred.",
  },
  no_results: {
    title: "No matching results",
    description:
      "No data matches your current filters. Try adjusting the timeframe or removing some filters.",
  },
  error: {
    title: "Unable to load report",
    description:
      "Something went wrong loading this report. Please try again or contact support if the issue persists.",
  },
};

/**
 * Empty state for reports with no data.
 *
 * Uses the app's standard empty state illustration and styling patterns
 * for visual consistency across the application.
 */
export function ReportEmptyState({
  reason = "no_data",
  title,
  description,
  ctaTo,
  ctaLabel,
  onClearFilters,
  className,
}: ReportEmptyStateProps) {
  const content = CONTENT[reason];

  return (
    <div
      className={tw(
        "flex flex-col items-center justify-center gap-8 px-4 py-[100px] text-center",
        className
      )}
    >
      {/* Empty state illustration - matches app pattern */}
      <img
        src="/static/images/empty-state.svg"
        alt=""
        aria-hidden="true"
        className="h-auto w-[172px]"
      />

      <div className="flex flex-col gap-2">
        {/* Title */}
        <div className="text-lg font-semibold text-gray-900">
          {title || content.title}
        </div>

        {/* Description */}
        <p className="text-gray-600">{description || content.description}</p>
      </div>

      {/* Actions */}
      {(ctaTo || onClearFilters) && (
        <div className="flex items-center gap-3">
          {ctaTo && (
            <Button to={ctaTo} variant="primary">
              {ctaLabel || "Get started"}
            </Button>
          )}
          {onClearFilters && (
            <Button type="button" variant="secondary" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default ReportEmptyState;
