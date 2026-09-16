/**
 * Card for one saved report on the reports index.
 *
 * Opens the builder with the report's stored query. Styled like the built-in
 * report cards so the "Your reports" row reads as part of the same grid.
 *
 * @see {@link file://../../../routes/_layout+/reports._index.tsx}
 */

import { ArrowRight, BookMarked } from "lucide-react";
import { Link } from "react-router";
import { DateS } from "~/components/shared/date";
import { describeSavedReportQuery } from "~/modules/reports/saved/describe";
import { savedReportHref } from "~/modules/reports/saved/query";

/** Props for {@link SavedReportCard}. */
type Props = {
  report: {
    id: string;
    name: string;
    query: string;
    /** Who saved it, already resolved to a display name. */
    savedBy: string;
    /** Last save or rename; a string once it has crossed the loader. */
    updatedAt: string | Date;
  };
};

/** Renders a saved report as a card linking to the builder. */
export function SavedReportCard({ report }: Props) {
  return (
    <Link to={savedReportHref(report)} prefetch="intent">
      <div className="group relative cursor-pointer rounded-lg border border-gray-200 bg-white p-5 transition-all hover:border-gray-300 hover:shadow-sm">
        <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
          <BookMarked className="size-5" />
        </div>
        <h4 className="truncate text-sm font-semibold text-gray-900">
          {report.name}
        </h4>
        <p className="mt-1 line-clamp-2 text-xs text-gray-500">
          {describeSavedReportQuery(report.query)}
        </p>
        <p className="mt-2 truncate text-xs text-gray-400">
          Saved by {report.savedBy || "a teammate"} ·{" "}
          <DateS date={report.updatedAt} />
        </p>
        <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <ArrowRight className="size-4 text-gray-400" />
        </div>
      </div>
    </Link>
  );
}
