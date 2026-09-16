/**
 * CSV export for the report builder.
 *
 * Runs the same spec, filters and period as the builder page (the client
 * forwards the page's full query string) and returns one row per group with
 * every measure the data set computes plus the share of the chosen measure.
 *
 * Gate: `reports: export` plus the Advanced Reports flag; a workspace without
 * the add-on gets a 403.
 *
 * @see {@link file://./reports.builder.tsx}
 * @see {@link file://../../modules/reports/builder/compile.server.ts}
 */

import { data, type LoaderFunctionArgs } from "react-router";

import { runBuilderReport } from "~/modules/reports/builder/compile.server";
import {
  BUILDER_REPORT_DEF,
  DATASET_MEASURES,
  GROUP_BY_LABELS,
  MEASURE_FORMAT,
  MEASURE_LABELS,
  parseBuilderSpec,
} from "~/modules/reports/builder/spec";
import { buildCsv } from "~/modules/reports/csv-format";
import {
  loadReportFilterOptions,
  resolveReportFilters,
} from "~/modules/reports/filters.server";
import { resolveTimeframe } from "~/modules/reports/timeframe";
import type { TimeframePreset } from "~/modules/reports/types";
import { getClientHint } from "~/utils/client-hints";
import { csvResponse } from "~/utils/csv-utf8";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError } from "~/utils/error";
import { error, getCurrentSearchParams } from "~/utils/http.server";
import { validateAdvancedReportsEnabled } from "~/utils/permissions/advanced-reports.validator.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Builds the custom report described by the query string as a CSV download.
 *
 * @returns The CSV as an attachment, or the failure with its status
 */
export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.reports,
      action: PermissionAction.export,
    });
    validateAdvancedReportsEnabled(currentOrganization, { userId });

    const searchParams = getCurrentSearchParams(request);
    const spec = parseBuilderSpec(searchParams);

    const timeframePreset =
      (searchParams.get("timeframe") as TimeframePreset) || "last_30d";
    const customFrom = searchParams.get("from");
    const customTo = searchParams.get("to");

    const [formatPrefs, reportFilters, filterOptions] = await Promise.all([
      resolveUserFormatPrefsById(userId, getClientHint(request)),
      resolveReportFilters({
        organizationId,
        searchParams,
        reportDef: BUILDER_REPORT_DEF,
      }),
      loadReportFilterOptions({
        organizationId,
        reportDef: BUILDER_REPORT_DEF,
      }),
    ]);

    const timeframe = resolveTimeframe(
      timeframePreset,
      customFrom ? new Date(customFrom) : undefined,
      customTo ? new Date(customTo) : undefined,
      formatPrefs
    );

    const customField =
      spec.groupBy === "customField" && spec.customFieldId
        ? filterOptions.customFields.find((f) => f.id === spec.customFieldId) ??
          null
        : null;

    const result = await runBuilderReport({
      organizationId,
      spec,
      timeframe,
      timeZone: formatPrefs.timeZone,
      assetFilter: reportFilters.assetFilter,
      currency: currentOrganization.currency,
      customField: customField
        ? { id: customField.id, name: customField.name }
        : null,
    });

    const measures = DATASET_MEASURES[result.spec.dataset];
    const groupLabel =
      result.spec.groupBy === "customField" && customField
        ? customField.name
        : GROUP_BY_LABELS[result.spec.groupBy];

    const headers = [
      groupLabel,
      ...measures.map((m) => MEASURE_LABELS[m]),
      `Share of ${MEASURE_LABELS[result.spec.measure]} (%)`,
    ];
    const rows = result.rows.map((row) => [
      row.groupName,
      ...measures.map((m) => formatMeasureForCsv(row.measures[m] ?? 0, m)),
      row.share === null ? "" : row.share.toString(),
    ]);

    const fileName = params.fileName || "custom-report";
    return csvResponse(buildCsv(headers, rows), {
      headers: {
        "content-disposition": `attachment; filename="${fileName}.csv"`,
        "cache-control": "no-cache",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};

/** Numbers stay bare so a spreadsheet can sum them; durations round to one decimal. */
function formatMeasureForCsv(
  value: number,
  measure: keyof typeof MEASURE_FORMAT
): string {
  if (MEASURE_FORMAT[measure] === "duration") {
    return (Math.round(value * 10) / 10).toString();
  }
  if (MEASURE_FORMAT[measure] === "currency") {
    return (Math.round(value * 100) / 100).toString();
  }
  return Math.round(value).toString();
}
