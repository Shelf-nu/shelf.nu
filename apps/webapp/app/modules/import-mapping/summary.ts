/**
 * Import mapping: what an import will create, for the line under the review
 * table.
 *
 * The server counts, per column, how many distinct values are not yet a
 * category or a location in the workspace (`buildColumnStats`). The review
 * table then reads the counts of whichever columns the user maps to category
 * and location (`summarizeMapping`), so the summary follows every change in
 * the dropdowns without another round trip.
 *
 * Pure and client-safe.
 *
 * @see {@link file://./../../components/assets/import-mapping/mapping-review.tsx}
 */
import type { ColumnMapping } from "./types";
import { customFieldNameKey } from "./types";

/** Per column: distinct values that are not yet a category or a location. */
export type ColumnStats = { newCategories: number; newLocations: number };

/** Lowercased, trimmed: the importer matches category and location names case-insensitively. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Counts, per column, the distinct values that would become new categories or
 * new locations if that column were mapped there.
 *
 * @param csvData - Parsed CSV, header row first
 * @param existing - The workspace's category and location names
 * @returns One entry per column, aligned with the header row
 */
export function buildColumnStats(
  csvData: string[][],
  existing: { categories: string[]; locations: string[] }
): ColumnStats[] {
  const categories = new Set(existing.categories.map(nameKey));
  const locations = new Set(existing.locations.map(nameKey));
  const columnCount = (csvData[0] ?? []).length;
  const rows = csvData.slice(1);

  return Array.from({ length: columnCount }, (_, index) => {
    const values = new Set<string>();
    for (const row of rows) {
      const key = nameKey(row[index] ?? "");
      if (key) values.add(key);
    }
    let newCategories = 0;
    let newLocations = 0;
    for (const value of values) {
      if (!categories.has(value)) newCategories++;
      if (!locations.has(value)) newLocations++;
    }
    return { newCategories, newLocations };
  });
}

/** What the confirmed mapping will import and create. */
export type MappingSummary = {
  rows: number;
  /** Names of custom fields the workspace does not have yet. */
  newCustomFields: string[];
  newCategories: number;
  newLocations: number;
};

/**
 * Summarises a mapping for the line under the review table.
 *
 * @param args.columns - The mapping as currently edited
 * @param args.stats - Per-column counts from {@link buildColumnStats}
 * @param args.rowCount - Data rows in the file
 * @param args.existingCustomFieldNames - The workspace's custom field names
 * @returns Rows to import and what will be created
 */
export function summarizeMapping({
  columns,
  stats,
  rowCount,
  existingCustomFieldNames,
}: {
  columns: ColumnMapping[];
  stats: ColumnStats[];
  rowCount: number;
  existingCustomFieldNames: string[];
}): MappingSummary {
  const existing = new Set(existingCustomFieldNames.map(customFieldNameKey));
  const summary: MappingSummary = {
    rows: rowCount,
    newCustomFields: [],
    newCategories: 0,
    newLocations: 0,
  };

  columns.forEach(({ target }, index) => {
    if (
      target.kind === "customField" &&
      !existing.has(customFieldNameKey(target.name))
    ) {
      summary.newCustomFields.push(target.name.trim());
    }
    if (target.kind === "field" && target.name === "category") {
      summary.newCategories = stats[index]?.newCategories ?? 0;
    }
    if (target.kind === "field" && target.name === "location") {
      summary.newLocations = stats[index]?.newLocations ?? 0;
    }
  });

  return summary;
}
