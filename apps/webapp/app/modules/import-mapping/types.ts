/**
 * Import mapping: data shapes shared by the matcher, the model call, the route
 * and the review table.
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
import { CustomFieldType } from "@prisma/client";
import { z } from "zod";
import type { AssetCsvHeader } from "./fields";
import { IMPORT_FIELD_NAMES } from "./fields";

/** Most columns one mapping may carry. Larger files are refused. */
export const MAX_MAPPED_COLUMNS = 200;

/** Most sample cells kept per column. */
export const MAX_SAMPLES_PER_COLUMN = 3;

/** Longest sample cell kept, in characters. */
export const MAX_SAMPLE_LENGTH = 60;

/** Most notes a proposal carries. */
export const MAX_PROPOSAL_NOTES = 5;

/** Longest custom field name a mapping may create. */
export const MAX_CUSTOM_FIELD_NAME_LENGTH = 100;

/** Where one source column goes. The review table edits exactly this. */
export type ColumnTarget =
  | { kind: "field"; name: AssetCsvHeader }
  | { kind: "customField"; name: string; type: CustomFieldType }
  | { kind: "skip" };

/** One source column and the Shelf header it becomes. */
export type ColumnMapping = {
  /** Exact header text from the file, trimmed. */
  source: string;
  target: ColumnTarget;
  /** high = exact or synonym match, or the model was sure. */
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
  /** Which proposer produced the final answer. */
  source: "rules" | "model";
};

/**
 * Custom field names travel inside a `cf:<name>, type:<type>` header, which
 * the importer splits on commas, so a comma in the name would break it.
 */
export const customFieldNameSchema = z
  .string()
  .trim()
  .min(1, "Custom field name is required")
  .max(MAX_CUSTOM_FIELD_NAME_LENGTH)
  .refine((name) => !name.includes(","), {
    message: "Custom field names cannot contain a comma",
  })
  .refine((name) => !name.toLowerCase().startsWith("type:"), {
    message: "Custom field names cannot start with type:",
  });

/** Validates a {@link ColumnTarget}. */
export const columnTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), name: z.enum(IMPORT_FIELD_NAMES) }),
  z.object({
    kind: z.literal("customField"),
    name: customFieldNameSchema,
    type: z.nativeEnum(CustomFieldType),
  }),
  z.object({ kind: z.literal("skip") }),
]);

/** Validates a {@link ColumnMapping} as submitted by the review form. */
export const columnMappingSchema = z.object({
  source: z.string().max(500),
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
 * A stable key per destination, so two columns aimed at the same place can be
 * found. Custom fields match by name case-insensitively, like the importer.
 *
 * @param target - A column target
 * @returns The key, or `null` for skipped columns (any number may be skipped)
 */
export function targetKey(target: ColumnTarget): string | null {
  switch (target.kind) {
    case "field":
      return `field:${target.name}`;
    case "customField":
      return `cf:${target.name.trim().toLowerCase()}`;
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
 * The CSV header a target becomes in the importer-ready file.
 *
 * @param target - A non-skip column target
 * @returns The header text, for example `title` or `cf:Serial number, type:text`
 */
export function headerForTarget(
  target: Exclude<ColumnTarget, { kind: "skip" }>
): string {
  if (target.kind === "field") return target.name;
  return `cf:${target.name.trim()}, type:${target.type.toLowerCase()}`;
}
