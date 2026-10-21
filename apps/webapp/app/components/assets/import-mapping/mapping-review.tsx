/**
 * @file The mapping review table of the asset importer.
 *
 * One row per spreadsheet column: its heading, a few sample values, the Shelf
 * field it will become (editable) and a dot for how sure the proposal is.
 * Duplicate destinations are flagged on every clashing row. Under the table:
 * format notes from the proposal and a line saying how many assets will be
 * imported and which custom fields will be created.
 *
 * Controlled: the parent owns the columns and receives every edit.
 *
 * @see {@link file://./../import-content/flow.tsx} the flow around it
 * @see {@link file://./../../../modules/import-mapping/types.ts}
 */
import type { CustomFieldType } from "@prisma/client";
import type { ExistingCustomField } from "~/modules/import-mapping/heuristics";
import type { MappingSummary } from "~/modules/import-mapping/summary";
import type {
  ColumnMapping,
  ColumnTarget,
} from "~/modules/import-mapping/types";
import { customFieldNameKey } from "~/modules/import-mapping/types";
import { tw } from "~/utils/tw";
import { CustomFieldTarget } from "./custom-field-target";
import { TargetSelect } from "./target-select";

/**
 * Finds the stored type of an existing custom field by name.
 *
 * @param existing - The workspace's custom fields
 * @param name - A custom field name, compared case-insensitively
 * @returns The stored type, or `undefined` when the name is new
 */
export function existingTypeFor(
  existing: ExistingCustomField[],
  name: string
): CustomFieldType | undefined {
  const key = customFieldNameKey(name);
  return existing.find((field) => customFieldNameKey(field.name) === key)?.type;
}

/** Green when sure, amber when a guess. Text is for screen readers. */
function ConfidenceDot({ confidence }: { confidence: "high" | "low" }) {
  return (
    <span className="inline-flex items-center">
      <span
        aria-hidden="true"
        className={tw(
          "inline-block size-2.5 rounded-full",
          confidence === "high" ? "bg-success-500" : "bg-warning-500"
        )}
      />
      <span className="sr-only">
        {confidence === "high" ? "Sure match" : "Guess, please check"}
      </span>
    </span>
  );
}

/** Joins names as "a, b and c". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The line under the table: rows to import and the custom fields that will
 * be created. When a skipped column can empty a row, the row count is a
 * ceiling and the line says so; the preview gives the exact count.
 *
 * @param summary - From `summarizeMapping`
 * @returns A plain sentence
 */
export function describeSummary(summary: MappingSummary): string {
  const assets = `${summary.rows} ${summary.rows === 1 ? "asset" : "assets"}`;
  const parts = summary.rowsMayDrop
    ? [
        `Up to ${assets} will be imported.`,
        "Rows with values only in skipped columns are left out.",
      ]
    : [`${assets} will be imported.`];
  if (summary.newCustomFields.length > 0) {
    parts.push(
      `New: ${
        summary.newCustomFields.length === 1 ? "custom field" : "custom fields"
      } ${listNames(summary.newCustomFields.map((name) => `"${name}"`))}.`
    );
  }
  return parts.join(" ");
}

/**
 * Renders the review table.
 *
 * @param props.columns - The mapping as currently edited, in file order
 * @param props.onChange - Called with a column index and its new target
 * @param props.duplicateRows - Indexes of rows whose destination clashes
 * @param props.existingCustomFields - The workspace's custom fields
 * @param props.canUseBarcodes - Lists barcode fields in the pickers
 * @param props.notes - Format warnings from the proposal
 * @param props.summary - Rows to import and the custom fields to create
 * @param props.alreadyMatches - Shows "already matches" above the table
 */
export function MappingReview({
  columns,
  onChange,
  duplicateRows,
  existingCustomFields,
  canUseBarcodes,
  notes,
  summary,
  alreadyMatches,
}: {
  columns: ColumnMapping[];
  onChange: (index: number, target: ColumnTarget) => void;
  duplicateRows: Set<number>;
  existingCustomFields: ExistingCustomField[];
  canUseBarcodes: boolean;
  notes: string[];
  summary: MappingSummary;
  alreadyMatches: boolean;
}) {
  return (
    <div className="mt-4">
      {alreadyMatches ? (
        <p
          role="status"
          className="mb-3 rounded border border-success-200 bg-success-25 px-4 py-2 text-[14px] text-success-700"
        >
          Your file already matches Shelf's format.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full min-w-[560px] table-fixed text-left text-[14px]">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th scope="col" className="w-1/4 px-3 py-2 font-medium">
                Your column
              </th>
              <th scope="col" className="w-1/5 px-3 py-2 font-medium">
                Sample
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Shelf field
              </th>
              <th scope="col" className="w-10 px-3 py-2 font-medium">
                <span className="sr-only">Confidence</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column, index) => {
              const rowId = `mapping-row-${index}`;
              const isDuplicate = duplicateRows.has(index);
              const existingType =
                column.target.kind === "customField"
                  ? existingTypeFor(existingCustomFields, column.target.name)
                  : undefined;
              const isNewField =
                column.target.kind === "customField" &&
                column.target.name.trim() !== "" &&
                existingType === undefined;
              return (
                <tr
                  key={rowId}
                  className={tw(
                    "border-t border-gray-200 align-top",
                    column.target.kind === "skip" && "text-gray-500"
                  )}
                >
                  <th scope="row" className="break-words px-3 py-2 font-medium">
                    {column.source || (
                      <span className="italic text-gray-500">No heading</span>
                    )}
                  </th>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="block truncate">
                      {column.sample.join(", ") || (
                        <span className="italic">Empty</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <TargetSelect
                          id={rowId}
                          source={column.source}
                          value={column.target}
                          onChange={(target) => onChange(index, target)}
                          canUseBarcodes={canUseBarcodes}
                          invalid={isDuplicate}
                          describedBy={
                            isDuplicate ? `${rowId}-duplicate` : undefined
                          }
                        />
                      </div>
                      {isNewField ? (
                        <span className="shrink-0 rounded bg-primary-50 px-1.5 py-0.5 text-xs font-medium text-primary-800">
                          New
                        </span>
                      ) : null}
                    </div>
                    {column.target.kind === "customField" ? (
                      <CustomFieldTarget
                        id={rowId}
                        value={column.target}
                        existingType={existingType}
                        onChange={(target) => onChange(index, target)}
                      />
                    ) : null}
                    {isDuplicate ? (
                      <p
                        id={`${rowId}-duplicate`}
                        className="mt-1 text-xs text-error-600"
                      >
                        Another column already goes to this field. Pick a
                        different one or Skip.
                      </p>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <ConfidenceDot confidence={column.confidence} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {notes.length > 0 ? (
        <ul className="mt-3 list-inside list-disc text-[14px] text-warning-700">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 text-[14px] text-gray-700">
        {describeSummary(summary)}
      </p>
    </div>
  );
}
