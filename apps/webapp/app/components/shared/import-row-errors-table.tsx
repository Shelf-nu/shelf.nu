/**
 * Import Row Errors Table
 *
 * Lists the problems a CSV import found in an uploaded file, one line per
 * problem with the spreadsheet row it is on, so the user can fix the file and
 * upload it again. Shared by the asset and user import dialogs, which both
 * refuse a file as a whole when any row is wrong.
 *
 * @see {@link file://./../../utils/import-row-errors.ts}
 */
import type { ImportRowError } from "~/utils/import-row-errors";
import When from "../when/when";

/** Props for {@link ImportRowErrorsTable}. */
type ImportRowErrorsTableProps = {
  /** The problems listed back by the server, possibly truncated. */
  rowErrors: ImportRowError[];
  /** How many problems the file really had, when more were found than sent. */
  totalRowErrors: number | null;
};

/**
 * Renders an import's row errors as a Row / Problem table, noting when the
 * list is truncated.
 *
 * @param props - The row errors and the total found
 */
export function ImportRowErrorsTable({
  rowErrors,
  totalRowErrors,
}: ImportRowErrorsTableProps) {
  return (
    <>
      <table className="mt-4 w-full rounded-md border text-left text-sm">
        <thead className="bg-error-100 text-xs">
          <tr>
            <th scope="col" className="px-2 py-1">
              Row
            </th>
            <th scope="col" className="px-2 py-1">
              Problem
            </th>
          </tr>
        </thead>
        <tbody>
          {rowErrors.map((rowError) => (
            <tr
              // One row can carry more than one problem, so the row number
              // alone is not a unique key.
              key={`${rowError.row}-${rowError.message}`}
            >
              <td className="px-2 py-1">
                {rowError.row > 0 ? rowError.row : "File"}
              </td>
              <td className="px-2 py-1">{rowError.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <When
        truthy={totalRowErrors !== null && totalRowErrors > rowErrors.length}
      >
        <p className="mt-2 text-sm text-gray-600">
          Showing the first {rowErrors.length} of {totalRowErrors} problems. Fix
          these and upload again to see the rest.
        </p>
      </When>
    </>
  );
}
