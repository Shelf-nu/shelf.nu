/**
 * Report builder page (Advanced Reports add-on).
 *
 * Reads the spec (data set, group by, measure) and the shared report filters
 * from the URL, runs the grouped query, and renders KPIs, chart and table.
 * Everything is URL state, so a built report is a link and the CSV export
 * reads the same query string.
 *
 * Gate: the `reports` permission (Owners and Admins) plus the workspace's
 * Advanced Reports flag. A workspace without the add-on gets the locked card
 * rather than a 403, so the page can say what the builder is and who to ask.
 *
 * @see {@link file://../../modules/reports/builder/spec.ts}
 * @see {@link file://../../modules/reports/builder/compile.server.ts}
 * @see {@link file://./reports.builder.export.$fileName[.csv].tsx}
 */

import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData, useNavigation } from "react-router";

import Header from "~/components/layout/header";
import { ReportFilterBar, ReportFooter } from "~/components/reports";
import { AdvancedReportsLocked } from "~/components/reports/builder/advanced-reports-locked";
import { BuilderBar } from "~/components/reports/builder/builder-bar";
import { BuilderResults } from "~/components/reports/builder/builder-results";
import { clearReportFilterParams } from "~/components/reports/filters/search-param-utils";
import { useCsvExport } from "~/components/reports/use-csv-export";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { runBuilderReport } from "~/modules/reports/builder/compile.server";
import {
  BUILDER_REPORT_DEF,
  datasetUsesTimeframe,
  parseBuilderSpec,
} from "~/modules/reports/builder/spec";
import {
  loadReportFilterOptions,
  resolveReportFilters,
} from "~/modules/reports/filters.server";
import {
  isTimeframePreset,
  resolveTimeframe,
} from "~/modules/reports/timeframe";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { SUPPORT_EMAIL } from "~/utils/env";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { canUseAdvancedReports } from "~/utils/subscription.server";
import { tw } from "~/utils/tw";

/** Browser tab title for the builder page. */
export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Report builder") },
];

/** Adds "Report builder" under the "Reports" crumb supplied by `reports.tsx`. */
export const handle = {
  breadcrumb: () => "Report builder",
};

/** Header shown in both the locked and the working state. */
const HEADER = {
  title: "Report builder",
  subHeading: BUILDER_REPORT_DEF.description,
};

