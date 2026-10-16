/**
 * Import mapping: the rule-based proposal.
 *
 * Proposes a Shelf destination for every column of an uploaded spreadsheet
 * without any network call: exact header names first, then case- and
 * separator-insensitive names, then the workspace's existing custom fields,
 * then a synonym table (`synonyms.ts`). Anything unmatched is skipped.
 *
 * Pure: no database, no I/O.
 *
 * @see {@link file://./types.ts} the mapping shapes
 * @see {@link file://./../../utils/import.server.ts} the importer it feeds
 */
import { CustomFieldType } from "@prisma/client";
import { getDefinitionFromCsvHeader } from "~/utils/custom-fields";
import type { AssetCsvHeader } from "./fields";
import { IMPORT_FIELDS, getImportField, isAssetCsvHeader } from "./fields";
import { lookupSynonym, normalizeHeader } from "./synonyms";
import type { ColumnMapping, ColumnTarget, MappingProposal } from "./types";
import {
  MAX_PROPOSAL_NOTES,
  MAX_SAMPLE_LENGTH,
  MAX_SAMPLES_PER_COLUMN,
  customFieldNameSchema,
  targetKey,
} from "./types";

/** A custom field the workspace already has, as the matcher needs it. */
export type ExistingCustomField = { name: string; type: CustomFieldType };

/** Workspace facts that change what the matcher may propose. */
export type RulesOptions = {
  /** Without the barcode add-on, barcode synonyms are never proposed. */
  canUseBarcodes?: boolean;
};

/** A column's headers and sample cells, read from parsed CSV data. */
export type ColumnSamples = {
  /** Trimmed header text, in file order. */
  headers: string[];
  /** Per column: up to 3 non-empty cells, each cut to 60 characters. */
  samples: string[][];
};

/**
 * Reads the header row and a few sample cells per column.
 *
 * Headers are trimmed the same way the importer trims them, which also strips
 * a leading byte-order mark.
 *
 * @param csvData - Parsed CSV, header row first
 * @returns Headers and samples, aligned by column index
 */
export function buildColumnSamples(csvData: string[][]): ColumnSamples {
  const headers = (csvData[0] ?? []).map((header) => header.trim());
  const samples = headers.map((_, columnIndex) => {
    const cells: string[] = [];
    for (const row of csvData.slice(1)) {
      if (cells.length >= MAX_SAMPLES_PER_COLUMN) break;
      const cell = (row[columnIndex] ?? "").trim();
      if (cell !== "") cells.push(cell.slice(0, MAX_SAMPLE_LENGTH));
    }
    return cells;
  });
  return { headers, samples };
}

/** Same as {@link normalizeHeader} with the spaces removed. */
function compactHeader(text: string): string {
  return normalizeHeader(text).replace(/ /g, "");
}

/** Values the importer accepts in enum-like columns, checked on samples. */
const ALLOWED_VALUES: Partial<Record<AssetCsvHeader, Set<string>>> = {
  type: new Set(["INDIVIDUAL", "QUANTITY_TRACKED"]),
  consumptionType: new Set(["ONE_WAY", "TWO_WAY"]),
};

/** Whether every sample fits an enum-like field. Free fields always fit. */
function samplesFitField(name: AssetCsvHeader, sample: string[]): boolean {
  const allowed = ALLOWED_VALUES[name];
  if (!allowed) return true;
  return sample.every((cell) => allowed.has(cell.trim().toUpperCase()));
}

const CUSTOM_FIELD_TYPES = new Set<string>(Object.values(CustomFieldType));

/**
 * Reads a header already written in Shelf's `cf:<name>, type:<type>` form.
 *
 * @returns The custom field target, or `null` when the header is malformed
 */
function parseCustomFieldHeader(
  header: string
): Extract<ColumnTarget, { kind: "customField" }> | null {
  const definition = getDefinitionFromCsvHeader(header);
  const name = customFieldNameSchema.safeParse(definition.name);
  if (!name.success || !CUSTOM_FIELD_TYPES.has(definition.type)) return null;
  return { kind: "customField", name: name.data, type: definition.type };
}

/**
 * Whether the workspace may import into a Shelf field. Barcode fields need the
 * barcode add-on; without it the importer refuses the whole file.
 */
function fieldAllowed(name: AssetCsvHeader, options: RulesOptions): boolean {
  return (
    !getImportField(name).requiresBarcodes || Boolean(options.canUseBarcodes)
  );
}

/** One column's proposal before duplicate destinations are resolved. */
type Candidate = Pick<ColumnMapping, "target" | "confidence">;

/**
 * Proposes a destination for one column.
 *
 * Order: exact Shelf header, `cf:` header, case- and separator-insensitive
 * header, existing custom field by name, synonym, skip.
 */
