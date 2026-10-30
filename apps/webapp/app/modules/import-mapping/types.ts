/**
 * Import mapping: data shapes shared by the matcher, the route and the review
 * table.
 *
 * A mapping says, for every column of an uploaded spreadsheet, which Shelf
 * header it becomes. Applying it only renames and drops columns; cell values
 * are never rewritten, so the existing importer validates the result exactly
 * as it validates a hand-made template.
 *
 * Client-safe: no server imports.
 *
 * @see {@link file://./heuristics.ts} rule-based proposal
 * @see {@link file://./apply.ts} turns a mapping into importer-ready CSV data
 */
import { CustomFieldFormat, CustomFieldType } from "@prisma/client";
import { z } from "zod";
import type { AssetCsvHeader } from "./fields";
import { IMPORT_FIELD_NAMES } from "./fields";

/** Most columns one mapping may carry. Larger files are refused. */
export const MAX_MAPPED_COLUMNS = 200;

/** Longest column heading a file may carry, in characters. */
export const MAX_HEADER_LENGTH = 1000;

/**
 * Most characters `JSON.stringify` can write for one character of a string: a
 * control character becomes a six-character `\u00XX` escape.
 */
const JSON_ESCAPE_FACTOR = 6;

/**
 * Largest `mapping` form field accepted. Every mapping the analysis accepts
 * must fit, so it allows each column the longest heading and the longest
 * custom field name, both at the worst JSON escaping, plus room for the keys
 * and the other target fields. Samples are not posted back.
 */
export const MAX_MAPPING_FIELD_LENGTH =
  MAX_MAPPED_COLUMNS * (2 * JSON_ESCAPE_FACTOR * MAX_HEADER_LENGTH + 400);

/** Most sample cells kept per column. */
export const MAX_SAMPLES_PER_COLUMN = 3;

/** Longest sample cell kept, in characters. */
export const MAX_SAMPLE_LENGTH = 60;

/** Most notes a proposal carries. */
export const MAX_PROPOSAL_NOTES = 5;

/** Longest custom field name the review lets a user type for a new field. */
export const MAX_CUSTOM_FIELD_NAME_LENGTH = 100;

/** Where one source column goes. The review table edits exactly this. */
export type ColumnTarget =
  | { kind: "field"; name: AssetCsvHeader }
  | {
      kind: "customField";
      name: string;
      type: CustomFieldType;
      /**
       * `LINK` when the column's `cf:` header says `format:link`, so a new
       * single-line text field is created as a Link field. Absent otherwise.
       */
      format?: CustomFieldFormat;
    }
  | { kind: "skip" };

/** One source column and the Shelf header it becomes. */
export type ColumnMapping = {
  /** Exact header text from the file, trimmed. */
  source: string;
  target: ColumnTarget;
  /** high = exact, case-insensitive, existing-field or synonym match. */
  confidence: "high" | "low";
  /** Up to 3 non-empty cells, each cut to 60 chars. Shown in the UI only. */
  sample: string[];
};

/** A full proposal for one file: one mapping per source column. */
export type MappingProposal = {
  /** One per source column, in file order. */
  columns: ColumnMapping[];
  /** At most 5 short warnings about value formats. */
  notes: string[];
  /** Which proposer produced the answer. Only the rule-based one exists. */
  source: "rules";
};

/**
 * Custom field names travel inside a `cf:<name>, type:<type>` header, which
 * the importer splits on commas, so a comma in the name would break it.
 * Existing fields can have longer names than the review lets a user type, so
 * the bound here is the heading limit, not {@link MAX_CUSTOM_FIELD_NAME_LENGTH}.
 */
export const customFieldNameSchema = z
  .string()
  .trim()
  .min(1, "Custom field name is required")
  .max(MAX_HEADER_LENGTH)
  .refine((name) => !name.includes(","), {
    message: "Custom field names cannot contain a comma",
  });

/** Validates a {@link ColumnTarget}. */
export const columnTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), name: z.enum(IMPORT_FIELD_NAMES) }),
  z.object({
    kind: z.literal("customField"),
    name: customFieldNameSchema,
    type: z.nativeEnum(CustomFieldType),
    format: z.nativeEnum(CustomFieldFormat).optional(),
  }),
  z.object({ kind: z.literal("skip") }),
]);

