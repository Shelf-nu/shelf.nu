/**
 * @file Pure diff computation logic for bulk asset update via CSV import.
 * Contains header analysis, field-by-field comparison, and CSV-to-asset
 * diff computation. All functions here are pure (no database calls) and
 * can be tested without mocking.
 *
 * @see {@link file://./import-update-types.ts} Types and constants
 * @see {@link file://./import-update.server.ts} Orchestration (server)
 */
import type { CustomField } from "@prisma/client";
import { isLikeShelfError, type ShelfError } from "~/utils/error";
import type {
  AssetChangePreview,
  AssetForUpdate,
  FieldChange,
  HeaderAnalysis,
  IdentifierColumn,
  ParsedColumn,
  ShelfAssetCustomFieldValueType,
  UpdatePreview,
} from "./import-update-types";
import {
  EXPORT_HEADER_TO_FIELD_MAP,
  IDENTIFIER_COLUMNS,
  UPDATABLE_CF_TYPES,
  UPDATABLE_FIELDS,
} from "./import-update-types";

// ---------------------------------------------------------------------------
// Number / Boolean Normalization
// ---------------------------------------------------------------------------

/**
 * Strips currency symbols and normalizes both US and European number formats
 * into a plain decimal number string that `parseFloat()` can handle.
 *
 * @param value - Raw string from CSV cell (may contain currency symbols, thousand separators)
 * @returns Normalized decimal string ready for `Number()` or `parseFloat()`
 *
 * @example
 * normalizeExportedCurrencyValue("$1,234.56")  // "1234.56"
 * normalizeExportedCurrencyValue("1.234,56")   // "1234.56"
 * normalizeExportedCurrencyValue("5454,5")     // "5454.5"
 * normalizeExportedCurrencyValue("€100")       // "100"
 */
export function normalizeExportedCurrencyValue(value: string): string {
  // Strip common currency symbols
  let v = value.replace(/[$€£¥₹₽₩₪₫฿₴₦₲₵₡₺₨]/g, "").trim();

  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");

  if (lastComma > lastDot) {
    // Comma appears after dot (or no dot) — comma might be decimal separator
    const digitsAfterComma = v.length - lastComma - 1;
    if (digitsAfterComma === 3) {
      // Ambiguous: "1,234" — treat as US thousand separator
      // (our export uses US format, so this is the safe default)
      v = v.replace(/,/g, "");
    } else {
      // European decimal: "5454,5" or "1.234,56"
      v = v.replace(/\./g, ""); // strip dots (thousand separators)
      v = v.replace(",", "."); // replace decimal comma with dot
    }
  } else {
    // Dot appears after comma (US: "1,234.56") or only dots/no separators
    v = v.replace(/,/g, ""); // strip commas (thousand separators)
  }

  return v;
}

/**
 * Normalizes a Yes/No string to a boolean. Case-insensitive, trims whitespace.
 *
 * @param value - Raw string from CSV cell
 * @returns `true` for "yes", `false` for "no", `undefined` for anything else
 */
