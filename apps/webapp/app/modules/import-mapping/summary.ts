/**
 * Import mapping: what an import will bring in, for the line under the review
 * table.
 *
 * Computed from the mapping alone, so it follows every change in the
 * dropdowns without another round trip. New categories, locations and the
 * rest are named once, by the preview that follows
 * (`findMissingImportEntities`), never estimated here.
 *
 * Pure and client-safe.
 *
 * @see {@link file://./../../components/assets/import-mapping/mapping-review.tsx}
 * @see {@link file://./../asset-import/missing-entities.server.ts}
 */
import type { ColumnMapping } from "./types";
import { customFieldNameKey } from "./types";

/** What the confirmed mapping will import and create. */
export type MappingSummary = {
  /** Data rows in the file. */
  rows: number;
  /**
   * Whether fewer than `rows` assets may be imported. The upload already drops
   * blank rows, so a row can only empty out when a column is skipped: rows
   * whose only values sit in skipped columns are left out (see `applyMapping`).
   */
  rowsMayDrop: boolean;
  /** Names of custom fields the workspace does not have yet. */
  newCustomFields: string[];
};

/**
 * Summarises a mapping for the line under the review table.
 *
 * @param args.columns - The mapping as currently edited
 * @param args.rowCount - Data rows in the file
 * @param args.existingCustomFieldNames - The workspace's custom field names
 * @returns Rows to import and the custom fields that will be created
 */
export function summarizeMapping({
  columns,
  rowCount,
  existingCustomFieldNames,
}: {
  columns: ColumnMapping[];
  rowCount: number;
  existingCustomFieldNames: string[];
}): MappingSummary {
  const existing = new Set(existingCustomFieldNames.map(customFieldNameKey));
  return {
    rows: rowCount,
    rowsMayDrop: columns.some(({ target }) => target.kind === "skip"),
    newCustomFields: columns.flatMap(({ target }) =>
      target.kind === "customField" &&
      !existing.has(customFieldNameKey(target.name))
        ? [target.name.trim()]
        : []
    ),
  };
}
