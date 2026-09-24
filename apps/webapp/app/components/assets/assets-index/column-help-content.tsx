/**
 * Column help content, the body of an assets-index header tooltip.
 *
 * Renders the structured help from `COLUMN_HELP` so a definition is SHOWN
 * rather than described: `Available` renders as the subtraction it actually is,
 * `Stock status` renders the real badges beside their rules. Someone reading
 * the Stock status tooltip sees the same pills they will see in the column,
 * which is the whole point, a legend made of words about colours would make
 * them do the mapping themselves.
 *
 * Every block is optional, so a column can have a one-line summary and nothing
 * else without this component rendering empty scaffolding.
 *
 * @see {@link file://../../../modules/asset-index-settings/column-help.ts} - the content.
 * @see {@link file://./advanced-table-header.tsx} - mounts this in a tooltip.
 */

import { StockStatusBadge } from "~/components/assets/stock-status-badge";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import type { ColumnHelp } from "~/modules/asset-index-settings/column-help";

/**
 * Renders one column's help.
 *
 * @param props.help - The structured help for the column.
 * @returns The tooltip body.
 */
export function ColumnHelpContent({ help }: { help: ColumnHelp }) {
  return (
    <div className="flex max-w-xs flex-col gap-2.5 text-left">
      <p className="text-sm font-medium text-gray-900">{help.summary}</p>

      {help.formula ? (
        <div className="rounded border border-gray-200 bg-gray-50 p-2">
          {help.formula.map((row) => (
            <div
              key={row.label}
              className={
                // The result sits under a rule so the stack reads as a sum
                // rather than a list. Operators get their own fixed-width
                // gutter so the labels stay left-aligned down the column.
                row.isResult
                  ? "mt-1 flex items-center gap-1.5 border-t border-gray-300 pt-1"
                  : "flex items-center gap-1.5"
              }
            >
              <span className="w-2 shrink-0 text-xs text-gray-400">
                {row.op ?? ""}
              </span>
              <span
                className={
                  row.isResult
                    ? "text-xs font-semibold text-gray-900"
                    : "text-xs text-gray-600"
                }
              >
                {row.label}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {help.legend ? (
        <div className="flex flex-col gap-1.5">
          {help.legend.map((row) => (
            <div
              key={row.status ?? "none"}
              className="flex items-start gap-2 text-xs"
            >
              {/* Fixed-width so the rules line up regardless of label length,
                  and the reader scans one column of badges, not a ragged edge. */}
              <span className="w-[104px] shrink-0">
                {row.status ? (
                  <StockStatusBadge status={row.status} />
                ) : (
                  // NOT StockStatusBadge here: its empty state carries the
                  // "No data" screen-reader label, which a legend row that
                  // already explains the blank would repeat. The glyph is the
                  // same one the column shows.
                  <EmptyTableValue
                    label=""
                    className="font-semibold"
                    aria-hidden="true"
                  />
                )}
              </span>
              <span className="pt-0.5 text-gray-600">{row.text}</span>
            </div>
          ))}
        </div>
      ) : null}

      {help.note ? (
        <p className="border-l-2 border-gray-200 pl-2 text-xs text-gray-500">
          {help.note}
        </p>
      ) : null}

      {help.blankWhen ? (
        <p className="flex items-start gap-1.5 text-xs text-gray-500">
          <EmptyTableValue
            label=""
            className="shrink-0 font-semibold"
            aria-hidden="true"
          />
          <span>{help.blankWhen}</span>
        </p>
      ) : null}
    </div>
  );
}
