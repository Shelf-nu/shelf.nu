/**
 * Import mapping: turns a reviewed mapping into importer-ready CSV data.
 *
 * Renames each kept column to its Shelf header and drops skipped columns,
 * plus any row that only had values in them. When the user tracks a file's
 * rows as stock, it adds the `type` (and, unless mapped, `consumptionType`)
 * column that says so. Cell values are copied untouched, so
 * `extractCSVDataFromContentImport` and `createAssetsFromContentImport` run exactly as for a hand-made template and
 * enforce every rule they always enforce.
 *
 * Pure: no database, no I/O.
 *
 * @see {@link file://./../../routes/_layout+/assets.import.tsx} the caller
 */
import { ShelfError } from "~/utils/error";
import type { ColumnMapping, QuantityTracking } from "./types";
import {
  findDuplicateTargets,
  headerForTarget,
  mapsConsumptionType,
  needsQuantityTracking,
} from "./types";

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
 * @param quantityTracking - For a mapping that needs it
 *   ({@link needsQuantityTracking}): `TWO_WAY` or `ONE_WAY` tracks every row
 *   as stock with that consumption type; `INDIVIDUAL` or absent adds nothing
 * @returns A new table with renamed headers, without skipped columns and
 *   without rows left blank once those columns are gone
 * @throws {ShelfError} 400 when the mapping does not fit the file, two
 *   columns share a destination, every column is skipped, or a stock choice
 *   comes with a mapping that does not need one
 */
export function applyMapping(
  csvData: string[][],
  columns: ColumnMapping[],
  quantityTracking?: QuantityTracking
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
      additionalData: {
        fileColumns: headers.length,
        mapped: columns.length,
        failureReason: "invalid_mapping",
      },
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
      additionalData: {
        duplicateColumns: clashes,
        failureReason: "duplicate_targets",
      },
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
      additionalData: { failureReason: "invalid_mapping" },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const tracksStock =
    quantityTracking !== undefined && quantityTracking !== "INDIVIDUAL";
  if (tracksStock && !needsQuantityTracking(columns)) {
    throw new ShelfError({
      cause: null,
      title: "Quantity choice does not fit the mapping",
      message:
        "Tracking rows by quantity needs a quantity column and no type column. Check the mapping and try again.",
      additionalData: { failureReason: "invalid_mapping" },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  // The upload already drops blank rows, but a row whose only values sit in
  // skipped columns turns blank here and would fail as a row with no title.
  // Checked before the stock columns are added, which are never blank.
  const rows = csvData
    .slice(1)
    .map((row) => kept.map(({ index }) => row[index] ?? ""))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = kept.map(({ header }) => header);
  if (!tracksStock) return [header, ...rows];

  // A file that maps its own consumption types keeps them.
  const added = mapsConsumptionType(columns)
    ? [["type", "QUANTITY_TRACKED"]]
    : [
        ["type", "QUANTITY_TRACKED"],
        ["consumptionType", quantityTracking],
      ];
  return [
    [...header, ...added.map(([name]) => name)],
    ...rows.map((row) => [...row, ...added.map(([, value]) => value)]),
  ];
}
