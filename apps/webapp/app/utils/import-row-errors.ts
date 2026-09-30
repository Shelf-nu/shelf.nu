/**
 * Import row errors
 *
 * The shape every CSV import uses to report what is wrong with an uploaded
 * file, one entry per problem, so a file is validated in full and refused as a
 * whole before anything is written. Shared by the asset and user imports and
 * by the table that lists the problems back to the user.
 *
 * Dependency-free so both the server-side validators and the import dialogs
 * can import it.
 *
 * @see {@link file://./../modules/asset/import-preflight.server.ts}
 * @see {@link file://./../modules/invite/import-users-preflight.server.ts}
 * @see {@link file://./../components/shared/import-row-errors-table.tsx}
 */

/**
 * The most row errors listed back to the browser. A file where every row is
 * wrong would otherwise produce a response measured in megabytes, so the list
 * is truncated and {@link ImportPreflightResult.totalErrors} carries how many
 * there really were.
 */
export const MAX_REPORTED_ROW_ERRORS = 100;

/**
 * One problem found in one row.
 *
 * `row` is the line number as the user's spreadsheet shows it (see
 * {@link spreadsheetRowNumber}). A `row` of 0 marks a whole-file problem that
 * belongs to no single line, such as the row cap.
 */
export type ImportRowError = {
  row: number;
  title: string;
  message: string;
};

/**
 * The outcome of a pre-flight pass.
 *
 * `errors` is truncated to {@link MAX_REPORTED_ROW_ERRORS} so the response
 * stays a sane size; `totalErrors` counts every problem found. The two differ
 * exactly when a file had more problems than are listed, which is what lets an
 * import dialog say "showing the first 100 of 412".
 */
export type ImportPreflightResult = {
  errors: ImportRowError[];
  totalErrors: number;
};

/**
 * The spreadsheet row a data row sits on.
 *
 * The header occupies row 1 and spreadsheets count from 1, so the first data
 * row (index 0) is row 2.
 *
 * @param dataIndex - The row's 0-based index among the data rows
 * @returns The row number the user sees in their spreadsheet
 */
export function spreadsheetRowNumber(dataIndex: number): number {
  return dataIndex + 2;
}

/**
 * Narrows an import error's `additionalData` to the row errors it carries.
 *
 * `additionalData` crosses the network as an untyped value, so its members
 * cannot be rendered until they have been checked here.
 *
 * @param additionalData - The `error.additionalData` of an import response
 * @returns The listed row errors and the total found, or nulls when absent
 */
export function readImportRowErrors(additionalData: unknown): {
  rowErrors: ImportRowError[] | null;
  totalRowErrors: number | null;
} {
  const data =
    additionalData && typeof additionalData === "object"
      ? (additionalData as { rowErrors?: unknown; totalErrors?: unknown })
      : {};

  return {
    rowErrors: Array.isArray(data.rowErrors)
      ? (data.rowErrors as ImportRowError[])
      : null,
    totalRowErrors:
      typeof data.totalErrors === "number" ? data.totalErrors : null,
  };
}
