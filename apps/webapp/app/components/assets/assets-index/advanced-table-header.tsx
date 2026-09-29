/**
 * Advanced asset index, header row.
 *
 * Renders one `<Th>` per visible column, in the user's saved order. Columns
 * whose meaning is not obvious from their label carry an `InfoTooltip` sourced
 * from `COLUMN_HELP`; see that module for why only some columns get one.
 *
 * @see {@link file://../../../modules/asset-index-settings/column-help.ts}
 */

import { InfoTooltip } from "~/components/shared/info-tooltip";
import { Th } from "~/components/table";
import { getColumnHelp } from "~/modules/asset-index-settings/column-help";
import type { Column } from "~/modules/asset-index-settings/helpers";
import { parseColumnName } from "~/modules/asset-index-settings/helpers";
import { ColumnHelpContent } from "./column-help-content";

export function AdvancedTableHeader({ columns }: { columns: Column[] }) {
  return (
    <>
      {columns
        .filter((column) => column.visible)
        .map((column) => {
          const help = getColumnHelp(column.name);

          return (
            <Th
              key={column.name}
              className=" whitespace-nowrap bg-gray-25 md:border-0"
              data-column-name={column.name}
            >
              {help ? (
                // Inline-flex rather than a block so the icon sits on the text
                // baseline; the header cell is already `whitespace-nowrap`, so
                // the label and icon can never be split across lines.
                <span className="inline-flex items-center gap-1">
                  {parseColumnName(column.name)}
                  <InfoTooltip
                    content={<ColumnHelpContent help={help} />}
                    iconClassName="size-3 text-gray-400"
                    // Roomier than the default so a five-row badge legend and a
                    // stacked subtraction both fit without wrapping mid-label.
                    contentClassName="max-w-sm p-3"
                  />
                </span>
              ) : (
                parseColumnName(column.name)
              )}
            </Th>
          );
        })}
    </>
  );
}
