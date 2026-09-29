/**
 * @file Stock Movement report content.
 *
 * Renders the "Stock Movement" report: a hero summarising what moved over the
 * period, followed by a per-asset statement table. Used by
 * `ReportContentSwitch` for the `stock-movement` report.
 *
 * Column order follows the statement the numbers describe — opening, what came
 * in, what went out, what remains — so a reader can follow the arithmetic left
 * to right and see that each row adds up.
 *
 * @see {@link file://./../../modules/reports/stock-movement.server.ts}
 */

import type { ColumnDef } from "@tanstack/react-table";

import { ReportTable } from "~/components/reports/report-table";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import type { ReportKpi, StockMovementRow } from "~/modules/reports/types";
import { useHints } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";
import { tw } from "~/utils/tw";

/**
 * A right-aligned count. `tabular-nums` keeps the columns readable as a
 * statement rather than ragged text.
 */
function CountCell({
  value,
  muted = false,
}: {
  value: number;
  muted?: boolean;
}) {
  return (
    <span
      className={tw(
        "block text-right tabular-nums",
        muted && value === 0 ? "text-gray-400" : "text-gray-900"
      )}
    >
      {value.toLocaleString()}
    </span>
  );
}

/**
 * The adjustment figure is the only signed column, so it renders its sign
 * explicitly. A reader scanning the row needs to see at a glance whether a
 * correction added or removed stock.
 */
function AdjustmentCell({ value }: { value: number }) {
  if (value === 0) {
    return <span className="block text-right tabular-nums text-gray-400">0</span>;
  }

  return (
    <span className="block text-right tabular-nums text-gray-900">
      {value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString()}
    </span>
  );
}

/**
 * Columns are hoisted to module scope so their identity is stable across
 * renders — see `.claude/rules/react-render-stability.md`.
 */
const COLUMNS: ColumnDef<StockMovementRow>[] = [
  {
    accessorKey: "assetName",
    header: "Item",
    /**
     * Plain name + category rather than `AssetCell`. `AssetCell` renders a
     * thumbnail, which would mean carrying image URLs through the report and
     * re-signing expired Supabase links the way the inventory report does.
     * Deliberately out of scope for v1 of this report; the statement is about
     * numbers, and the asset page is one click away.
     */
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium text-gray-900">
          {row.original.assetName}
        </span>
        {row.original.category ? (
          <span className="text-xs text-gray-500">{row.original.category}</span>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "opening",
    header: () => <span className="block text-right">Opening</span>,
    cell: ({ row }) => <CountCell value={row.original.opening} />,
  },
  {
    accessorKey: "restocked",
    header: () => <span className="block text-right">Restocked</span>,
    cell: ({ row }) => <CountCell value={row.original.restocked} muted />,
  },
  {
    accessorKey: "consumed",
    header: () => <span className="block text-right">Consumed</span>,
    cell: ({ row }) => <CountCell value={row.original.consumed} muted />,
  },
  {
    accessorKey: "lost",
    header: () => <span className="block text-right">Lost</span>,
    cell: ({ row }) => <CountCell value={row.original.lost} muted />,
  },
  {
    accessorKey: "damaged",
    header: () => <span className="block text-right">Damaged</span>,
    cell: ({ row }) => <CountCell value={row.original.damaged} muted />,
  },
  {
    accessorKey: "adjustments",
    header: () => <span className="block text-right">Adjustments</span>,
    cell: ({ row }) => <AdjustmentCell value={row.original.adjustments} />,
  },
  {
    accessorKey: "closing",
    header: () => <span className="block text-right">Closing</span>,
    cell: ({ row }) => (
      <span className="block text-right font-semibold tabular-nums text-gray-900">
        {row.original.closing.toLocaleString()}
        {row.original.unitOfMeasure ? (
          <span className="ml-1 text-xs font-normal text-gray-500">
            {row.original.unitOfMeasure}
          </span>
        ) : null}
      </span>
    ),
  },
];

/** Props for {@link StockMovementContent}. */
interface Props {
  rows: StockMovementRow[];
  kpis: ReportKpi[];
  totalRows: number;
  timeframeLabel: string;
  onRowClick?: (row: StockMovementRow) => void;
}

/**
 * Renders the Stock Movement report.
 *
 * @param rows - One statement line per quantity-tracked asset
 * @param kpis - Pre-aggregated period totals
 * @param totalRows - Total row count across all pages
 * @param timeframeLabel - Human-readable period, shown in the hero
 * @param onRowClick - Optional row navigation handler
 */
export function StockMovementContent({
  rows,
  kpis,
  totalRows,
  timeframeLabel,
  onRowClick,
}: Props) {
  const currentOrganization = useCurrentOrganization();
  const { locale } = useHints();

  const consumed = kpis.find((kpi) => kpi.id === "total_consumed");
  const restocked = kpis.find((kpi) => kpi.id === "total_restocked");
  const shrinkage = kpis.find((kpi) => kpi.id === "total_shrinkage");
  const closingValue = kpis.find((kpi) => kpi.id === "closing_value");

  const closingValueDisplay =
    currentOrganization && closingValue?.rawValue !== undefined
      ? formatCurrency({
          value: closingValue.rawValue,
          locale,
          currency: currentOrganization.currency,
        })
      : (closingValue?.value ?? "—");

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-gray-200 bg-white">
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:p-6">
          <div className="flex items-center gap-4">
            {/* Neutral count: consumption is the point of the report, not a
                problem indicator, so no judgment colour. */}
            <span className="text-3xl font-semibold text-gray-900">
              {consumed?.value ?? "0"}
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-700">
                Units consumed
              </span>
              <span className="text-xs text-gray-500">{timeframeLabel}</span>
            </div>
          </div>

          <div className="flex gap-6 border-t border-gray-100 pt-3 md:border-l md:border-t-0 md:pl-6 md:pt-0">
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Restocked</span>
              <span className="text-lg font-medium text-gray-900">
                {restocked?.value ?? "0"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Lost or damaged</span>
              <span className="text-lg font-medium text-gray-900">
                {shrinkage?.value ?? "0"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-gray-500">Closing value</span>
              <span className="text-lg font-medium text-gray-900">
                {closingValueDisplay}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Movement by item
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          columns={COLUMNS}
          data={rows}
          onRowClick={onRowClick}
        />
      </div>
    </div>
  );
}
