/**
 * Result of a custom report: three KPIs, a bar chart of the largest groups,
 * and a table with one row per group carrying every measure the data set
 * computes. Reuses the fixed reports' primitives so the builder reads like
 * the rest of Reports.
 *
 * Column definitions are memoised on the spec: they close over the chosen
 * data set and measure, and TanStack treats a new column array as a new
 * table (see `.claude/rules/react-render-stability.md`).
 *
 * @see {@link file://../../../modules/reports/builder/compile.server.ts}
 * @see {@link file://../../../routes/_layout+/reports.builder.tsx}
 */

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { BarChart } from "~/components/reports/bar-chart";
import { ChartCard } from "~/components/reports/chart-card";
import { KpiGrid } from "~/components/reports/kpi-grid";
import { ReportEmptyState } from "~/components/reports/report-empty-state";
import { NumberCell, ReportTable } from "~/components/reports/report-table";
import {
  BUILDER_MAX_GROUPS,
  DATASET_MEASURES,
  GROUP_BY_LABELS,
  MEASURE_FORMAT,
  MEASURE_LABELS,
  type BuilderMeasure,
  type BuilderRow,
  type BuilderSpec,
} from "~/modules/reports/builder/spec";
import type { ChartSeries, ReportKpi } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

/** Props for {@link BuilderResults}. */
type Props = {
  spec: BuilderSpec;
  /** Display name of the custom field when grouping by one. */
  customFieldName: string | null;
  rows: BuilderRow[];
  kpis: ReportKpi[];
  chartSeries: ChartSeries[];
  totalGroups: number;
  truncated: boolean;
  onClearFilters?: () => void;
};

/** Duration measures render as days with one decimal. */
function DaysCell({ value }: { value: number }) {
  return (
    <span className="tabular-nums">
      {(Math.round(value * 10) / 10).toLocaleString()} days
    </span>
  );
}

/** Cell for one measure, formatted per the measure's kind. */
function MeasureCell({
  measure,
  value,
}: {
  measure: BuilderMeasure;
  value: number;
}) {
  const format = MEASURE_FORMAT[measure];
  if (format === "duration") return <DaysCell value={value} />;
  return (
    <NumberCell
      value={value}
      format={format === "currency" ? "currency" : "number"}
    />
  );
}

/** Share-of-total cell with a brand-coloured bar; width shows magnitude. */
function ShareCell({ share }: { share: number | null }) {
  if (share === null) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-primary-500"
          style={{ width: `${Math.min(100, share)}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums text-gray-900">
        {share}%
      </span>
    </div>
  );
}

/** Renders KPIs, chart and table for one run; an empty state when no group matched. */
export function BuilderResults({
  spec,
  customFieldName,
  rows,
  kpis,
  chartSeries,
  totalGroups,
  truncated,
  onClearFilters,
}: Props) {
  const groupLabel =
    spec.groupBy === "customField" && customFieldName
      ? customFieldName
      : GROUP_BY_LABELS[spec.groupBy];

  const columns = useMemo<ColumnDef<BuilderRow, unknown>[]>(() => {
    const measureColumns = DATASET_MEASURES[spec.dataset].map(
      (measure): ColumnDef<BuilderRow, unknown> => ({
        id: measure,
        accessorFn: (row) => row.measures[measure] ?? 0,
        header: MEASURE_LABELS[measure],
        cell: ({ row }) => (
          <MeasureCell
            measure={measure}
            value={row.original.measures[measure] ?? 0}
          />
        ),
      })
    );
    return [
      {
        accessorKey: "groupName",
        header: groupLabel,
        cell: ({ row }) => (
          <span
            className={tw(
              "font-medium",
              row.original.id === "none" ? "text-gray-500" : "text-gray-900"
            )}
          >
            {row.original.groupName}
          </span>
        ),
      },
      ...measureColumns,
      {
        id: "share",
        accessorKey: "share",
        header: `Share of ${MEASURE_LABELS[spec.measure].toLowerCase()}`,
        cell: ({ row }) => <ShareCell share={row.original.share} />,
      },
    ];
  }, [spec.dataset, spec.measure, groupLabel]);

  if (rows.length === 0) {
    return (
      <div className="rounded border border-gray-200 bg-white">
        <ReportEmptyState
          reason="no_results"
          title="Nothing to count"
          description="No data matches this combination of data set, period and filters. Widen the period or remove a filter."
          onClearFilters={onClearFilters}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <KpiGrid kpis={kpis} columns={3} />

      {chartSeries.length > 0 && chartSeries[0].data.length > 1 ? (
        <ChartCard
          title={`${
            MEASURE_LABELS[spec.measure]
          } by ${groupLabel.toLowerCase()}`}
          subtitle={
            rows.length > chartSeries[0].data.length
              ? `Largest ${
                  chartSeries[0].data.length - 1
                } groups; the rest are "Other"`
              : undefined
          }
        >
          <div className="h-64">
            <BarChart
              series={chartSeries}
              radius={4}
              tooltipFormatter={(value) =>
                MEASURE_FORMAT[spec.measure] === "duration"
                  ? `${value} days`
                  : `${value.toLocaleString()}`
              }
            />
          </div>
        </ChartCard>
      ) : null}

      <div className="rounded border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            By {groupLabel.toLowerCase()}
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalGroups.toLocaleString()}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          initialSorting={[{ id: spec.measure, desc: true }]}
        />
        {truncated ? (
          <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500 md:px-6">
            Showing the {BUILDER_MAX_GROUPS.toLocaleString()} largest groups of{" "}
            {totalGroups.toLocaleString()}. Add a filter to narrow the result.
          </p>
        ) : null}
      </div>
    </div>
  );
}
