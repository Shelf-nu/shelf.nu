/**
 * Content-import pre-flight validation.
 *
 * Checks every row of a content-import CSV before `createAssetsFromContentImport`
 * writes anything — neither assets nor the categories, tags, locations, kits,
 * custom fields and asset models its taxonomy helpers create. A file with
 * problems is refused whole, with every problem listed, so one upload tells the
 * user everything they have to fix.
 *
 * Checks reuse the same functions the create loop calls rather than
 * reimplementing them. A rule that disagreed with the importer would reject a
 * file the importer would have accepted, which is worse than the abort it
 * replaces.
 *
 * @see {@link file://./service.server.ts} — `createAssetsFromContentImport`
 * @see {@link file://./qty-validation.server.ts} — the shared column rules
 */
import type { CustomField } from "@prisma/client";
import { AssetType, CustomFieldType } from "@prisma/client";

import {
  buildCustomFieldValue,
  getDefinitionFromCsvHeader,
} from "~/utils/custom-fields";
import { isLikeShelfError } from "~/utils/error";
import { validateQtyTrackedFields } from "./qty-validation.server";
import type { CreateAssetFromContentImportPayload } from "./types";

/** The largest content-import file accepted, in data rows. */
export const MAX_CONTENT_IMPORT_ROWS = 1000;

/**
 * The most row errors listed back to the browser. A file where every row is
 * wrong would otherwise produce a response measured in megabytes, so the list
 * is truncated and {@link ImportPreflightResult.totalErrors} carries how many
 * there really were.
 */
export const MAX_REPORTED_ROW_ERRORS = 100;

/**
 * Every custom field type the database will accept.
 *
 * `getDefinitionFromCsvHeader` casts whatever a `cf:` header declares straight
 * to `CustomFieldType` without checking it, so a typo like `type:numbre`
 * reaches `db.customField.create` as an invalid enum member unless it is
 * rejected here.
 */
const CUSTOM_FIELD_TYPES = Object.values(CustomFieldType);
const CUSTOM_FIELD_TYPE_SET = new Set<string>(CUSTOM_FIELD_TYPES);

/**
 * One problem found in one row.
 *
 * `row` is the line number as the user's spreadsheet shows it — the header
 * occupies row 1, so the first data row is row 2. A `row` of 0 marks a
 * whole-file problem that belongs to no single line, such as the row cap.
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
 * exactly when a file had more problems than are listed, which is what lets the
 * import page say "showing the first 100 of 412".
 */
export type ImportPreflightResult = {
  errors: ImportRowError[];
  totalErrors: number;
};

/**
 * Reads one CSV cell as the string the column validators expect.
 *
 * A parsed row carries arbitrary keys, so a cell may be absent or hold a
 * non-string. Anything that is not a string reads as `undefined` — the same
 * "column not provided" signal an absent cell gives.
 *
 * @param asset - The parsed CSV row
 * @param key - The column name to read
 * @returns The cell's string value, or `undefined` when it is absent
 */
