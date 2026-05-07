/**
 * Reports Index Route
 *
 * Displays a grid of available reports with their status (enabled/coming soon).
 * Users can click on enabled reports to navigate to them.
 *
 * @see {@link file://../../modules/reports/registry.ts}
 */

import type React from "react";
import * as LucideIcons from "lucide-react";
import { Lock } from "lucide-react";
import { data, Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";

import Header from "~/components/layout/header";
import { ListContentWrapper } from "~/components/list/content-wrapper";

import {
  REPORTS,
  REPORT_CATEGORIES,
  getReportsByCategory,
} from "~/modules/reports/registry";
import type { ReportDefinition } from "~/modules/reports/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title || "Reports") },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  // For now, require asset read permission as a proxy
  // TODO: Add PermissionEntity.reports when schema is updated
  await requirePermission({
    userId,
    request,
    entity: PermissionEntity.asset,
    action: PermissionAction.read,
  });

  const reportsByCategory = getReportsByCategory();

  // Standard header object for app Header component
  const header = {
    title: "Reports",
    subHeading: "Track and analyze your asset management operations",
  };

  return data({
    header,
    reports: REPORTS,
    reportsByCategory,
    categories: REPORT_CATEGORIES,
  });
}

export default function ReportsIndex() {
  const { reportsByCategory, categories } = useLoaderData<typeof loader>();

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

function ReportCard({ report }: { report: ReportDefinition }) {
  // Dynamically get the icon from Lucide
  const IconComponent =
    (
      LucideIcons as unknown as Record<
        string,
        React.ComponentType<{ className?: string }>
      >
    )[report.icon] || LucideIcons.FileText;

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
        <IconComponent className="size-5" />
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
          <LucideIcons.ArrowRight className="size-4 text-gray-400" />
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