/** Validates a {@link ColumnMapping} as submitted by the review form. */
export const columnMappingSchema = z.object({
  source: z.string().max(MAX_HEADER_LENGTH),
  target: columnTargetSchema,
  confidence: z.enum(["high", "low"]),
  sample: z
    .array(z.string().max(MAX_SAMPLE_LENGTH))
    .max(MAX_SAMPLES_PER_COLUMN),
});

/** Validates the `mapping` form field: the reviewed list of columns. */
export const columnMappingListSchema = z
  .array(columnMappingSchema)
  .min(1)
  .max(MAX_MAPPED_COLUMNS);

/**
 * The key custom field names are compared by everywhere in the mapping:
 * trimmed and lowercased, so "Serial Number " and "serial number" are one
 * field. The proposal, the review and its summary must all agree on this, or
 * they disagree about whether a field already exists.
 *
 * @param name - A custom field name
 * @returns The comparison key
 */
export function customFieldNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A stable key per destination, so two columns aimed at the same place can be
 * found. Custom fields match by {@link customFieldNameKey}.
 *
 * @param target - A column target
 * @returns The key, or `null` for skipped columns (any number may be skipped)
 */
export function targetKey(target: ColumnTarget): string | null {
  switch (target.kind) {
    case "field":
      return `field:${target.name}`;
    case "customField":
      return `cf:${customFieldNameKey(target.name)}`;
    case "skip":
      return null;
  }
}

/**
 * Finds destinations that more than one column maps to.
 *
 * @param columns - The mapping, in file order
 * @returns For each clashing destination key, the indexes of the columns
 *   aimed at it. Empty when every destination is used at most once.
 */
export function findDuplicateTargets(
  columns: Pick<ColumnMapping, "target">[]
): Map<string, number[]> {
  const byKey = new Map<string, number[]>();
  columns.forEach((column, index) => {
    const key = targetKey(column.target);
    if (!key) return;
    byKey.set(key, [...(byKey.get(key) ?? []), index]);
  });
  return new Map([...byKey].filter(([, indexes]) => indexes.length > 1));
}

/**
 * The CSV header a target becomes in the importer-ready file. A Link-format
 * single-line text target keeps its `format:link` segment.
 *
 * @param target - A non-skip column target
 * @returns The header text, for example `title`,
 *   `cf:Serial number, type:text` or `cf:Manual, type:text, format:link`
 */
export function headerForTarget(
  target: Exclude<ColumnTarget, { kind: "skip" }>
): string {
  if (target.kind === "field") return target.name;
  const header = `cf:${target.name.trim()}, type:${target.type.toLowerCase()}`;
  const isLink =
    target.type === CustomFieldType.TEXT &&
    target.format === CustomFieldFormat.LINK;
  return isLink ? `${header}, format:link` : header;
}

/**
 * How the rows of a file are tracked when it maps a quantity column but no
 * type column: as individual assets (quantity must then be 1, which the
 * importer checks), or every row as stock with this consumption type.
 */
export const QUANTITY_TRACKING = ["INDIVIDUAL", "TWO_WAY", "ONE_WAY"] as const;

/** One of {@link QUANTITY_TRACKING}. */
export type QuantityTracking = (typeof QUANTITY_TRACKING)[number];

/** Validates the quantity choice posted with a reviewed mapping. */
export const quantityTrackingSchema = z.enum(QUANTITY_TRACKING);

/** Whether a mapping sends some column to this Shelf field. */
function mapsField(columns: ColumnMapping[], name: AssetCsvHeader): boolean {
  return columns.some(
    ({ target }) => target.kind === "field" && target.name === name
  );
}

/**
 * Whether the review must ask how rows are tracked: a quantity column is
 * mapped and no type column is, so the file cannot say which rows are stock.
 *
 * @param columns - The mapping, in file order
 * @returns `true` when a {@link QuantityTracking} choice applies
 */
export function needsQuantityTracking(columns: ColumnMapping[]): boolean {
  return mapsField(columns, "quantity") && !mapsField(columns, "type");
}

/**
 * Whether a mapping sends some column to `consumptionType`, which a stock
 * choice then leaves to the file instead of filling in.
 *
 * @param columns - The mapping, in file order
 * @returns `true` when the file carries its own consumption types
 */
export function mapsConsumptionType(columns: ColumnMapping[]): boolean {
  return mapsField(columns, "consumptionType");
}
