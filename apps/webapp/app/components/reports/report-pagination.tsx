/**
 * Report Pagination Component
 *
 * Simple pagination controls for report tables. Updates URL params
 * for bookmarkable state.
 *
 * @see {@link file://../../components/list/pagination/index.tsx}
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

import { useSearchParams } from "~/hooks/search-params";
import { tw } from "~/utils/tw";

export interface ReportPaginationProps {
  /** Current page (1-indexed) */
  page: number;
  /** Items per page */
  pageSize: number;
  /** Total number of items */
  totalRows: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Compact pagination controls for reports.
 *
 * Shows: [<] Page X of Y [>]
 * Updates URL search params on navigation.
 */
export function ReportPagination({
  page,
  pageSize,
  totalRows,
  className,
}: ReportPaginationProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  const totalPages = Math.ceil(totalRows / pageSize);
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", newPage.toString());
    setSearchParams(params, { replace: true });
  };

  // Don't show pagination if only one page
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className={tw("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => goToPage(page - 1)}
        disabled={!canGoPrev}
        className={tw(
          "flex size-7 items-center justify-center rounded-md border border-gray-200",
          "text-gray-600 transition-colors",
          "hover:bg-gray-50 hover:text-gray-900",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
        )}
        aria-label="Go to previous page"
      >
        <ChevronLeft className="size-4" />
      </button>

      <span className="px-2 text-xs text-gray-500">
        Page <span className="font-medium text-gray-700">{page}</span> of{" "}
        <span className="font-medium text-gray-700">{totalPages}</span>
      </span>

      <button
        type="button"
        onClick={() => goToPage(page + 1)}
        disabled={!canGoNext}
        className={tw(
          "flex size-7 items-center justify-center rounded-md border border-gray-200",
          "text-gray-600 transition-colors",
          "hover:bg-gray-50 hover:text-gray-900",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
        )}
        aria-label="Go to next page"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

export default ReportPagination;