/**
 * Runs the custom report described by the query string.
 *
 * @returns The locked marker when the workspace lacks the add-on; otherwise
 *   the result plus everything the builder bar and filter bar render from
 * @throws {ShelfError} 403 when the caller lacks `reports: read`
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { organizationId, currentOrganization, role } = await requirePermission(
    {
      userId,
      request,
      entity: PermissionEntity.reports,
      action: PermissionAction.read,
    }
  );

  if (!canUseAdvancedReports(currentOrganization)) {
    return data({
      locked: true as const,
      isOwner: role === "OWNER",
      header: HEADER,
      supportEmail: SUPPORT_EMAIL,
    });
  }

  const url = new URL(request.url);
  const requestedSpec = parseBuilderSpec(url.searchParams);

  // An unknown preset falls back to the default *with* the user's format
  // preferences; the resolver's own fallback would use UTC boundaries.
  const rawPreset = url.searchParams.get("timeframe");
  const timeframePreset = isTimeframePreset(rawPreset) ? rawPreset : "last_30d";
  const customFrom = url.searchParams.get("from");
  const customTo = url.searchParams.get("to");

  const [formatPrefs, reportFilters, filterOptions] = await Promise.all([
    resolveUserFormatPrefsById(userId, getClientHint(request)),
    resolveReportFilters({
      organizationId,
      searchParams: url.searchParams,
      reportDef: BUILDER_REPORT_DEF,
    }),
    loadReportFilterOptions({ organizationId, reportDef: BUILDER_REPORT_DEF }),
  ]);

  const timeframe = resolveTimeframe(
    timeframePreset,
    customFrom ? new Date(customFrom) : undefined,
    customTo ? new Date(customTo) : undefined,
    formatPrefs
  );

  // The pick-list already holds the workspace's filterable custom fields, so
  // a grouping field is verified against it: an id from elsewhere resolves to
  // nothing and the run falls back to the data set's first grouping.
  const customField =
    requestedSpec.groupBy === "customField" && requestedSpec.customFieldId
      ? filterOptions.customFields.find(
          (f) => f.id === requestedSpec.customFieldId
        ) ?? null
      : null;

  const result = await runBuilderReport({
    organizationId,
    spec: requestedSpec,
    timeframe,
    timeZone: formatPrefs.timeZone,
    assetFilter: reportFilters.assetFilter,
    currency: currentOrganization.currency,
    customField: customField
      ? { id: customField.id, name: customField.name }
      : null,
  });

  return data({
    locked: false as const,
    isOwner: role === "OWNER",
    header: HEADER,
    spec: result.spec,
    customFieldName: customField?.name ?? null,
    rows: result.rows,
    kpis: result.kpis,
    chartSeries: result.chartSeries,
    totalGroups: result.totalGroups,
    truncated: result.truncated,
    computedMs: result.computedMs,
    timeframe,
    currency: currentOrganization.currency,
    // Filter bar inputs; the paged pick-lists are spread onto the top level
    // because the shared `DynamicDropdown` reads them from loader data by key.
    ...filterOptions,
    filterOptions,
    filterConfigs: BUILDER_REPORT_DEF.filters,
    activeFilters: reportFilters.active,
  });
}

/** The builder page: locked card, or bar + filters + results. */
export default function ReportBuilderPage() {
  const loaderData = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isLoading = navigation.state === "loading";

  const { isExporting, handleExport } = useCsvExport(
    "builder",
    loaderData.locked ? "current" : loaderData.timeframe.preset,
    "/reports/builder/export"
  );

  if (loaderData.locked) {
    return (
      <>
        <Header />
        <div className="px-4 pb-4 md:mt-4 md:px-0">
          <AdvancedReportsLocked
            isOwner={loaderData.isOwner}
            supportEmail={loaderData.supportEmail}
          />
        </div>
      </>
    );
  }

  const {
    spec,
    customFieldName,
    rows,
    kpis,
    chartSeries,
    totalGroups,
    truncated,
    computedMs,
    timeframe,
    currency,
    filterOptions,
    filterConfigs,
    activeFilters,
  } = loaderData;

  const clearFilters = () =>
    setSearchParams(clearReportFilterParams(searchParams), { replace: true });

  return (
    <>
      <Header>
        <Button
          type="button"
          variant="secondary"
          onClick={handleExport}
          disabled={isExporting || rows.length === 0}
        >
          {isExporting ? "Exporting..." : "Export CSV"}
        </Button>
      </Header>

      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 md:mt-4 md:px-0">
        <BuilderBar
          spec={spec}
          customFields={filterOptions.customFields}
          disabled={isLoading}
        />

        <ReportFilterBar
          reportId={BUILDER_REPORT_DEF.id}
          timeframe={timeframe}
          isLoading={isLoading}
          filterConfigs={filterConfigs}
          activeFilters={activeFilters}
          filterOptions={filterOptions}
          timeframeVisible={datasetUsesTimeframe(spec.dataset)}
        />

        <div className={tw("transition-opacity", isLoading && "opacity-60")}>
          <BuilderResults
            spec={spec}
            customFieldName={customFieldName}
            rows={rows}
            kpis={kpis}
            chartSeries={chartSeries}
            totalGroups={totalGroups}
            truncated={truncated}
            currency={currency}
            onClearFilters={activeFilters.length > 0 ? clearFilters : undefined}
          />
        </div>

        <div className="rounded border border-gray-200 bg-white px-4 py-2">
          <ReportFooter
            computedMs={computedMs}
            totalRows={rows.length}
            page={1}
            pageSize={Math.max(rows.length, 1)}
            hideRowCount
          />
        </div>
      </div>
    </>
  );
}
