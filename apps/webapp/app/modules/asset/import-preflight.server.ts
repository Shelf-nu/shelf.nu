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
import { AssetType } from "@prisma/client";

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
 * The most row errors carried back to the browser. A file where every row is
 * wrong would otherwise produce a response measured in megabytes; the true
 * count travels separately as `totalErrors`.
 */
export const MAX_REPORTED_ROW_ERRORS = 100;

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
 * @param args.existingCustomFields - Active custom fields already in the
 *   workspace, used to catch a header whose declared type contradicts one
 * @returns Every problem found, capped at {@link MAX_REPORTED_ROW_ERRORS}.
 *   Empty means the file is safe to import.
 */
export function validateContentImportRows({
  data,
  existingCustomFields,
}: {
  data: CreateAssetFromContentImportPayload[];
  existingCustomFields: Pick<CustomField, "name" | "type">[];
}): ImportRowError[] {
  if (data.length > MAX_CONTENT_IMPORT_ROWS) {
    return [
      {
        row: 0,
        title: "File too large",
        message: `This file has ${data.length} rows, but the maximum is ${MAX_CONTENT_IMPORT_ROWS}. Please split it into smaller files and import them one at a time.`,
      },
    ];
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
   * Column headers already reported as contradicting an existing custom field.
   * A bad header is a property of the file, not of a row, so it is reported
   * once — reporting it per row would fill the whole error budget with copies
   * of one sentence and bury every other problem in the file.
   */
  const reportedHeaderMismatches = new Set<string>();

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
        message: `Asset "${asset.title}": models can only be linked to INDIVIDUAL assets. Remove the assetModel cell or change type to INDIVIDUAL.`,
      });
    }

    // ── custom field values ───────────────────────────────────────────
    for (const key of Object.keys(asset)) {
      if (!key.startsWith("cf:")) {
        continue;
      }

      const definition = getDefinitionFromCsvHeader(key);
      const existingType = existingTypeByName.get(
        definition.name.trim().toLowerCase()
      );

      // `upsertCustomField` refuses to change an existing field's type, so a
      // contradicting header fails the import however well-formed its values
      // are. Reporting it here keeps that refusal from aborting mid-import.
      if (existingType && existingType !== definition.type) {
        if (!reportedHeaderMismatches.has(key)) {
          reportedHeaderMismatches.add(key);
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

    if (errors.length >= MAX_REPORTED_ROW_ERRORS) {
      return errors.slice(0, MAX_REPORTED_ROW_ERRORS);
    }
  }

  return errors;
}
