/**
 * Unlock Reports Page
 *
 * What a workspace sees on the reports index when its plan does not include
 * reports (the Free plan). It says reports are part of Plus and Team, lists
 * every report so the reader sees what they would get, and points the owner to
 * the subscription page. Everyone else is told to ask the owner, because only
 * the owner's plan decides what the workspace has.
 *
 * Rendered inside the reports layout, under the same header as the report
 * cards. It shows no report data and no prices: prices live on the
 * subscription page.
 *
 * Client-safe: it must never import a `*.server` module.
 *
 * @see {@link file://../../routes/_layout+/reports._index.tsx} the loader that decides which page shows
 * @see {@link file://../../modules/reports/plan-copy.ts} the title the 403 downloads share
 */

import { FileBarChartIcon } from "lucide-react";

import { REPORTS_PLAN_TITLE } from "~/modules/reports/plan-copy";
import { REPORT_CATEGORIES } from "~/modules/reports/registry";
import type { ReportDefinition } from "~/modules/reports/types";

import { ReportIcon } from "./report-icon";
import { Button } from "../shared/button";

/** Props for {@link UnlockReportsPage}. */
type UnlockReportsPageProps = {
  /** The reports the plan would unlock, in registry order. */
  reports: Pick<
    ReportDefinition,
    "id" | "title" | "description" | "category" | "icon"
  >[];
  /** Whether the viewer owns the workspace, and so can change its plan. */
  isOwner: boolean;
};

/**
 * The reports unlock page: title, one sentence, the reports grouped by
 * category, then the next step for this viewer.
 */
export function UnlockReportsPage({
  reports,
  isOwner,
}: UnlockReportsPageProps) {
  // Group in the registry's category order, keeping only categories that have
  // a report, so a category with nothing in it never shows an empty heading.
  const groups = (
    Object.keys(REPORT_CATEGORIES) as ReportDefinition["category"][]
  )
    .map((category) => ({
      category,
      label: REPORT_CATEGORIES[category].label,
      reports: reports.filter((report) => report.category === category),
    }))
    .filter((group) => group.reports.length > 0);

  return (
    <section
      aria-labelledby="unlock-reports-title"
      className="mx-auto w-full max-w-3xl rounded border border-gray-200 bg-white p-6 md:p-8"
    >
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-2.5 text-primary">
          <FileBarChartIcon className="size-5" aria-hidden="true" />
        </div>
        <h3
          id="unlock-reports-title"
          className="text-lg font-semibold text-gray-900"
        >
          {REPORTS_PLAN_TITLE}
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          See how your equipment is used, booked and held, across bookings,
          assets and custody.
        </p>
      </div>

      <div className="mt-6 space-y-5">
        {groups.map((group) => (
          <div key={group.category}>
            <h4 className="mb-2 text-xs font-medium text-gray-500">
              {group.label}
            </h4>
            <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {group.reports.map((report) => (
                <li key={report.id} className="flex items-start gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                    <ReportIcon name={report.icon} className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {report.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {report.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3 border-t border-gray-100 pt-6 text-center">
        {isOwner ? (
          <Button to="/account-details/subscription" variant="primary">
            Upgrade
          </Button>
        ) : (
          <p className="text-sm font-medium text-gray-700">
            Ask the workspace owner to upgrade.
          </p>
        )}
        <p className="text-xs text-gray-500">
          Your asset list, filters and counts stay available on every plan.
        </p>
      </div>
    </section>
  );
}
