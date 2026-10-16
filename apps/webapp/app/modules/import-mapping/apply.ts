/**
 * Import mapping: turns a reviewed mapping into importer-ready CSV data.
 *
 * Renames each kept column to its Shelf header and drops skipped columns.
 * Cell values are copied untouched, so `extractCSVDataFromContentImport` and
 * `createAssetsFromContentImport` run exactly as for a hand-made template and
 * enforce every rule they always enforce.
 *
 * Pure: no database, no I/O.
 *
 * @see {@link file://./../../routes/_layout+/assets.import.tsx} the caller
 */
import { ShelfError } from "~/utils/error";
import type { ColumnMapping } from "./types";
import { findDuplicateTargets, headerForTarget } from "./types";

/**
 * Applies a mapping to parsed CSV data.
 *
 * The mapping is matched to the file by position, and each entry's `source`
 * must equal that column's trimmed header. Matching by position keeps two
 * columns with the same heading apart; checking the heading refuses a
 * mapping that was made for a different file.
 *
 * @param csvData - Parsed CSV, header row first
 * @param columns - One mapping per column, in file order
 * @returns A new table with renamed headers and without skipped columns
 * @throws {ShelfError} 400 when the mapping does not fit the file, two
 *   columns share a destination, or every column is skipped
 */
export function applyMapping(
  csvData: string[][],
  columns: ColumnMapping[]
): string[][] {
  const headers = (csvData[0] ?? []).map((header) => header.trim());

  const fitsFile =
    headers.length === columns.length &&
    columns.every((column, index) => column.source === headers[index]);
  if (!fitsFile) {
    throw new ShelfError({
      cause: null,
      title: "Mapping does not match the file",
      message:
        "The column mapping does not match the columns of this file. Pick the file again to get a fresh mapping.",
      additionalData: { fileColumns: headers.length, mapped: columns.length },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const duplicates = findDuplicateTargets(columns);
  if (duplicates.size > 0) {
    const clashes = [...duplicates.values()].map((indexes) =>
      indexes.map((index) => `"${columns[index].source}"`).join(" and ")
    );
    throw new ShelfError({
      cause: null,
      title: "Two columns share one Shelf field",
      message: `Each Shelf field can take one column only. Change the mapping for ${clashes.join(
        "; "
      )}.`,
      additionalData: { duplicateColumns: clashes },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const kept = columns.flatMap((column, index) =>
    column.target.kind === "skip"
      ? []
      : [{ index, header: headerForTarget(column.target) }]
  );
  if (kept.length === 0) {
    throw new ShelfError({
      cause: null,
      title: "Nothing to import",
      message:
        "Every column is set to Skip. Map at least one column to a Shelf field.",
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return [
    kept.map(({ header }) => header),
    ...csvData.slice(1).map((row) => kept.map(({ index }) => row[index] ?? "")),
  ];
}