export function parseYesNo(value: string): boolean | undefined {
  const lower = value.trim().toLowerCase();
  if (lower === "yes") return true;
  if (lower === "no") return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// Header Analysis
// ---------------------------------------------------------------------------

/**
 * Analyzes CSV headers from an Asset Index export and classifies them
 * for the update import flow.
 *
 * Export CSV headers use human-readable labels from `columnsLabelsMap`
 * (e.g. "Name", "Category", "Available to book").
 * Custom field headers are the field name directly (e.g. "Purchase Date").
 *
 * @param headers - Array of header strings from the CSV first row
 * @param orgCustomFields - Organization's custom field definitions
 * @returns Classification of each header into updatable, ignored, or unrecognized
 */
export function analyzeUpdateHeaders(
  headers: string[],
  orgCustomFields: Pick<CustomField, "id" | "name" | "type">[]
): HeaderAnalysis {
  const updatableColumns: ParsedColumn[] = [];
  const ignoredColumns: string[] = [];
  const unrecognizedColumns: string[] = [];

  // Find all available identifier columns (priority order)
  const headersTrimmed = headers.map((h) => h.trim());
  const foundIdCols: IdentifierColumn[] = [];
  for (const idCol of IDENTIFIER_COLUMNS) {
    const idx = headersTrimmed.indexOf(idCol.header);
    if (idx >= 0) {
      foundIdCols.push({
        index: idx,
        dbField: idCol.dbField,
        header: idCol.header,
      });
    }
  }

  // Primary = highest priority; fallback = next available
  const primaryId = foundIdCols[0];
  const idColumnIndex = primaryId?.index ?? -1;
  const idDbField: HeaderAnalysis["idDbField"] =
    primaryId?.dbField ?? "sequentialId";
  const idColumnHeader = primaryId?.header ?? "";
  const fallbackId = foundIdCols.length > 1 ? foundIdCols[1] : null;

  // Set of internal field names used as identifiers — skip them during
  // column classification so they aren't treated as updatable or ignored.
  // Typed as `Set<string>` so it accepts the now-widened
  // `EXPORT_HEADER_TO_FIELD_MAP` lookup result (the map gained
  // import-only aliases that aren't in `ColumnLabelKey`).
  const identifierFields = new Set<string>(
    IDENTIFIER_COLUMNS.map((c) => c.internalField)
  );

  // Build a lookup of org custom fields by name (case-insensitive)
  const cfByName = new Map(
    orgCustomFields.map((cf) => [cf.name.toLowerCase(), cf])
  );

  for (let i = 0; i < headers.length; i++) {
    const header = headersTrimmed[i];
    if (!header) continue;

    // Check if it's a known fixed-field header via reverse map
    const internalField = EXPORT_HEADER_TO_FIELD_MAP[header];

    if (internalField) {
      // Skip identifier columns — they're handled above
      if (identifierFields.has(internalField)) {
        // If this isn't the one we picked as the matcher, list it as ignored
        if (i !== idColumnIndex) {
          ignoredColumns.push(header);
        }
        continue;
      }

      if (UPDATABLE_FIELDS.has(internalField)) {
        updatableColumns.push({
          csvHeader: header,
          internalKey: internalField,
          kind: "core",
          csvIndex: i,
        });
      } else {
        // Known field but not updatable (Status, Kit, etc.) — treat as ignored
        ignoredColumns.push(header);
      }
    } else {
      // Not a fixed field header — check if it's a custom field name
      const cf = cfByName.get(header.toLowerCase());
      if (cf) {
        if (UPDATABLE_CF_TYPES.has(cf.type)) {
          updatableColumns.push({
            csvHeader: header,
            internalKey: `cf:${cf.name}`,
            kind: "customField",
            csvIndex: i,
            cfDef: {
              name: cf.name,
              type: cf.type,
              helpText: "",
              required: false,
              active: true,
            },
          });
        } else {
          ignoredColumns.push(
            `${header} (${cf.type.toLowerCase()} fields not supported for update)`
          );
        }
      } else {
        // Unknown column — don't block the import, just skip it
        unrecognizedColumns.push(header);
      }
    }
  }

  // Build column index map for updatable columns using the original
  // loop index (stored in csvIndex) to handle duplicate header names
  const columnIndexMap = new Map<number, ParsedColumn>();
  for (const col of updatableColumns) {
    if (col.csvIndex !== undefined) {
      columnIndexMap.set(col.csvIndex, col);
    }
  }

  return {
    updatableColumns,
    ignoredColumns,
    unrecognizedColumns,
    idColumnIndex,
    idDbField,
    idColumnHeader,
    fallbackId,
    columnIndexMap,
  };
}

// ---------------------------------------------------------------------------
// Field Comparison
// ---------------------------------------------------------------------------

/**
 * Compares a core field value between the CSV cell and the existing asset.
 *
 * @param fieldKey - Internal field key (e.g. "name", "category", "tags")
 * @param csvValue - Trimmed value from the CSV cell
 * @param asset - Existing asset loaded from the database
 * @param displayName - Human-readable column name for the change record
 * @returns A `FieldChange` if the value differs, or `null` if unchanged
 */
export function compareCoreField(
  fieldKey: string,
  csvValue: string,
  asset: AssetForUpdate,
  displayName: string
): FieldChange | null {
  switch (fieldKey) {
    case "name": {
      const current = asset.title;
      if (csvValue !== current) {
        return {
          field: displayName,
          currentValue: current,
          newValue: csvValue,
        };
      }
      return null;
    }

    case "category": {
      const current = asset.category?.name ?? "Uncategorized";
      if (csvValue.toLowerCase() !== current.toLowerCase()) {
        return {
          field: displayName,
          currentValue: current,
          newValue: csvValue,
        };
      }
      return null;
    }

    case "location": {
      const current = asset.location?.name ?? "";
      if (csvValue.toLowerCase() !== current.toLowerCase()) {
        return {
          field: displayName,
          currentValue: current || "(none)",
          newValue: csvValue,
        };
      }
      return null;
    }

    case "tags": {
      const currentTags = asset.tags
        .map((t) => t.name)
        .sort((a, b) => a.localeCompare(b));
      const csvTags = csvValue
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      const currentStr = currentTags.join(", ");
      const csvStr = csvTags.join(", ");

      // Case-insensitive set comparison
      const currentSet = new Set(currentTags.map((t) => t.toLowerCase()));
      const csvSet = new Set(csvTags.map((t) => t.toLowerCase()));

      if (
        currentSet.size !== csvSet.size ||
        ![...currentSet].every((t) => csvSet.has(t))
      ) {
        return {
          field: displayName,
          currentValue: currentStr || "(none)",
          newValue: csvStr,
        };
      }
      return null;
    }

    case "valuation": {
      const normalized = normalizeExportedCurrencyValue(csvValue);
      const csvNum = Number(normalized);
      // Number() rejects partial matches like "12abc" (unlike parseFloat)
      // Also reject Infinity/-Infinity
      if (!Number.isFinite(csvNum)) {
        return {
          field: displayName,
          currentValue: String(asset.valuation ?? "(none)"),
          newValue: csvValue,
          warning: `"${csvValue}" is not a valid number`,
        };
      }
      // Distinguish null (no valuation) from 0 (explicit zero)
      if (asset.valuation == null) {
        // Any valid number (including 0) is a change when current is empty
        return {
          field: displayName,
          currentValue: "(none)",
          newValue: String(csvNum),
        };
      }
      if (Math.abs(csvNum - asset.valuation) > 0.001) {
        return {
          field: displayName,
          currentValue: String(asset.valuation),
          newValue: String(csvNum),
        };
      }
      return null;
    }

    case "availableToBook": {
      const csvBool = parseYesNo(csvValue);
      if (csvBool === undefined) {
        return {
          field: displayName,
          currentValue: asset.availableToBook ? "Yes" : "No",
          newValue: csvValue,
          warning: `Unrecognized value "${csvValue}" — expected "Yes" or "No"`,
        };
      }
      if (csvBool !== asset.availableToBook) {
        return {
          field: displayName,
          currentValue: asset.availableToBook ? "Yes" : "No",
          newValue: csvBool ? "Yes" : "No",
        };
      }
      return null;
    }

    // ── Qty-tracked + AssetModel preview comparisons ──────────────────
    // These fields are ONLY meaningful on the type that owns them:
    // qty / minQuantity / unitOfMeasure / consumptionType apply to
    // QUANTITY_TRACKED; assetModel applies to INDIVIDUAL. When the cell
    // exists on the "wrong" type the row's other cells still apply —
    // the actual drop happens in the apply path. The preview here
    // surfaces the change for the matching type and silently no-ops
    // for the other so the diff doesn't show ghost "changes" the
    // import will silently ignore.
    case "quantity": {
      // Silently no-op on INDIVIDUAL rows — the apply path drops these.
      if (asset.type !== "QUANTITY_TRACKED") return null;
      const currentQty = asset.quantity ?? 0;
      const n = Number(csvValue);
      if (!Number.isInteger(n) || n < 0) {
        return {
          field: displayName,
          currentValue: String(currentQty),
          newValue: csvValue,
          warning: `"${csvValue}" is not a valid quantity (must be a non-negative whole number)`,
        };
      }
      if (n !== currentQty) {
        return {
          field: displayName,
          currentValue: String(currentQty),
          newValue: String(n),
        };
      }
      return null;
    }

    case "minQuantity": {
      if (asset.type !== "QUANTITY_TRACKED") return null;
      const n = Number(csvValue);
      if (!Number.isInteger(n) || n < 0) {
        return {
          field: displayName,
          currentValue:
            asset.minQuantity != null ? String(asset.minQuantity) : "(none)",
          newValue: csvValue,
          warning: `"${csvValue}" is not a valid min quantity (must be a non-negative whole number)`,
        };
      }
      if (n !== (asset.minQuantity ?? null)) {
        return {
          field: displayName,
          currentValue:
            asset.minQuantity != null ? String(asset.minQuantity) : "(none)",
          newValue: String(n),
        };
      }
      return null;
    }

    case "unitOfMeasure": {
      if (asset.type !== "QUANTITY_TRACKED") return null;
      const current = asset.unitOfMeasure ?? "";
      if (csvValue !== current) {
        return {
          field: displayName,
          currentValue: current || "(none)",
          newValue: csvValue,
        };
      }
      return null;
    }

    case "consumptionType": {
      if (asset.type !== "QUANTITY_TRACKED") return null;
      const upper = csvValue.toUpperCase();
      if (upper !== "ONE_WAY" && upper !== "TWO_WAY") {
        return {
          field: displayName,
          currentValue: asset.consumptionType ?? "(none)",
          newValue: csvValue,
          warning: `Unrecognized consumption type "${csvValue}" — must be "ONE_WAY" or "TWO_WAY"`,
        };
      }
      if (upper !== asset.consumptionType) {
        return {
          field: displayName,
          currentValue: asset.consumptionType ?? "(none)",
          newValue: upper,
        };
      }
      return null;
    }

    case "assetModel": {
      // QUANTITY_TRACKED rows: emit a warning-marked FieldChange instead
      // of swallowing the cell silently. The apply layer skips fields
      // with `.warning` set (mirrors invalid-quantity / invalid-enum
      // behaviour) AND the apply layer's per-row post-pass forwards the
      // text into `result.warnings`, so the user sees the dropped cell
      // in both the per-row summary AND the top-level "Warnings" pill.
      // Previously this returned `null`, which meant a row carrying
      // ONLY an assetModel cell on a QUANTITY_TRACKED asset landed in
      // `skippedAssets` with the generic "No changes detected" reason —
      // hiding from the user that their intent didn't take effect.
      if (asset.type !== "INDIVIDUAL") {
        return {
          field: displayName,
          currentValue: "(quantity-tracked)",
          newValue: csvValue,
          warning:
            "Asset model can only be set on INDIVIDUAL assets — this asset is quantity-tracked, so the cell was ignored.",
        };
      }
      // Preview can't pre-resolve the model name → id; surface the cell
      // value vs current model id so the user sees a change is queued.
      // The apply path does the real resolution.
      const current = asset.assetModelId ?? "";
      if (csvValue !== current) {
        return {
          field: displayName,
          currentValue: current || "(none)",
          newValue: csvValue,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Compares a custom field value between the CSV cell and the existing asset.
 *
 * @param cfDef - Custom field definition (name, type)
 * @param csvValue - Trimmed value from the CSV cell
 * @param asset - Existing asset loaded from the database
 * @param displayName - Human-readable column name for the change record
 * @returns A `FieldChange` if the value differs, or `null` if unchanged
 */
export function compareCustomField(
  cfDef: NonNullable<ParsedColumn["cfDef"]>,
  csvValue: string,
  asset: AssetForUpdate,
  displayName: string
): FieldChange | null {
  // Find the existing custom field value on this asset
  const existingCfv = asset.customFields.find(
    (cf) => cf.customField.name.toLowerCase() === cfDef.name.toLowerCase()
  );

  const existingValue = existingCfv?.value as
    | ShelfAssetCustomFieldValueType["value"]
    | undefined;

  const currentRaw = existingValue?.raw;
  const currentStr = currentRaw != null ? String(currentRaw) : "";

  switch (cfDef.type) {
    case "TEXT":
    case "OPTION": {
      if (csvValue !== currentStr) {
        return {
          field: displayName,
          currentValue: currentStr || "(empty)",
          newValue: csvValue,
        };
      }
      return null;
    }

    case "BOOLEAN": {
      const csvBool = parseYesNo(csvValue);
      if (csvBool === undefined) {
        return {
          field: displayName,
          currentValue: currentStr || "(empty)",
          newValue: csvValue,
          warning: `Unrecognized value "${csvValue}" — expected "Yes" or "No"`,
        };
      }
      // Treat truly missing values as undefined so "No" is detected as a change from empty
      const hasStoredValue =
        existingValue?.valueBoolean !== undefined &&
        existingValue?.valueBoolean !== null &&
        currentRaw !== undefined &&
        currentRaw !== null &&
        currentRaw !== "";
      if (!hasStoredValue) {
        // No existing value — any CSV boolean is a change
        return {
          field: displayName,
          currentValue: "(empty)",
          newValue: csvBool ? "Yes" : "No",
        };
      }
      const currentBool =
        existingValue?.valueBoolean ??
        (typeof currentRaw === "string"
          ? currentRaw.toLowerCase() === "yes"
          : Boolean(currentRaw));
      if (csvBool !== currentBool) {
        return {
          field: displayName,
          currentValue: currentBool ? "Yes" : "No",
          newValue: csvBool ? "Yes" : "No",
        };
      }
      return null;
    }

    case "DATE": {
      // Export format: yyyy-MM-dd
      // Current raw value is also stored as the date string
      const currentDate = currentStr ? currentStr.substring(0, 10) : "";
      if (csvValue !== currentDate) {
        // Validate format AND that the date is a real calendar date
        // (new Date normalizes overflow — e.g. Feb 31 → Mar 3 — so we
        // must check that the parsed date matches the original input)
        let isValidDate = false;
        if (/^\d{4}-\d{2}-\d{2}$/.test(csvValue)) {
          const [y, m, d] = csvValue.split("-").map(Number);
          const parsed = new Date(Date.UTC(y, m - 1, d));
          isValidDate =
            parsed.getUTCFullYear() === y &&
            parsed.getUTCMonth() === m - 1 &&
            parsed.getUTCDate() === d;
        }
        return {
          field: displayName,
          currentValue: currentDate || "(empty)",
          newValue: csvValue,
          ...(!isValidDate && {
            warning: `Invalid date format "${csvValue}" — must be YYYY-MM-DD (e.g. 2024-06-23)`,
          }),
        };
      }
      return null;
    }

    case "AMOUNT":
    case "NUMBER": {
      const normalizedCsv = normalizeExportedCurrencyValue(csvValue);
      const csvNum = Number(normalizedCsv);
      if (!Number.isFinite(csvNum)) {
        return {
          field: displayName,
          currentValue: currentStr || "(empty)",
          newValue: csvValue,
          warning: `"${csvValue}" is not a valid number`,
        };
      }
      // Distinguish empty/null from numeric 0
      const currentNum = currentStr ? Number(currentStr) : NaN;
      if (isNaN(currentNum)) {
        // Current is empty — any valid number (including 0) is a change
        return {
          field: displayName,
          currentValue: "(empty)",
          newValue: String(csvNum),
        };
      }
      if (Math.abs(csvNum - currentNum) > 0.001) {
        return {
          field: displayName,
          currentValue: String(currentNum),
          newValue: String(csvNum),
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Clearing Detection
// ---------------------------------------------------------------------------

/** Fields that cannot be cleared (required or boolean-only) */
const NON_CLEARABLE_CORE_FIELDS = new Set(["name", "availableToBook"]);

/**
 * Detects when an empty CSV cell should clear an existing field value.
 * Returns a FieldChange with `clearing: true` if the asset currently has
 * a value for this field. Returns null if the field is already empty,
 * is exempt from clearing (name, availableToBook), or is a boolean custom field.
 *
 * @param column - The parsed column definition
 * @param asset - The existing asset from the database
 * @param displayName - Human-readable column name for the change record
 * @returns A clearing FieldChange, or null if no clearing needed
 */
export function detectClearing(
  column: ParsedColumn,
  asset: AssetForUpdate,
  displayName: string
): FieldChange | null {
  if (column.kind === "core") {
    // Name and availableToBook cannot be cleared
    if (NON_CLEARABLE_CORE_FIELDS.has(column.internalKey)) {
      return null;
    }

    switch (column.internalKey) {
      case "category": {
        if (asset.category?.name) {
          return {
            field: displayName,
            currentValue: asset.category.name,
            newValue: "(empty)",
            clearing: true,
          };
        }
        return null;
      }
      case "location": {
        if (asset.location?.name) {
          return {
            field: displayName,
            currentValue: asset.location.name,
            newValue: "(empty)",
            clearing: true,
          };
        }
        return null;
      }
      case "tags": {
        if (asset.tags.length > 0) {
          const currentStr = asset.tags
            .map((t) => t.name)
            .sort((a, b) => a.localeCompare(b))
            .join(", ");
          return {
            field: displayName,
            currentValue: currentStr,
            newValue: "(empty)",
            clearing: true,
          };
        }
        return null;
      }
      case "valuation": {
        if (asset.valuation != null) {
          return {
            field: displayName,
            currentValue: String(asset.valuation),
            newValue: "(empty)",
            clearing: true,
          };
        }
        return null;
      }
      default:
        return null;
    }
  }

  if (column.kind === "customField" && column.cfDef) {
    // Boolean custom fields cannot be cleared (must be Yes/No)
    if (column.cfDef.type === "BOOLEAN") {
      return null;
    }

    // Check if the asset has a value for this custom field
    const existingCfv = asset.customFields.find(
      (cf) =>
        cf.customField.name.toLowerCase() === column.cfDef!.name.toLowerCase()
    );
    const existingValue = existingCfv?.value as
      | ShelfAssetCustomFieldValueType["value"]
      | undefined;
    const currentRaw = existingValue?.raw;

    if (currentRaw != null && currentRaw !== "") {
      return {
        field: displayName,
        currentValue: String(currentRaw),
        newValue: "(empty)",
        clearing: true,
      };
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Diff Computation
// ---------------------------------------------------------------------------

/**
 * Computes field-by-field diffs between CSV rows and existing assets.
 * Handles duplicate detection, fallback identifier matching, and
 * cross-validation of identifiers.
 *
 * @param csvData - Full CSV data array (first row is headers)
 * @param headerAnalysis - Result of `analyzeUpdateHeaders()`
 * @param existingAssets - Assets keyed by primary identifier
 * @param fallbackAssets - Assets keyed by fallback identifier (optional)
 * @returns Diff results: assets to update, skipped, and failed rows
 */
export function computeAssetDiffs({
  csvData,
  headerAnalysis,
  existingAssets,
  fallbackAssets,
}: {
  csvData: string[][];
  headerAnalysis: HeaderAnalysis;
  existingAssets: Map<string, AssetForUpdate>;
  /** Assets keyed by fallback identifier (e.g. UUID when primary is Asset ID) */
  fallbackAssets?: Map<string, AssetForUpdate>;
}): Pick<
  UpdatePreview,
  "totalRows" | "assetsToUpdate" | "skippedAssets" | "failedRows"
> {
  const dataRows = csvData.slice(1); // skip header row
  const assetsToUpdate: AssetChangePreview[] = [];
  const skippedAssets: UpdatePreview["skippedAssets"] = [];
  const failedRows: UpdatePreview["failedRows"] = [];

  // Track seen IDs to detect duplicates
  const seenIds = new Map<string, number>(); // id → first row number (1-based)

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx];
    const rowNumber = rowIdx + 2; // 1-based, accounting for header row

    // Extract asset ID — try primary identifier, fall back to secondary
    let assetId = row[headerAnalysis.idColumnIndex]?.trim() ?? "";
    let existingAsset = assetId ? existingAssets.get(assetId) : undefined;

    // If primary is blank or not found, try fallback identifier (e.g. UUID)
    if (!existingAsset && headerAnalysis.fallbackId && fallbackAssets) {
      const fallbackValue = row[headerAnalysis.fallbackId.index]?.trim() ?? "";
      if (fallbackValue) {
        // Always set assetId so failure reports show the actual identifier
        if (!assetId) assetId = fallbackValue;
        existingAsset = fallbackAssets.get(fallbackValue);
        if (existingAsset) {
          assetId = fallbackValue; // use fallback as the match key
        }
      }
    }

    if (!assetId) {
      failedRows.push({
        rowNumber,
        id: "",
        reason: "Missing asset ID",
      });
      continue;
    }

    if (!existingAsset) {
      failedRows.push({
        rowNumber,
        id: assetId,
        reason: "Asset not found in your organization",
      });
      continue;
    }

    // Check for duplicate assets by canonical UUID (not CSV identifier string)
    const firstSeenRow = seenIds.get(existingAsset.id);
    if (firstSeenRow !== undefined) {
      failedRows.push({
        rowNumber,
        id: assetId,
        reason: `Duplicate ID — already processed in row ${firstSeenRow}`,
      });
      continue;
    }

    // Cross-check: if both identifier columns exist and have values,
    // verify they point to the same asset to prevent accidental mismatch.
    // Also reject if one identifier is populated but unresolved.
    // NOTE: seenIds is set AFTER this check so a failed cross-check
    // doesn't block a later valid row for the same asset.
    if (headerAnalysis.fallbackId && fallbackAssets) {
      const primaryValue = row[headerAnalysis.idColumnIndex]?.trim() ?? "";
      const fallbackValue = row[headerAnalysis.fallbackId.index]?.trim() ?? "";
      if (primaryValue && fallbackValue) {
        const primaryAsset = existingAssets.get(primaryValue);
        const fallbackAsset = fallbackAssets.get(fallbackValue);

        // Reject if one identifier resolved but the other didn't
        if (primaryAsset && !fallbackAsset) {
          failedRows.push({
            rowNumber,
            id: assetId,
            reason: `ID "${fallbackValue}" not found — but Asset ID "${primaryValue}" resolved. Check for typos.`,
          });
          continue;
        }
        if (!primaryAsset && fallbackAsset) {
          failedRows.push({
            rowNumber,
            id: assetId,
            reason: `Asset ID "${primaryValue}" not found — but ID "${fallbackValue}" resolved. Check for typos.`,
          });
          continue;
        }

        // Reject if both resolved but to different assets
        if (
          primaryAsset &&
          fallbackAsset &&
          fallbackAsset.id !== primaryAsset.id
        ) {
          failedRows.push({
            rowNumber,
            id: assetId,
            reason: `Identifier mismatch — Asset ID "${primaryValue}" and ID "${fallbackValue}" point to different assets`,
          });
          continue;
        }
      }
    }

    // Mark asset as seen only after all identifier checks pass
    seenIds.set(existingAsset.id, rowNumber);

    // Compute per-field diffs
    const changes: FieldChange[] = [];

    for (const [colIdx, column] of headerAnalysis.columnIndexMap) {
      const csvValue = row[colIdx]?.trim() ?? "";
      const isEmpty = csvValue === "" || csvValue === '""';

      // Empty cell handling: detect clearing (had value → now empty)
      // Fields exempt from clearing: name (required), availableToBook (boolean)
      if (isEmpty) {
        const clearChange = detectClearing(
          column,
          existingAsset,
          column.csvHeader
        );
        if (clearChange) {
          changes.push(clearChange);
        }
        continue;
      }

      if (column.kind === "core") {
        const change = compareCoreField(
          column.internalKey,
          csvValue,
          existingAsset,
          column.csvHeader
        );
        if (change) {
          changes.push(change);
        }
      } else if (column.kind === "customField" && column.cfDef) {
        const change = compareCustomField(
          column.cfDef,
          csvValue,
          existingAsset,
          column.csvHeader
        );
        if (change) {
          changes.push(change);
        }
      }
    }

    if (changes.length === 0) {
      skippedAssets.push({
        id: assetId,
        title: existingAsset.title,
        reason: "No changes detected",
      });
    } else {
      assetsToUpdate.push({
        id: assetId,
        assetDbId: existingAsset.id,
        title: existingAsset.title,
        changes,
      });
    }
  }

  return {
    totalRows: dataRows.length,
    assetsToUpdate,
    skippedAssets,
    failedRows,
  };
}

// ---------------------------------------------------------------------------
// Failure Reporting
// ---------------------------------------------------------------------------

/**
 * Builds a diagnosable per-row failure message for the bulk-update report.
 *
 * When `updateAsset` hits an unexpected database error it rethrows a *generic*
 * ShelfError whose `message` is a fixed fallback ("We could not create or
 * update this Asset. Please try again or contact support.") and which is not
 * captured to Sentry. That fallback hides the real reason (e.g. a Prisma error
 * code), so a failed bulk-import row currently carries no diagnosable signal.
 *
 * The original error is preserved on the ShelfError's `cause`. When that
 * underlying error is present, we append its code + first line so the
 * downloadable report explains *why* the row failed instead of repeating the
 * opaque fallback.
 *
 * @param cause - The error thrown while applying a single row's update
 * @returns A report-friendly message, including the underlying reason when available
 */
export function describeBulkUpdateRowFailure(cause: unknown): string {
  const baseMessage = isLikeShelfError(cause)
    ? (cause as ShelfError).message
    : cause instanceof Error
    ? cause.message
    : "Unknown error";

  // Unwrap one level: the generic ShelfError stores the original error (often a
  // Prisma error) on `.cause`.
  const underlying = isLikeShelfError(cause)
    ? (cause as ShelfError).cause
    : null;

  if (underlying instanceof Error) {
    const code =
      "code" in underlying &&
      typeof (underlying as { code?: unknown }).code === "string"
        ? `${(underlying as { code: string }).code}: `
        : "";
    // Prisma messages prefix the reason with an "Invalid `prisma...` invocation"
    // line plus a file path; the actionable reason is the LAST non-empty line.
    // Surface only that, so the report stays concise and doesn't leak the
    // invocation preamble or internal paths.
    const lines = underlying.message
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const detail = (lines[lines.length - 1] ?? "").slice(0, 300);
    if (detail && detail !== baseMessage) {
      return `${baseMessage} (${code}${detail})`;
    }
  }

  return baseMessage;
}
