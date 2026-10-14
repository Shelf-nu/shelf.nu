/**
 * Reports Index Route
 *
 * Displays a grid of available reports with their status (enabled/coming soon).
 * Users can click on enabled reports to navigate to them.
 *
 * Reports are part of the Plus and Team plans. When the workspace's plan does
 * not include them, the same page shows the unlock page instead of the cards,
 * and the loader sends no report data.
 *
 * @see {@link file://../../modules/reports/registry.ts}
 * @see {@link file://../../components/reports/unlock-reports-page.tsx}
 */

import { ArrowRight, Lock } from "lucide-react";
import { data, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import Header from "~/components/layout/header";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { ReportIcon } from "~/components/reports/report-icon";
import { UnlockReportsPage } from "~/components/reports/unlock-reports-page";

import {
  REPORTS,
  REPORT_CATEGORIES,
  getEnabledReports,
  getReportsByCategory,
} from "~/modules/reports/registry";
import type { ReportDefinition } from "~/modules/reports/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { isOrganizationOwner, requirePermission } from "~/utils/roles.server";
import { workspaceCanUseReports } from "~/utils/subscription.server";
import { tw } from "~/utils/tw";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title || "Reports") },
];

/**
 * Returns the reports index for the active workspace. The payload is a union on
 * `canUseReports`: the report cards when the workspace's plan includes reports,
 * or what the unlock page needs (the report list and whether the viewer owns
 * the workspace) when it does not. Both shapes carry `header`, which `meta` and
 * the layout header read.
 *
 * @throws {ShelfError} when the caller lacks `reports: read`
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    // The role check runs first, so a role that may not see reports gets the
    // role error whatever the plan.
    const { organizationId, organizations, userOrganizations } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.reports,
        action: PermissionAction.read,
      });

    // Standard header object for app Header component
    const header = {
      title: "Reports",
      subHeading: "Track and analyze your asset management operations",
    };

    // The plan is the workspace's (its owner's tier), never the viewer's own.
    const canUseReports = await workspaceCanUseReports({
      organizationId,
      organizations,
    });

    if (!canUseReports) {
      return data({
        canUseReports: false as const,
        header,
        // Only the owner's plan decides what the workspace has, so only the
        // owner is offered the upgrade.
        isOwner: isOrganizationOwner({ userOrganizations, organizationId }),
        reports: getEnabledReports(),
      });
    }

    return data({
      canUseReports: true as const,
      header,
      reports: REPORTS,
      reportsByCategory: getReportsByCategory(),
      categories: REPORT_CATEGORIES,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

/**
 * The reports index page. Shows the unlock page when the workspace's plan does
 * not include reports, and the report cards grouped by category otherwise.
 */
export default function ReportsIndex() {
  const loaderData = useLoaderData<typeof loader>();

  // Branch before reading anything only the paid shape carries.
  if (!loaderData.canUseReports) {
    return (
      <>
        <Header />
        <ListContentWrapper>
          <UnlockReportsPage
            reports={loaderData.reports}
            isOwner={loaderData.isOwner}
          />
        </ListContentWrapper>
      </>
    );
  }

  const { reportsByCategory, categories } = loaderData;

  // Filter to only show categories with reports
  const visibleCategories = Object.entries(reportsByCategory).filter(
    ([categoryKey, reports]) => {
      const category = categories[categoryKey as keyof typeof categories];
      return category && reports.length > 0;
    }
  );

  return (
    <>
      {/* Standard app header - gets title/subHeading from loader data */}
      <Header />

      {/* Content area matching app patterns */}
      <ListContentWrapper>
        <div className="space-y-6">
          {visibleCategories.map(([categoryKey, reports]) => {
            const category = categories[categoryKey as keyof typeof categories];

            return (
              <section key={categoryKey}>
                <div className="mb-3">
                  <h3 className="text-sm font-medium text-gray-900">
                    {category.label}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {category.description}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {reports.map((report) => (
                    <ReportCard key={report.id} report={report} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </ListContentWrapper>
    </>
  );
}

/**
 * One report on the index: a link to the report when it is enabled, or a muted
 * "Coming soon" card when it is not.
 *
 * @param props.report - The report's registry entry
 */
function ReportCard({ report }: { report: ReportDefinition }) {
  const cardContent = (
    <div
      className={tw(
        "group relative rounded-lg border bg-white p-5 transition-all",
        report.enabled
          ? "cursor-pointer border-gray-200 hover:border-gray-300 hover:shadow-sm"
          : "cursor-not-allowed border-gray-100 bg-gray-50 opacity-75"
      )}
    >
      {/* Icon - uses primary orange accent like Home page */}
      <div
        className={tw(
          "mb-3 flex size-10 items-center justify-center rounded-lg",
          report.enabled
            ? "bg-primary-50 text-primary-600"
            : "bg-gray-100 text-gray-400"
        )}
      >
        <ReportIcon name={report.icon} className="size-5" />
      </div>

      {/* Title */}
      <h4
        className={tw(
          "text-sm font-semibold",
          report.enabled ? "text-gray-900" : "text-gray-500"
        )}
      >
        {report.title}
      </h4>

      {/* Description */}
      <p className="mt-1 line-clamp-2 text-xs text-gray-500">
        {report.description}
      </p>

      {/* Coming soon badge */}
      {!report.enabled && (
        <div className="absolute right-3 top-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
            <Lock className="size-2.5" />
            Coming soon
          </span>
        </div>
      )}

      {/* Arrow indicator for enabled reports */}
      {report.enabled && (
        <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
          <ArrowRight className="size-4 text-gray-400" />
        </div>
      )}
    </div>
  );

  if (report.enabled) {
    return (
      <Link to={`/reports/${report.id}`} prefetch="intent">
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}
