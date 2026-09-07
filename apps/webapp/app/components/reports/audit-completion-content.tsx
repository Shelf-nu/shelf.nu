/**
 * @file Audit Completion report content.
 *
 * Renders the Audit Completion report body: a hero with the completion rate
 * and its supporting counts, followed by a table of every audit session in
 * the timeframe. Column definitions live at module scope so cell function
 * identities stay stable across renders (see
 * `.claude/rules/react-render-stability.md`).
 *
 * Status renders through the shared `AuditStatusBadgeWithOverdue`, which
 * derives overdue-ness (due date past, session still open) as a separate red
 * chip beside the status badge — overdue is a schedule fact, not a status.
 *
 * @see {@link file://../../routes/_layout+/reports.$reportId.tsx}
 * @see {@link file://../../modules/reports/audit-completion.server.ts}
 */

import type { ColumnDef } from "@tanstack/react-table";

import { AuditStatusBadgeWithOverdue } from "~/components/audit/audit-status-badge-with-overdue";
import type { AuditCompletionRow, ReportKpi } from "~/modules/reports/types";
import { tw } from "~/utils/tw";

import { ReportEmptyState } from "./report-empty-state";
import { DateCell, NumberCell, ReportTable } from "./report-table";

/**
 * Column definitions for the Audit Completion table, declared at module
 * scope so cell function identities stay stable across renders. See
 * `.claude/rules/react-render-stability.md` for the underlying rule.
 */
const AUDIT_COMPLETION_COLUMNS: ColumnDef<AuditCompletionRow>[] = [
  {
    accessorKey: "name",
    header: "Audit",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <AuditStatusBadgeWithOverdue
        status={row.original.status}
        dueDate={row.original.dueDate}
      />
    ),
  },
  {
    accessorKey: "expectedAssetCount",
    header: "Expected",
    cell: ({ row }) => <NumberCell value={row.original.expectedAssetCount} />,
  },
  {
    accessorKey: "foundAssetCount",
    header: "Found",
    cell: ({ row }) => <NumberCell value={row.original.foundAssetCount} />,
  },
  {
    accessorKey: "missingAssetCount",
    header: "Missing",
    cell: ({ row }) => <MissingCell value={row.original.missingAssetCount} />,
  },
  {
    accessorKey: "unexpectedAssetCount",
    header: "Unexpected",
    cell: ({ row }) => <NumberCell value={row.original.unexpectedAssetCount} />,
  },
  {
    accessorKey: "accuracy",
    header: "Accuracy",
    cell: ({ row }) => <AccuracyCell accuracy={row.original.accuracy} />,
  },
  {
    accessorKey: "createdByName",
    header: "Created by",
    cell: ({ row }) => row.original.createdByName,
  },
  {
    accessorKey: "startedAt",
    header: "Started",
    cell: ({ row }) => <DateCell date={row.original.startedAt} />,
  },
  {
    accessorKey: "dueDate",
    header: "Due Date",
    cell: ({ row }) => <DateCell date={row.original.dueDate} />,
  },
  {
    accessorKey: "completedAt",
    header: "Completed",
    cell: ({ row }) => <DateCell date={row.original.completedAt} />,
  },
];

/**
 * Accuracy cell: a brand-color bar whose width is the found/expected rate,
 * next to the percentage. Brand color, no judgment — the width shows the
 * magnitude (see the progress-bar rule in `.claude/rules/reports-styling.md`).
 * Null accuracy (session expected 0 assets) renders as "—".
 *
 * @param accuracy - found/expected as a whole percentage, or null
 */
/**
 * Missing-asset count for a session. Null means the session has not
 * completed yet — the counter still measures "not scanned", so the cell
 * says that instead of branding in-progress audits as having lost assets.
 */
function MissingCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="text-xs text-gray-600">Not scanned</span>;
  }
  return <NumberCell value={value} />;
}

function AccuracyCell({ accuracy }: { accuracy: number | null }) {
  if (accuracy === null) {
    return <span className="text-gray-600">—</span>;
  }
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-primary-500"
          style={{ width: `${Math.min(accuracy, 100)}%` }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums text-gray-900">
        {accuracy}%
      </span>
    </div>
  );
}

/** Props for {@link AuditCompletionContent}. */
type Props = {
  /** Audit sessions for the current page (already paginated by the server). */
  rows: AuditCompletionRow[];
  /** KPI values driving the hero (total, completed, rate, overdue, missing). */
  kpis: ReportKpi[];
  /** Total row count, shown as a pill next to the table heading. */
  totalRows: number;
  /** Human-readable label for the selected timeframe (e.g. "Last 30 days"). */
  timeframeLabel?: string;
  /** Called when a row is clicked — navigates to the audit detail page. */
  onRowClick?: (row: AuditCompletionRow) => void;
};

/**
 * Reads a KPI's numeric value by id, defaulting to 0 when the KPI is absent
 * or carries no raw value.
 */
function kpiNumber(kpis: ReportKpi[], id: string): number {
  const raw = kpis.find((k) => k.id === id)?.rawValue;
  return typeof raw === "number" ? raw : 0;
}

/**
 * Audit Completion report body.
 *
 * Renders the completion-rate hero with its supporting counts, then the
 * session table.
 *
 * @param props - See {@link Props}.
 * @returns The rendered report content.
 */
export function AuditCompletionContent({
  rows,
  kpis,
  totalRows,
  timeframeLabel,
  onRowClick,
}: Props) {
  // The rate KPI carries no rawValue when there are no measurable sessions —
  // null here renders "—", never 0% (the null-not-zero convention).
  const rateRaw = kpis.find((k) => k.id === "completion_rate")?.rawValue;
  const completionRate = typeof rateRaw === "number" ? rateRaw : null;

  const totalAudits = kpiNumber(kpis, "total_audits");
  const completedAudits = kpiNumber(kpis, "completed_audits");
  const overdueAudits = kpiNumber(kpis, "overdue_audits");
  const assetsMissing = kpiNumber(kpis, "assets_missing");

  return (
    <div className="flex flex-col gap-4">
      {/* Hero section */}
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          {/* Main metric: completion rate with threshold colors */}
          <div className="flex items-center gap-4">
            <span
              className={tw(
                "text-3xl font-semibold",
                completionRate === null
                  ? "text-gray-900"
                  : completionRate >= 70
                  ? "text-green-600"
                  : completionRate >= 30
                  ? "text-blue-600"
                  : "text-yellow-600"
              )}
            >
              {completionRate !== null ? `${completionRate}%` : "—"}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Completion Rate
              </span>
              <span className="text-xs text-gray-500">
                {completedAudits} of {totalAudits} audit
                {totalAudits !== 1 ? "s" : ""} completed
                {timeframeLabel ? ` · ${timeframeLabel}` : ""}
              </span>
            </div>
          </div>

          {/* Supporting stats */}
          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Overdue</span>
              <span className="text-lg font-medium text-gray-900">
                {overdueAudits}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Assets Missing</span>
              <span className="text-lg font-medium text-gray-900">
                {assetsMissing}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Session table */}
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Audit Sessions
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={AUDIT_COMPLETION_COLUMNS}
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No audits found"
              description="No audit sessions were created in the selected timeframe."
            />
          }
        />
      </div>
    </div>
  );
}