function proposeColumn(
  header: string,
  sample: string[],
  existingByName: Map<string, ExistingCustomField>,
  options: RulesOptions
): Candidate {
  const skip: Candidate = { target: { kind: "skip" }, confidence: "low" };
  if (header === "") return skip;

  if (isAssetCsvHeader(header)) {
    if (!fieldAllowed(header, options)) return skip;
    return { target: { kind: "field", name: header }, confidence: "high" };
  }

  if (header.toLowerCase().startsWith("cf:")) {
    const target = parseCustomFieldHeader(header);
    if (!target) return skip;
    // The importer refuses a header whose type contradicts an existing field
    // of the same name, so the stored type wins and the row asks for a check.
    const stored = existingByName.get(normalizeHeader(target.name));
    if (stored && stored.type !== target.type) {
      return {
        target: { kind: "customField", name: stored.name, type: stored.type },
        confidence: "low",
      };
    }
    return { target, confidence: "high" };
  }

  const compact = compactHeader(header);
  const looseField = IMPORT_FIELDS.find(
    (candidate) => compactHeader(candidate.name) === compact
  );
  if (looseField) {
    if (!fieldAllowed(looseField.name, options)) return skip;
    if (samplesFitField(looseField.name, sample)) {
      return {
        target: { kind: "field", name: looseField.name },
        confidence: "high",
      };
    }
    // A "Type" column holding "Laptop" is a category, not an asset type.
    if (looseField.name === "type") {
      return { target: { kind: "field", name: "category" }, confidence: "low" };
    }
    return skip;
  }

  const existing = existingByName.get(normalizeHeader(header));
  if (existing) {
    return {
      target: { kind: "customField", name: existing.name, type: existing.type },
      confidence: "high",
    };
  }

  const synonym = lookupSynonym(header);
  if (synonym) {
    if (synonym.kind === "field") {
      if (!fieldAllowed(synonym.name, options)) return skip;
      return { target: synonym, confidence: "high" };
    }
    // Prefer the workspace's own field of that name, with its stored type.
    const sameName = existingByName.get(normalizeHeader(synonym.name));
    return {
      target: sameName
        ? { kind: "customField", name: sameName.name, type: sameName.type }
        : synonym,
      confidence: "high",
    };
  }

  return skip;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shown when a column maps to quantity and none maps to type. */
export const QUANTITY_WITHOUT_TYPE_NOTE =
  "Rows with a quantity above 1 need a type column set to QUANTITY_TRACKED (and a consumptionType). Without it the importer rejects those rows.";

/**
 * Short warnings about values the importer will refuse or drop under the
 * proposed mapping. Facts about formats only; nothing is rewritten.
 *
 * @param columns - A complete mapping, in file order
 * @returns At most {@link MAX_PROPOSAL_NOTES} notes
 */
export function buildFormatNotes(columns: ColumnMapping[]): string[] {
  const notes: string[] = [];
  const hasTypeColumn = columns.some(
    (column) => column.target.kind === "field" && column.target.name === "type"
  );

  for (const { source, target, sample } of columns) {
    if (target.kind === "customField" && target.type === CustomFieldType.DATE) {
      const bad = sample.find((cell) => !ISO_DATE.test(cell));
      if (bad) {
        notes.push(
          `"${source}" has dates like "${bad}", but the importer needs YYYY-MM-DD. Fix the dates or pick a text field.`
        );
      }
    }
    if (
      target.kind === "customField" &&
      target.type === CustomFieldType.BOOLEAN
    ) {
      const bad = sample.find(
        (cell) => !["yes", "no"].includes(cell.trim().toLowerCase())
      );
      if (bad) {
        notes.push(
          `"${source}" has values like "${bad}". Yes/no fields accept only yes or no; other values are left empty.`
        );
      }
    }
    // Samples cannot prove every row holds 1, so the note shows whenever a
    // quantity column has no type column beside it.
    if (
      target.kind === "field" &&
      target.name === "quantity" &&
      !hasTypeColumn
    ) {
      notes.push(QUANTITY_WITHOUT_TYPE_NOTE);
    }
  }

  return notes.slice(0, MAX_PROPOSAL_NOTES);
}

/**
 * Proposes a mapping for a whole file using rules only.
 *
 * When two columns resolve to the same destination, the first keeps it and
 * the later one is skipped, so a fresh proposal never needs fixing before
 * Import.
 *
 * @param headers - Trimmed headers, in file order
 * @param samples - Sample cells per column, aligned with `headers`
 * @param existingCustomFields - The workspace's non-deleted custom fields
 * @param options - Workspace facts, see {@link RulesOptions}
 * @returns A proposal with `source: "rules"`
 */
export function proposeByRules(
  headers: string[],
  samples: string[][],
  existingCustomFields: ExistingCustomField[],
  options: RulesOptions = {}
): MappingProposal {
  const existingByName = new Map(
    existingCustomFields.map((existing) => [
      normalizeHeader(existing.name),
      existing,
    ])
  );
  const taken = new Set<string>();

  const columns = headers.map((source, index): ColumnMapping => {
    const sample = samples[index] ?? [];
    const candidate = proposeColumn(source, sample, existingByName, options);
    const key = targetKey(candidate.target);
    if (key && taken.has(key)) {
      return { source, target: { kind: "skip" }, confidence: "low", sample };
    }
    if (key) taken.add(key);
    return { source, sample, ...candidate };
  });

  return { columns, notes: buildFormatNotes(columns), source: "rules" };
}

/**
 * Whether the file is already in Shelf's import format: every column carries
 * a Shelf header (or a valid `cf:` header) under its own name, apart from an
 * ignored `id` column.
 *
 * @param columns - A mapping, in file order
 * @returns `true` when applying the mapping would change nothing
 */
export function isAlreadyShelfFormat(columns: ColumnMapping[]): boolean {
  return (
    columns.length > 0 &&
    columns.every(({ source, target }) => {
      if (target.kind === "field") return target.name === source;
      if (target.kind === "customField") {
        const parsed = source.toLowerCase().startsWith("cf:")
          ? parseCustomFieldHeader(source)
          : null;
        return (
          parsed !== null &&
          parsed.name.toLowerCase() === target.name.trim().toLowerCase() &&
          parsed.type === target.type
        );
      }
      // The import-ready export's `id` column is accepted and ignored by the
      // create importer, so skipping it changes nothing either.
      return source === "id";
    })
  );
}
