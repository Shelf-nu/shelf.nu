import type { Asset, CustomField, User } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  updateAsset,
  updateAssetBookingAvailability,
} from "~/modules/asset/service.server";
import type {
  ShelfAssetCustomFieldValueType,
  UpdateAssetPayload,
} from "~/modules/asset/types";
import {
  columnsLabelsMap,
  type ColumnLabelKey,
} from "~/modules/asset-index-settings/helpers";
import { buildCustomFieldValue } from "~/utils/custom-fields";
import { ShelfError, isLikeShelfError } from "~/utils/error";
import { getRandomColor } from "~/utils/get-random-color";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Reverse mapping: exported CSV header label → internal field name.
 * Built from columnsLabelsMap. E.g. "Name" → "name", "Category" → "category"
 */
const EXPORT_HEADER_TO_FIELD_MAP: Record<string, ColumnLabelKey> =
  Object.fromEntries(
    Object.entries(columnsLabelsMap).map(([key, label]) => [label, key])
  ) as Record<string, ColumnLabelKey>;

/** Fields that v1 supports updating (core metadata). */
const UPDATABLE_FIELDS = new Set<string>([
  "name",
  "category",
  "location",
  "tags",
  "valuation",
  "availableToBook",
]);

/** Custom field types that are safe for round-trip update. */
const UPDATABLE_CF_TYPES = new Set<string>([
  "TEXT",
  "BOOLEAN",
  "DATE",
  "OPTION",
  "NUMBER",
  "AMOUNT",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldChange {
  /** Human-readable field name (e.g. "Name", "Category", "cf:Serial Number") */
  field: string;
  currentValue: string;
  newValue: string;
  /** If set, this value has a format problem that will cause the update to fail */
  warning?: string;
}

export interface AssetChangePreview {
  /** The sequential ID from the CSV (e.g. "SAM-0022") */
  id: string;
  /** The internal UUID — needed for updateAsset() calls */
  assetDbId: string;
  title: string;
  changes: FieldChange[];
}

export interface UpdatePreview {
  totalRows: number;
  assetsToUpdate: AssetChangePreview[];
  skippedAssets: { id: string; title: string; reason: string }[];
  failedRows: { rowNumber: number; id: string; reason: string }[];
  /** Known columns that we intentionally skip (Status, Kit, Custody, etc.) */
  ignoredColumns: string[];
  /** Columns the user added that don't match any known or custom field */
  unrecognizedColumns: string[];
  updatableColumns: string[];
  /** Total individual field changes across all assets to update */
  totalFieldChanges: number;
  /** Total fields that will remain unchanged (for reassurance message) */
  totalUnchangedFields: number;
  /** Entities (categories, locations, tags) that don't exist yet and will be created */
  newEntities: {
    categories: string[];
    locations: string[];
    tags: string[];
  };
}

export interface BulkUpdateResult {
  updated: { id: string; title: string; changesApplied: number }[];
  skipped: { id: string; title: string; reason: string }[];
  failed: {
    id: string;
    title: string;
    rowNumber: number;
    error: string;
  }[];
  summary: {
    total: number;
    updated: number;
    skipped: number;
    failed: number;
  };
}

/** Internal representation of a parsed CSV column */
interface ParsedColumn {
  /** The original CSV header text */
  csvHeader: string;
  /** Internal field key (e.g. "name", "category") or custom field key (e.g. "cf:Purchase Date") */
  internalKey: string;
  /** "core" | "customField" | "ignored" */
  kind: "core" | "customField" | "ignored";
  /** For custom fields: the definition */
  cfDef?: Pick<
    CustomField,
    "name" | "type" | "helpText" | "required" | "active"
  >;
}

/**
 * Identifier columns we accept for matching CSV rows to assets.
 * Priority order: Asset ID (most user-friendly) > ID (UUID).
 * QR ID is not usable because it's a relation field (Qr model), not a
 * direct field on Asset.
 */
const IDENTIFIER_COLUMNS: {
  header: string;
  internalField: ColumnLabelKey;
  dbField: "sequentialId" | "id";
}[] = [
  {
    header: "Asset ID",
    internalField: "sequentialId",
    dbField: "sequentialId",
  },
  { header: "ID", internalField: "id", dbField: "id" },
];

interface IdentifierColumn {
  index: number;
  dbField: "sequentialId" | "id";
  header: string;
}

interface HeaderAnalysis {
  /** Columns that will be used for updates */
  updatableColumns: ParsedColumn[];
  /** Known columns that will be ignored (Status, Kit, etc.) */
  ignoredColumns: string[];
  /** User-added columns that don't match any known or custom field */
  unrecognizedColumns: string[];
  /** Primary identifier column in the CSV — used as row matcher */
  idColumnIndex: number;
  /** Which database field the identifier maps to */
  idDbField: "sequentialId" | "id";
  /** The CSV header name used as identifier (for display) */
  idColumnHeader: string;
  /** Fallback identifier column (if both Asset ID and ID are present) */
  fallbackId: IdentifierColumn | null;
  /** Map from column CSV index → ParsedColumn (for updatable only) */
  columnIndexMap: Map<number, ParsedColumn>;
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
  // column classification so they aren't treated as updatable or ignored
  const identifierFields = new Set(
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

  // Build column index map for updatable columns
  const columnIndexMap = new Map<number, ParsedColumn>();
  for (const col of updatableColumns) {
    const idx = headersTrimmed.indexOf(col.csvHeader);
    if (idx >= 0) {
      columnIndexMap.set(idx, col);
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
// Asset Fetching
// ---------------------------------------------------------------------------

type AssetForUpdate = Asset & {
  category: { name: string } | null;
  location: { id: string; name: string } | null;
  tags: { id: string; name: string }[];
  customFields: {
    id: string;
    value: unknown;
    customField: CustomField;
  }[];
};

/**
 * Fetches assets by the given identifier field (sequentialId or id).
 * Returns a map keyed by that identifier value for CSV row lookup.
 */
export async function fetchAssetsForUpdate(
  identifierValues: string[],
  organizationId: string,
  dbField: "sequentialId" | "id"
): Promise<Map<string, AssetForUpdate>> {
  const assets = await db.asset.findMany({
    where: { [dbField]: { in: identifierValues }, organizationId },
    include: {
      category: { select: { name: true } },
      location: { select: { id: true, name: true } },
      tags: { select: { id: true, name: true } },
      customFields: { include: { customField: true } },
    },
  });

  // Key by the identifier field value so CSV rows can look up their asset.
  return new Map(
    assets.map((a) => {
      const asset = a as AssetForUpdate;
      const key = dbField === "id" ? asset.id : asset.sequentialId ?? "";
      return [key, asset];
    })
  );
}

// ---------------------------------------------------------------------------
// Diff Computation
// ---------------------------------------------------------------------------

/**
 * Strips currency symbols and normalizes both US and European number formats
 * into a plain decimal number string that `parseFloat()` can handle.
 *
 * Handles:
 *  - US format:       "$1,234.56"  → "1234.56"
 *  - European format: "1.234,56"   → "1234.56"
 *  - European short:  "5454,5"     → "5454.5"
 *  - Plain:           "1234.56"    → "1234.56"
 *  - Ambiguous:       "1,234"      → "1234" (US thousand, since our export uses US)
 */
function normalizeExportedCurrencyValue(value: string): string {
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
 * Normalizes a Yes/No string to a boolean. Case-insensitive.
 * Returns undefined if the value is not a recognized boolean string.
 */
function parseYesNo(value: string): boolean | undefined {
  const lower = value.trim().toLowerCase();
  if (lower === "yes") return true;
  if (lower === "no") return false;
  return undefined;
}

/**
 * Computes field-by-field diffs between CSV rows and existing assets.
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
    seenIds.set(existingAsset.id, rowNumber);

    // Cross-check: if both identifier columns exist and have values,
    // verify they point to the same asset to prevent accidental mismatch
    if (headerAnalysis.fallbackId && fallbackAssets) {
      const primaryValue = row[headerAnalysis.idColumnIndex]?.trim() ?? "";
      const fallbackValue = row[headerAnalysis.fallbackId.index]?.trim() ?? "";
      if (primaryValue && fallbackValue) {
        const fallbackAsset = fallbackAssets.get(fallbackValue);
        if (fallbackAsset && fallbackAsset.id !== existingAsset.id) {
          failedRows.push({
            rowNumber,
            id: assetId,
            reason: `Identifier mismatch — Asset ID "${primaryValue}" and ID "${fallbackValue}" point to different assets`,
          });
          continue;
        }
      }
    }

    // Compute per-field diffs
    const changes: FieldChange[] = [];

    for (const [colIdx, column] of headerAnalysis.columnIndexMap) {
      const csvValue = row[colIdx]?.trim() ?? "";

      // Empty cell = no change
      if (csvValue === "" || csvValue === '""') {
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

/** Compares a core field value between CSV and existing asset */
function compareCoreField(
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
      const csvNum = parseFloat(normalized);
      if (isNaN(csvNum)) {
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

    default:
      return null;
  }
}

/** Compares a custom field value between CSV and existing asset */
function compareCustomField(
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
      const csvNum = parseFloat(normalizedCsv);
      if (isNaN(csvNum)) {
        return {
          field: displayName,
          currentValue: currentStr || "(empty)",
          newValue: csvValue,
          warning: `"${csvValue}" is not a valid number`,
        };
      }
      // Distinguish empty/null from numeric 0
      const currentNum = currentStr ? parseFloat(currentStr) : NaN;
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
// Build Full Preview
// ---------------------------------------------------------------------------

/**
 * Orchestrates the full preview: parse headers, fetch assets, compute diffs.
 */
export async function buildUpdatePreview({
  csvData,
  organizationId,
}: {
  csvData: string[][];
  organizationId: string;
}): Promise<UpdatePreview> {
  const headers = csvData[0].map((h) => h.trim());

  // Get org custom fields for header analysis
  const orgCustomFields = await db.customField.findMany({
    where: { organizationId, active: true, deletedAt: null },
    select: { id: true, name: true, type: true },
  });

  const headerAnalysis = analyzeUpdateHeaders(headers, orgCustomFields);

  // Validate: must have at least one identifier column
  if (headerAnalysis.idColumnIndex === -1) {
    throw new ShelfError({
      cause: null,
      message:
        "No identifier column found. Your CSV needs an Asset ID or ID column. The ID column is automatically included in all Asset Index exports.",
      label: "Assets",
      shouldBeCaptured: false,
    });
  }

  // Extract all identifier values from data rows
  const dataRows = csvData.slice(1);
  const allIds = dataRows
    .map((row) => row[headerAnalysis.idColumnIndex]?.trim())
    .filter(Boolean) as string[];

  // Fetch existing assets using whichever identifier column was found
  const existingAssets = await fetchAssetsForUpdate(
    allIds,
    organizationId,
    headerAnalysis.idDbField
  );

  // If a fallback identifier column exists, also fetch by that
  // so rows with blank primary IDs can still match
  let fallbackAssets: Map<string, AssetForUpdate> | undefined;
  if (headerAnalysis.fallbackId) {
    const fallbackIds = dataRows
      .map((row) => row[headerAnalysis.fallbackId!.index]?.trim())
      .filter(Boolean) as string[];
    if (fallbackIds.length > 0) {
      fallbackAssets = await fetchAssetsForUpdate(
        fallbackIds,
        organizationId,
        headerAnalysis.fallbackId.dbField
      );
    }
  }

  // Compute diffs
  const diffs = computeAssetDiffs({
    csvData,
    headerAnalysis,
    existingAssets,
    fallbackAssets,
  });

  // Compute field change stats
  const totalFieldChanges = diffs.assetsToUpdate.reduce(
    (sum, a) => sum + a.changes.length,
    0
  );
  // Total possible fields = rows with found assets × updatable columns
  const assetsWithData =
    diffs.assetsToUpdate.length + diffs.skippedAssets.length;
  const totalPossibleFields =
    assetsWithData * headerAnalysis.updatableColumns.length;
  const totalUnchangedFields = totalPossibleFields - totalFieldChanges;

  // Detect new entities that would be created
  const newEntities = await detectNewEntities(
    diffs.assetsToUpdate,
    headerAnalysis,
    organizationId
  );

  return {
    ...diffs,
    ignoredColumns: headerAnalysis.ignoredColumns,
    unrecognizedColumns: headerAnalysis.unrecognizedColumns,
    updatableColumns: headerAnalysis.updatableColumns.map((c) => c.csvHeader),
    totalFieldChanges,
    totalUnchangedFields: Math.max(0, totalUnchangedFields),
    newEntities,
  };
}

// ---------------------------------------------------------------------------
// New Entity Detection (for preview warnings)
// ---------------------------------------------------------------------------

/**
 * Checks which categories, locations, and tags referenced in the changes
 * don't exist yet in the organization. These will be created on apply.
 */
async function detectNewEntities(
  assetsToUpdate: AssetChangePreview[],
  headerAnalysis: HeaderAnalysis,
  organizationId: string
): Promise<{ categories: string[]; locations: string[]; tags: string[] }> {
  const categoryNames = new Set<string>();
  const locationNames = new Set<string>();
  const tagNames = new Set<string>();

  for (const asset of assetsToUpdate) {
    for (const change of asset.changes) {
      const col = headerAnalysis.updatableColumns.find(
        (c) => c.csvHeader === change.field
      );
      if (!col) continue;

      if (col.internalKey === "category") {
        if (change.newValue.toLowerCase() !== "uncategorized") {
          categoryNames.add(change.newValue.trim());
        }
      } else if (col.internalKey === "location") {
        locationNames.add(change.newValue.trim());
      } else if (col.internalKey === "tags") {
        for (const tag of change.newValue.split(",")) {
          const t = tag.trim();
          if (t) tagNames.add(t);
        }
      }
    }
  }

  // Batch check categories (single query instead of N)
  const categoryNamesArr = Array.from(categoryNames);
  const existingCats =
    categoryNamesArr.length > 0
      ? await db.category.findMany({
          where: {
            organizationId,
            name: { in: categoryNamesArr, mode: "insensitive" },
          },
          select: { name: true },
        })
      : [];
  const existingCatNamesLc = new Set(
    existingCats.map((c) => c.name.toLowerCase())
  );
  const newCategories = categoryNamesArr.filter(
    (n) => !existingCatNamesLc.has(n.toLowerCase())
  );

  // Batch check locations
  const locationNamesArr = Array.from(locationNames);
  const existingLocs =
    locationNamesArr.length > 0
      ? await db.location.findMany({
          where: {
            organizationId,
            name: { in: locationNamesArr, mode: "insensitive" },
          },
          select: { name: true },
        })
      : [];
  const existingLocNamesLc = new Set(
    existingLocs.map((l) => l.name.toLowerCase())
  );
  const newLocations = locationNamesArr.filter(
    (n) => !existingLocNamesLc.has(n.toLowerCase())
  );

  // Batch check tags
  const tagNamesArr = Array.from(tagNames);
  const existingTags =
    tagNamesArr.length > 0
      ? await db.tag.findMany({
          where: {
            organizationId,
            name: { in: tagNamesArr, mode: "insensitive" },
          },
          select: { name: true },
        })
      : [];
  const existingTagNamesLc = new Set(
    existingTags.map((t) => t.name.toLowerCase())
  );
  const newTags = tagNamesArr.filter(
    (n) => !existingTagNamesLc.has(n.toLowerCase())
  );

  return {
    categories: newCategories,
    locations: newLocations,
    tags: newTags,
  };
}

// ---------------------------------------------------------------------------
// Entity Resolution Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a category name to its ID, creating it if it doesn't exist.
 * Returns "uncategorized" if the name is "Uncategorized".
 */
async function resolveCategoryNameToId(
  name: string,
  userId: string,
  organizationId: string
): Promise<string> {
  if (name.toLowerCase() === "uncategorized") {
    return "uncategorized";
  }

  const existing = await db.category.findFirst({
    where: {
      name: { equals: name.trim(), mode: "insensitive" },
      organizationId,
    },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await db.category.create({
    data: {
      name: name.trim(),
      color: getRandomColor(),
      user: { connect: { id: userId } },
      organization: { connect: { id: organizationId } },
    },
    select: { id: true },
  });

  return created.id;
}

/**
 * Resolves a location name to its ID, creating it if it doesn't exist.
 */
async function resolveLocationNameToId(
  name: string,
  userId: string,
  organizationId: string
): Promise<string> {
  const existing = await db.location.findFirst({
    where: {
      name: { equals: name.trim(), mode: "insensitive" },
      organizationId,
    },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await db.location.create({
    data: {
      name: name.trim(),
      user: { connect: { id: userId } },
      organization: { connect: { id: organizationId } },
    },
    select: { id: true },
  });

  return created.id;
}

/**
 * Resolves an array of tag names to their IDs, creating any that don't exist.
 * Uses batched queries to avoid N+1 round-trips.
 */
async function resolveTagNamesToIds(
  names: string[],
  userId: string,
  organizationId: string
): Promise<{ id: string }[]> {
  const trimmedNames = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (trimmedNames.length === 0) return [];

  // Deduplicate (case-insensitive) while keeping first occurrence
  const seenLc = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of trimmedNames) {
    const lc = name.toLowerCase();
    if (!seenLc.has(lc)) {
      seenLc.add(lc);
      uniqueNames.push(name);
    }
  }

  // Batch fetch existing tags
  const existingTags = await db.tag.findMany({
    where: {
      organizationId,
      name: { in: uniqueNames, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });

  const nameToId = new Map<string, string>();
  for (const tag of existingTags) {
    nameToId.set(tag.name.toLowerCase(), tag.id);
  }

  // Create missing tags
  const toCreate = uniqueNames.filter((n) => !nameToId.has(n.toLowerCase()));
  if (toCreate.length > 0) {
    await db.tag.createMany({
      data: toCreate.map((name) => ({
        name,
        userId,
        organizationId,
      })),
      skipDuplicates: true,
    });

    // Re-fetch to get IDs of newly created tags
    const newTags = await db.tag.findMany({
      where: {
        organizationId,
        name: { in: toCreate, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    for (const tag of newTags) {
      nameToId.set(tag.name.toLowerCase(), tag.id);
    }
  }

  // Build result preserving original order (including duplicates)
  const result: { id: string }[] = [];
  for (const name of trimmedNames) {
    const id = nameToId.get(name.toLowerCase());
    if (id) result.push({ id });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Apply Updates
// ---------------------------------------------------------------------------

/**
 * Applies bulk updates from an import preview.
 * Re-parses the CSV from scratch (stateless) and applies changes.
 */
export async function applyBulkUpdatesFromImport({
  csvData,
  organizationId,
  userId,
  request,
}: {
  csvData: string[][];
  organizationId: string;
  userId: User["id"];
  request: Request;
}): Promise<BulkUpdateResult> {
  // Re-compute preview to get fresh state
  const headers = csvData[0].map((h) => h.trim());

  const orgCustomFields = await db.customField.findMany({
    where: { organizationId, active: true, deletedAt: null },
    select: { id: true, name: true, type: true },
  });

  const headerAnalysis = analyzeUpdateHeaders(headers, orgCustomFields);

  if (headerAnalysis.idColumnIndex === -1) {
    throw new ShelfError({
      cause: null,
      message:
        "No identifier column found. Your CSV needs an Asset ID or ID column.",
      label: "Assets",
      shouldBeCaptured: false,
    });
  }

  const dataRows = csvData.slice(1);
  const allIds = dataRows
    .map((row) => row[headerAnalysis.idColumnIndex]?.trim())
    .filter(Boolean) as string[];

  const existingAssets = await fetchAssetsForUpdate(
    allIds,
    organizationId,
    headerAnalysis.idDbField
  );

  // Fetch by fallback identifier if available
  let fallbackAssets: Map<string, AssetForUpdate> | undefined;
  if (headerAnalysis.fallbackId) {
    const fallbackIds = dataRows
      .map((row) => row[headerAnalysis.fallbackId!.index]?.trim())
      .filter(Boolean) as string[];
    if (fallbackIds.length > 0) {
      fallbackAssets = await fetchAssetsForUpdate(
        fallbackIds,
        organizationId,
        headerAnalysis.fallbackId.dbField
      );
    }
  }

  const diffs = computeAssetDiffs({
    csvData,
    headerAnalysis,
    existingAssets,
    fallbackAssets,
  });

  // Build a full custom field map (name → CustomField) for building values
  const allCfs = await db.customField.findMany({
    where: { organizationId, active: true, deletedAt: null },
  });
  const cfByName = new Map(allCfs.map((cf) => [cf.name.toLowerCase(), cf]));

  // Pre-resolve all entity names in batch to avoid N+1 queries in the loop
  const categoryNameMap = new Map<string, string>();
  const locationNameMap = new Map<string, string>();
  const tagNameMap = new Map<string, string>();

  const allCategoryNames = new Set<string>();
  const allLocationNames = new Set<string>();
  const allTagNames = new Set<string>();

  for (const asset of diffs.assetsToUpdate) {
    for (const change of asset.changes) {
      if (change.warning) continue;
      const col = headerAnalysis.updatableColumns.find(
        (c) => c.csvHeader === change.field
      );
      if (!col) continue;
      if (col.internalKey === "category") allCategoryNames.add(change.newValue);
      if (col.internalKey === "location") allLocationNames.add(change.newValue);
      if (col.internalKey === "tags") {
        change.newValue
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .forEach((t) => allTagNames.add(t));
      }
    }
  }

  // Batch resolve categories
  for (const name of allCategoryNames) {
    categoryNameMap.set(
      name,
      await resolveCategoryNameToId(name, userId, organizationId)
    );
  }

  // Batch resolve locations
  for (const name of allLocationNames) {
    locationNameMap.set(
      name,
      await resolveLocationNameToId(name, userId, organizationId)
    );
  }

  // Batch resolve tags
  if (allTagNames.size > 0) {
    // Ensure all tags exist (creates missing ones)
    await resolveTagNamesToIds([...allTagNames], userId, organizationId);
    // Fetch all org tags to build the name → id map
    const allOrgTags = await db.tag.findMany({
      where: { organizationId },
      select: { id: true, name: true },
    });
    for (const tag of allOrgTags) {
      tagNameMap.set(tag.name.toLowerCase(), tag.id);
    }
  }

  // Process updates
  const updated: BulkUpdateResult["updated"] = [];
  const skipped: BulkUpdateResult["skipped"] = diffs.skippedAssets;
  const failed: BulkUpdateResult["failed"] = diffs.failedRows.map((f) => ({
    id: f.id,
    title: "",
    rowNumber: f.rowNumber,
    error: f.reason,
  }));

  // Build a map from assetId → CSV row index for error reporting
  // Build row-number index by both primary and fallback identifiers
  const seenIdsForRow = new Map<string, number>();
  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx];
    const primaryId = row[headerAnalysis.idColumnIndex]?.trim();
    if (primaryId && !seenIdsForRow.has(primaryId)) {
      seenIdsForRow.set(primaryId, rowIdx);
    }
    if (headerAnalysis.fallbackId) {
      const fallbackVal = row[headerAnalysis.fallbackId.index]?.trim();
      if (fallbackVal && !seenIdsForRow.has(fallbackVal)) {
        seenIdsForRow.set(fallbackVal, rowIdx);
      }
    }
  }

  for (const assetPreview of diffs.assetsToUpdate) {
    const { id: matchId, assetDbId, title: assetTitle, changes } = assetPreview;
    // Look up in primary map first, then fallback (matches computeAssetDiffs logic)
    const existingAsset =
      existingAssets.get(matchId) ?? fallbackAssets?.get(matchId);
    if (!existingAsset) {
      // Asset was deleted between preview and apply
      const rowIdx = seenIdsForRow.get(matchId);
      failed.push({
        id: matchId,
        title: assetTitle,
        rowNumber: rowIdx !== undefined ? rowIdx + 2 : 0,
        error:
          "Asset no longer exists — it may have been deleted after the preview",
      });
      continue;
    }
    const rowIdx = seenIdsForRow.get(matchId);
    const rowNumber = rowIdx !== undefined ? rowIdx + 2 : 0;

    try {
      // Separate location changes to handle kit constraint gracefully
      let locationChange: FieldChange | undefined;
      let locationKitError: string | undefined;
      let availableToBookChange: FieldChange | undefined;
      const otherChanges: FieldChange[] = [];

      for (const change of changes) {
        // Skip fields with validation warnings (e.g. bad date format)
        if (change.warning) continue;

        // Match by field display name
        const col = headerAnalysis.updatableColumns.find(
          (c) => c.csvHeader === change.field
        );
        if (!col) continue;

        if (col.internalKey === "location") {
          locationChange = change;
        } else if (col.internalKey === "availableToBook") {
          availableToBookChange = change;
        } else {
          otherChanges.push(change);
        }
      }

      // Build UpdateAssetPayload from non-location, non-availableToBook changes
      const updatePayload: Partial<
        Omit<UpdateAssetPayload, "id" | "userId" | "organizationId" | "request">
      > = {};
      const customFieldsValues: ShelfAssetCustomFieldValueType[] = [];

      for (const change of otherChanges) {
        const col = headerAnalysis.updatableColumns.find(
          (c) => c.csvHeader === change.field
        );
        if (!col) continue;

        switch (col.internalKey) {
          case "name":
            updatePayload.title = change.newValue;
            break;

          case "category": {
            const categoryId = categoryNameMap.get(change.newValue);
            if (categoryId) {
              updatePayload.categoryId = categoryId;
            }
            break;
          }

          case "tags": {
            const tagNames = change.newValue
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
            const tagIds = tagNames
              .map((n) => tagNameMap.get(n.toLowerCase()))
              .filter((id): id is string => !!id)
              .map((id) => ({ id }));
            updatePayload.tags = { set: tagIds };
            break;
          }

          case "valuation": {
            const normalized = normalizeExportedCurrencyValue(change.newValue);
            const val = parseFloat(normalized);
            if (!isNaN(val)) {
              updatePayload.valuation = val;
            }
            break;
          }

          default: {
            // Custom field
            if (col.kind === "customField" && col.cfDef) {
              const fullCf = cfByName.get(col.cfDef.name.toLowerCase());
              if (fullCf) {
                // For AMOUNT/NUMBER fields, pre-normalize the currency format
                let rawValue: string = change.newValue;
                if (fullCf.type === "AMOUNT" || fullCf.type === "NUMBER") {
                  rawValue = normalizeExportedCurrencyValue(rawValue);
                }

                const builtValue = buildCustomFieldValue(
                  { raw: rawValue },
                  fullCf
                );
                if (builtValue) {
                  customFieldsValues.push({
                    id: fullCf.id,
                    value: builtValue,
                  } as ShelfAssetCustomFieldValueType);
                }
              }
            }
            break;
          }
        }
      }

      if (customFieldsValues.length > 0) {
        updatePayload.customFieldsValues = customFieldsValues;
      }

      // Apply main update (everything except location and availableToBook)
      // Count actual payload fields (not otherChanges.length, which may include
      // fields that were silently skipped like invalid numbers)
      let changesApplied = 0;
      if (updatePayload.title !== undefined) changesApplied++;
      if (updatePayload.categoryId !== undefined) changesApplied++;
      if (updatePayload.tags !== undefined) changesApplied++;
      if (updatePayload.valuation !== undefined) changesApplied++;
      changesApplied += customFieldsValues.length;

      const hasMainChanges =
        updatePayload.title !== undefined ||
        updatePayload.categoryId !== undefined ||
        updatePayload.tags !== undefined ||
        updatePayload.valuation !== undefined ||
        (updatePayload.customFieldsValues &&
          updatePayload.customFieldsValues.length > 0);

      if (hasMainChanges) {
        await updateAsset({
          id: assetDbId,
          userId,
          organizationId,
          request,
          ...updatePayload,
        } as UpdateAssetPayload);
      }

      // Handle location separately to catch kit constraint
      if (locationChange) {
        try {
          const locationId = locationNameMap.get(locationChange.newValue);
          if (!locationId) {
            throw new ShelfError({
              cause: null,
              message: `Location "${locationChange.newValue}" could not be resolved`,
              label: "Assets",
              shouldBeCaptured: false,
            });
          }
          await updateAsset({
            id: assetDbId,
            userId,
            organizationId,
            request,
            newLocationId: locationId,
            currentLocationId: existingAsset.location?.id ?? undefined,
          } as UpdateAssetPayload);
          changesApplied++;
        } catch (cause) {
          // If location fails due to kit, track it but don't double-count
          const msg = isLikeShelfError(cause)
            ? (cause as { message: string }).message
            : "Location update failed";
          if (!msg.includes("kit")) {
            throw cause; // Re-throw non-kit errors
          }
          // Kit location failure — tracked as partial if other fields applied
          locationKitError = `Location change skipped: ${msg}`;
        }
      }

      // Handle availableToBook separately
      if (availableToBookChange) {
        const newBool = parseYesNo(availableToBookChange.newValue);
        if (newBool !== undefined) {
          await updateAssetBookingAvailability({
            id: assetDbId,
            availableToBook: newBool,
            organizationId,
          });
          changesApplied++;
        }
      }

      if (changesApplied > 0) {
        updated.push({
          id: matchId,
          title: assetTitle,
          changesApplied,
        });
        // If location failed due to kit but other fields succeeded,
        // record as a separate failure entry (partial success)
        if (locationKitError) {
          failed.push({
            id: matchId,
            title: assetTitle,
            rowNumber,
            error: locationKitError,
          });
        }
      } else if (locationKitError) {
        // Only change was location and it failed
        failed.push({
          id: matchId,
          title: assetTitle,
          rowNumber,
          error: locationKitError,
        });
      } else {
        // All changes had warnings — nothing applied
        const warnedCount = changes.filter((c) => c.warning).length;
        if (warnedCount > 0) {
          skipped.push({
            id: matchId,
            title: assetTitle,
            reason: `${warnedCount} field${
              warnedCount !== 1 ? "s" : ""
            } had invalid values and were skipped`,
          });
        }
      }
    } catch (cause) {
      const msg = isLikeShelfError(cause)
        ? (cause as { message: string }).message
        : "Unknown error";
      failed.push({
        id: matchId,
        title: assetTitle,
        rowNumber,
        error: msg,
      });
    }
  }

  // Count unique assets — some may appear in both updated and failed
  // when a partial success occurs (e.g. location kit constraint)
  const uniqueIds = new Set([
    ...updated.map((a) => a.id),
    ...skipped.map((a) => a.id),
    ...failed.map((r) => r.id),
  ]);
  const total = uniqueIds.size;

  return {
    updated,
    skipped,
    failed,
    summary: {
      total,
      updated: updated.length,
      skipped: skipped.length,
      failed: failed.length,
    },
  };
}
