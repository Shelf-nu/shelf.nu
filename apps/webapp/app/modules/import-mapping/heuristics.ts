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
import { CustomFieldFormat, CustomFieldType } from "@prisma/client";
import {
  CUSTOM_FIELD_DATE_FORMAT,
  getDefinitionFromCsvHeader,
  isImportableCustomFieldDate,
  parseYesNo,
} from "~/utils/custom-fields";
import type { AssetCsvHeader } from "./fields";
import { IMPORT_FIELDS, getImportField, isAssetCsvHeader } from "./fields";
import { lookupSynonym, normalizeHeader } from "./synonyms";
import type {
  ColumnMapping,
  ColumnTarget,
  MappingProposal,
  QuantityTracking,
} from "./types";
import {
  MAX_PROPOSAL_NOTES,
  MAX_SAMPLE_LENGTH,
  MAX_SAMPLES_PER_COLUMN,
  customFieldNameKey,
  customFieldNameSchema,
  needsQuantityTracking,
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
  const rows = csvData.slice(1);
  const samples = headers.map((_, columnIndex) => {
    const cells: string[] = [];
    for (const row of rows) {
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
 * Reads a header already written in Shelf's `cf:<name>, type:<type>` form,
 * keeping a `format:link` segment.
 *
 * @returns The custom field target, or `null` when the header is malformed
 */
function parseCustomFieldHeader(
  header: string
): Extract<ColumnTarget, { kind: "customField" }> | null {
  const definition = getDefinitionFromCsvHeader(header);
  const name = customFieldNameSchema.safeParse(definition.name);
  if (!name.success || !CUSTOM_FIELD_TYPES.has(definition.type)) return null;
  const target = {
    kind: "customField",
    name: name.data,
    type: definition.type,
  } as const;
  return definition.format === CustomFieldFormat.LINK
    ? { ...target, format: definition.format }
    : target;
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

/** Finds the workspace's custom fields by name. */
type ExistingFieldLookup = {
  /** Trimmed, case-insensitive name match: what the importer applies. */
  exact: (name: string) => ExistingCustomField | undefined;
  /**
   * The exact match, or else the one field whose name matches ignoring
   * punctuation ("Asset ID" for "asset_id"). When several fields fold to the
   * same name ("Asset ID" and "Asset-ID"), none is guessed.
   */
  find: (name: string) => ExistingCustomField | undefined;
};

/** Builds the lookup over the workspace's custom fields. */
function buildExistingFieldLookup(
  fields: ExistingCustomField[]
): ExistingFieldLookup {
  const byExact = new Map<string, ExistingCustomField>();
  const byFolded = new Map<string, ExistingCustomField[]>();
  for (const field of fields) {
    byExact.set(customFieldNameKey(field.name), field);
    const folded = normalizeHeader(field.name);
    byFolded.set(folded, [...(byFolded.get(folded) ?? []), field]);
  }
  const exact = (name: string) => byExact.get(customFieldNameKey(name));
  return {
    exact,
    find: (name) => {
      const match = exact(name);
      if (match) return match;
      const key = normalizeHeader(name);
      // A heading with no letters or digits says nothing about which field.
      if (key === "") return undefined;
      const folded = byFolded.get(key) ?? [];
      return folded.length === 1 ? folded[0] : undefined;
    },
  };
}

/** One column's proposal before duplicate destinations are resolved. */
type Candidate = Pick<ColumnMapping, "target" | "confidence">;

/**
 * The Shelf header a column carries: its exact name, or the same name written
 * with other case and separators ("Valuation", "MIN_QUANTITY").
 */
function matchShelfHeader(header: string): AssetCsvHeader | undefined {
  if (isAssetCsvHeader(header)) return header;
  const compact = compactHeader(header);
  return IMPORT_FIELDS.find(
    (candidate) => compactHeader(candidate.name) === compact
  )?.name;
}

/**
 * Proposes a destination for one column.
 *
 * Order: Shelf's `id` column (skipped), `cf:` header, Shelf header (exact or
 * case- and separator-insensitive), existing custom field by name, synonym,
 * skip.
 */
function proposeColumn(
  header: string,
  sample: string[],
  existing: ExistingFieldLookup,
  options: RulesOptions
): Candidate {
  const skip: Candidate = { target: { kind: "skip" }, confidence: "low" };
  if (header === "") return skip;

  // The import-ready export's `id` column holds Shelf's own asset ids, which
  // the create importer ignores. It never goes to a custom field, even one
  // the workspace named "ID".
  if (header === "id") return skip;

  if (header.toLowerCase().startsWith("cf:")) {
    const target = parseCustomFieldHeader(header);
    if (!target) return skip;
    // The importer refuses a header whose type contradicts an existing field
    // of the same name, so the stored type wins and the row asks for a check.
    // Exact name only: this is the rule the importer itself applies.
    const stored = existing.exact(target.name);
    if (stored && stored.type !== target.type) {
      return {
        target: { kind: "customField", name: stored.name, type: stored.type },
        confidence: "low",
      };
    }
    return { target, confidence: "high" };
  }

  const shelfHeader = matchShelfHeader(header);
  if (shelfHeader) {
    if (!fieldAllowed(shelfHeader, options)) return skip;
    // The heading alone is not enough for enum-like fields: the values must
    // be ones the importer accepts, however exactly the heading is written.
    if (samplesFitField(shelfHeader, sample)) {
      return {
        target: { kind: "field", name: shelfHeader },
        confidence: "high",
      };
    }
    // A "Type" column holding "Laptop" is a category, not an asset type.
    if (shelfHeader === "type") {
      return { target: { kind: "field", name: "category" }, confidence: "low" };
    }
    return skip;
  }

  const existingField = existing.find(header);
  if (existingField) {
    return {
      target: {
        kind: "customField",
        name: existingField.name,
        type: existingField.type,
      },
      confidence: "high",
    };
  }

  const match = lookupSynonym(header);
  if (match) {
    const { target: synonym } = match;
    // A loose synonym is a guess, so a column that clearly means the same
    // destination wins it (see `proposeByRules`).
    const confidence = match.guess ? "low" : "high";
    if (synonym.kind === "field") {
      if (!fieldAllowed(synonym.name, options)) return skip;
      return { target: synonym, confidence };
    }
    // Prefer the workspace's own field of that name, with its stored type.
    const sameName = existing.find(synonym.name);
    return {
      target: sameName
        ? { kind: "customField", name: sameName.name, type: sameName.type }
        : synonym,
      confidence,
    };
  }

  return skip;
}

/**
 * Short warnings about values the importer will refuse or drop under the
 * proposed mapping, read with the importer's own date and yes/no rules
 * (`~/utils/custom-fields`). Facts about formats only; nothing is rewritten.
 *
 * @param columns - A complete mapping, in file order
 * @returns At most {@link MAX_PROPOSAL_NOTES} notes
 */
export function buildFormatNotes(columns: ColumnMapping[]): string[] {
  const notes: string[] = [];

  for (const { source, target, sample } of columns) {
    if (target.kind === "customField" && target.type === CustomFieldType.DATE) {
      // The importer trims a date before it reads it.
      const bad = sample.find(
        (cell) => !isImportableCustomFieldDate(cell.trim())
      );
      if (bad) {
        notes.push(
          CUSTOM_FIELD_DATE_FORMAT.test(bad.trim())
            ? `"${source}" has "${bad}", which is not a real calendar date. Fix the dates or pick a text field.`
            : `"${source}" has dates like "${bad}", but the importer needs YYYY-MM-DD. Fix the dates or pick a text field.`
        );
      }
    }
    if (
      target.kind === "customField" &&
      target.type === CustomFieldType.BOOLEAN
    ) {
      const bad = sample.find((cell) => parseYesNo(cell) === undefined);
      if (bad) {
        notes.push(
          `"${source}" has values like "${bad}". Yes/no fields accept only yes or no; other values are left empty.`
        );
      }
    }
  }

  return notes.slice(0, MAX_PROPOSAL_NOTES);
}

/**
 * Proposes a mapping for a whole file using rules only.
 *
 * When two columns resolve to the same destination, one keeps it and the
 * others are skipped, so a fresh proposal never needs fixing before Import.
 * A sure match beats a guess (an exact "Category" column beats a "Type"
 * column read as categories); between equals, the first column wins.
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
  const existing = buildExistingFieldLookup(existingCustomFields);
  const candidates = headers.map((source, index) =>
    proposeColumn(source, samples[index] ?? [], existing, options)
  );

  /** Destination key to the index of the column that keeps it. */
  const winners = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    const key = targetKey(candidate.target);
    if (!key) return;
    const current = winners.get(key);
    if (
      current === undefined ||
      (candidate.confidence === "high" &&
        candidates[current].confidence !== "high")
    ) {
      winners.set(key, index);
    }
  });

  const columns = headers.map((source, index): ColumnMapping => {
    const sample = samples[index] ?? [];
    const candidate = candidates[index];
    const key = targetKey(candidate.target);
    if (key && winners.get(key) !== index) {
      return { source, target: { kind: "skip" }, confidence: "low", sample };
    }
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
          customFieldNameKey(parsed.name) === customFieldNameKey(target.name) &&
          parsed.type === target.type
        );
      }
      // The import-ready export's `id` column is accepted and ignored by the
      // create importer, so skipping it changes nothing either.
      return source === "id";
    })
  );
}

/**
 * The quantity choice the review starts on, for a mapping that needs one
 * ({@link needsQuantityTracking}).
 *
 * Individual assets only when every sampled quantity is 1, the one value the
 * importer accepts on an individual asset. Otherwise nothing: the file holds
 * stock, and only the user knows whether it is returned or used up. Samples
 * cannot prove every row holds 1; the preview checks the whole file.
 *
 * @param columns - The mapping, in file order
 * @returns The starting choice, or `null` when the user must pick one
 */
export function suggestQuantityTracking(
  columns: ColumnMapping[]
): QuantityTracking | null {
  if (!needsQuantityTracking(columns)) return null;
  const quantity = columns.find(
    ({ target }) => target.kind === "field" && target.name === "quantity"
  );
  const allOne = (quantity?.sample ?? []).every((cell) => cell.trim() === "1");
  return allOne ? "INDIVIDUAL" : null;
}