function cell(
  asset: CreateAssetFromContentImportPayload,
  key: string
): string | undefined {
  const value: unknown = asset[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Validates every row of a parsed content-import file.
 *
 * Pure and synchronous: the only database state it needs — the workspace's
 * existing custom fields — is passed in, so it can be unit-tested directly and
 * cannot itself write.
 *
 * @param args.data - Parsed CSV rows from `extractCSVDataFromContentImport`
 * @param args.existingCustomFields - Non-deleted custom fields already in the
 *   workspace, matching `upsertCustomField`'s own lookup, used to catch a
 *   header whose declared type contradicts one
 * @returns The problems found and how many there were. An empty `errors` means
 *   the file is safe to import.
 */
export function validateContentImportRows({
  data,
  existingCustomFields,
}: {
  data: CreateAssetFromContentImportPayload[];
  existingCustomFields: Pick<CustomField, "name" | "type">[];
}): ImportPreflightResult {
  if (data.length > MAX_CONTENT_IMPORT_ROWS) {
    return {
      errors: [
        {
          row: 0,
          title: "File too large",
          message: `This file has ${data.length} rows, but the maximum is ${MAX_CONTENT_IMPORT_ROWS}. Please split it into smaller files and import them one at a time.`,
        },
      ],
      totalErrors: 1,
    };
  }

  // Custom field names are matched case-insensitively everywhere else
  // (`upsertCustomField` looks them up with `mode: "insensitive"`), so the
  // lookup key is lowercased here to agree with it.
  const existingTypeByName = new Map(
    existingCustomFields.map((field) => [
      field.name.trim().toLowerCase(),
      field.type,
    ])
  );

  const errors: ImportRowError[] = [];

  /**
   * Column headers already reported as faulty. A bad header is a property of
   * the file, not of a row, so it is reported once — reporting it per row would
   * fill the whole error budget with copies of one sentence and bury every
   * other problem in the file.
   */
  const reportedHeaderProblems = new Set<string>();

  /**
   * Custom field types declared by headers in THIS file, keyed by lowercased
   * field name.
   *
   * Kept apart from `existingTypeByName` so the two conflicts read differently:
   * one field named by two headers with different types is a contradiction
   * inside the file, and telling the user it "already exists in this workspace"
   * would be false.
   */
  const inFileTypeByName = new Map<string, { type: string; header: string }>();

  for (const [index, asset] of data.entries()) {
    const row = index + 2;
    const rowLabel = `asset "${asset.title}"`;

    // ── quantity-tracked columns ──────────────────────────────────────
    let assetType: AssetType | undefined;
    try {
      assetType = validateQtyTrackedFields(
        {
          type: cell(asset, "type"),
          quantity: cell(asset, "quantity"),
          minQuantity: cell(asset, "minQuantity"),
          unitOfMeasure: cell(asset, "unitOfMeasure"),
          consumptionType: cell(asset, "consumptionType"),
        },
        { kind: "create" },
        { rowLabel, additionalData: { assetKey: asset.key } }
      ).type;
    } catch (cause) {
      if (!isLikeShelfError(cause)) {
        throw cause;
      }
      errors.push({
        row,
        title: cause.title ?? "Invalid row",
        message: cause.message,
      });
    }

    // ── asset model is INDIVIDUAL-only ────────────────────────────────
    // A model represents N distinguishable units of one template; a
    // QUANTITY_TRACKED asset is a single stock pool, so the two cannot combine.
    if (assetType === AssetType.QUANTITY_TRACKED && asset.assetModel?.trim()) {
      errors.push({
        row,
        title: "Asset model not allowed",
        message: `Asset "${asset.title}": asset models can only be linked to individually tracked assets. Remove the assetModel cell, or set the type column to INDIVIDUAL.`,
      });
    }

    // ── custom field values ───────────────────────────────────────────
    for (const key of Object.keys(asset)) {
      if (!key.startsWith("cf:")) {
        continue;
      }

      const definition = getDefinitionFromCsvHeader(key);
      const fieldKey = definition.name.trim().toLowerCase();

      // The header's type is cast, never checked, by the shared parser, so an
      // unknown one reaches `db.customField.create` as an invalid enum member.
      if (!CUSTOM_FIELD_TYPE_SET.has(definition.type)) {
        if (!reportedHeaderProblems.has(key)) {
          reportedHeaderProblems.add(key);
          errors.push({
            row: 0,
            title: "Unknown custom field type",
            message: `Column "${key}": "${definition.type.toLowerCase()}" is not a custom field type. Use one of: ${CUSTOM_FIELD_TYPES.map(
              (type) => type.toLowerCase()
            ).join(", ")}.`,
          });
        }
        continue;
      }

      const existingType = existingTypeByName.get(fieldKey);

      // `upsertCustomField` refuses to change an existing field's type, so a
      // contradicting header fails the import however well-formed its values
      // are. Reporting it here keeps that refusal from aborting mid-import.
      if (existingType && existingType !== definition.type) {
        if (!reportedHeaderProblems.has(key)) {
          reportedHeaderProblems.add(key);
          errors.push({
            row: 0,
            title: "Custom field type mismatch",
            message: `Column "${key}": custom field "${
              definition.name
            }" already exists in this workspace with type ${existingType}. Change the header to type:${existingType.toLowerCase()}, or rename the column.`,
          });
        }
        continue;
      }

      // Two headers naming one field with different types are drafted
      // separately by `createCustomFieldsIfNotExists`, which keys by the whole
      // header string; `upsertCustomField` then creates the first and rejects
      // the second. Matching types are left alone — the importer accepts them,
      // and refusing here would make this stricter than what it guards.
      const inFile = inFileTypeByName.get(fieldKey);
      if (inFile && inFile.type !== definition.type) {
        if (!reportedHeaderProblems.has(key)) {
          reportedHeaderProblems.add(key);
          errors.push({
            row: 0,
            title: "Conflicting custom field columns",
            message: `Columns "${inFile.header}" and "${key}" both define custom field "${definition.name}", but with different types. Give them the same type, or rename one column.`,
          });
        }
        continue;
      }
      if (!inFile) {
        inFileTypeByName.set(fieldKey, {
          type: definition.type,
          header: key,
        });
      }

      try {
        buildCustomFieldValue({ raw: asset[key] }, definition);
      } catch (cause) {
        errors.push({
          row,
          title: "Invalid custom field value",
          message: isLikeShelfError(cause)
            ? cause.message
            : `Custom field "${
                definition.name
              }" has a value this column's type cannot accept: "${String(
                asset[key]
              )}".`,
        });
      }
    }
  }

  // The scan always runs to the end: stopping at the reporting limit would make
  // the count equal the limit, and the file's real size is what the import page
  // reports. `MAX_CONTENT_IMPORT_ROWS` already bounds the work.
  return {
    errors: errors.slice(0, MAX_REPORTED_ROW_ERRORS),
    totalErrors: errors.length,
  };
}
