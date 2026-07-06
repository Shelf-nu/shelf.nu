/**
 * @file Shared types and constants for the bulk asset update via CSV import.
 * This file contains no server-side imports and can be safely imported
 * from both client and server code.
 *
 * @see {@link file://./import-update.server.ts} Orchestration (server)
 * @see {@link file://./import-update-diff.ts} Diff computation (pure logic)
 * @see {@link file://./import-update-entities.server.ts} Entity resolution (server)
 */
import type { AssetType, ConsumptionType, CustomField } from "@prisma/client";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import {
  columnsLabelsMap,
  type ColumnLabelKey,
} from "~/modules/asset-index-settings/helpers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Reverse mapping: exported CSV header label → internal field name.
 *
 * Built from `columnsLabelsMap`. E.g. `"Name" → "name"`,
 * `"Category" → "category"`.
 *
 * Some import-only columns (the qty-tracked + consumption fields) are
 * NOT part of the asset-index export column system (`columnsLabelsMap`
 * is keyed by `ColumnLabelKey`, which only enumerates the index's
 * fixed fields). We add explicit human-readable aliases below so users
 * can include those columns in update CSVs even though the export
 * doesn't emit them as separate columns.
 */
export const EXPORT_HEADER_TO_FIELD_MAP: Record<string, string> = {
  ...(Object.fromEntries(
    Object.entries(columnsLabelsMap).map(([key, label]) => [label, key])
  ) as Record<string, ColumnLabelKey>),
  // Aliases for qty-tracked + consumption columns that don't live in
  // the asset-index export column system. Customers using the
  // content-import templates (see ASSET_CSV_HEADERS) can include these
  // headers in update CSVs as well.
  "Min quantity": "minQuantity",
  "Unit of measure": "unitOfMeasure",
  "Consumption type": "consumptionType",
};

/**
 * Fields supported by the bulk-update-from-import flow.
 *
 * v1 covered core metadata (name, category, location, tags, valuation,
 * availableToBook). The Wave-1 update-path extension adds the
 * qty-tracked + AssetModel columns so a customer's
 * `export → tweak → re-import` round-trip preserves those values
 * instead of silently dropping them.
 *
 * `type` is intentionally NOT included — asset type is immutable once
 * an asset is created. The `type` cell on update rows is silently
 * ignored regardless of what it contains.
 */
export const UPDATABLE_FIELDS = new Set<string>([
  "name",
  "category",
  "location",
  "tags",
  "valuation",
  "availableToBook",
  // Wave-1 extension: qty-tracked + AssetModel round-trip.
  "quantity",
  "minQuantity",
  "unitOfMeasure",
  "consumptionType",
  "assetModel",
]);

/** Custom field types that are safe for round-trip update. */
export const UPDATABLE_CF_TYPES = new Set<string>([
  "TEXT",
  "BOOLEAN",
  "DATE",
  "OPTION",
  "NUMBER",
  "AMOUNT",
]);

/**
 * Identifier columns we accept for matching CSV rows to assets.
 * Priority order: Asset ID (most user-friendly) > ID (UUID).
 * QR ID is not usable because it's a relation field (Qr model), not a
 * direct field on Asset.
 */
export const IDENTIFIER_COLUMNS: {
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

/**
 * Maximum number of data rows allowed in a single bulk update CSV.
 * Each row can trigger multiple DB calls, so we cap this to prevent
 * request timeouts and connection exhaustion.
 */
export const MAX_BULK_UPDATE_ROWS = 1000;

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
  /** If true, this change will clear/remove the field value */
  clearing?: boolean;
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
  /**
   * Per-row warnings collected during apply. Unlike `failed`, warnings
   * do not prevent the row from updating — the row's other cells still
   * apply and the warning is surfaced for transparency. Used today for:
   *   - `assetModel` cell ignored on a QUANTITY_TRACKED row (the row's
   *     other cells still update, the model link is silently dropped).
   *
   * Empty array when no warnings fired. Additive on the response shape
   * — pre-Wave-1 consumers that don't read this field still work.
   */
  warnings: {
    id: string;
    rowNumber: number;
    message: string;
  }[];
  summary: {
    total: number;
    updated: number;
    skipped: number;
    failed: number;
  };
}

/** Internal representation of a parsed CSV column */
export interface ParsedColumn {
  /** The original CSV header text */
  csvHeader: string;
  /** Internal field key (e.g. "name", "category") or custom field key (e.g. "cf:Purchase Date") */
  internalKey: string;
  /** "core" | "customField" | "ignored" */
  kind: "core" | "customField" | "ignored";
  /** Column index in the CSV (for building the column index map) */
  csvIndex?: number;
  /** For custom fields: the definition */
  cfDef?: Pick<
    CustomField,
    "name" | "type" | "helpText" | "required" | "active"
  >;
}

export interface IdentifierColumn {
  index: number;
  dbField: "sequentialId" | "id";
  header: string;
}

export interface HeaderAnalysis {
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

/** Asset shape loaded from the database for diff comparison */
export type AssetForUpdate = {
  id: string;
  title: string;
  sequentialId: string | null;
  valuation: number | null;
  availableToBook: boolean;
  /**
   * Asset type — needed by the qty-tracked update parser to decide
   * which cells apply (e.g. qty-tracked-only cells are silently
   * dropped on INDIVIDUAL rows; assetModel is warn-and-skip on
   * QUANTITY_TRACKED rows).
   *
   * Optional in the type so pre-Wave-1 test fixtures still compile;
   * `fetchAssetsForUpdate` always populates it from the DB row.
   * Callers that depend on it (the qty-tracked parser, the diff
   * comparison branches for qty-tracked fields) treat `undefined` as
   * "skip — no info" rather than throwing.
   */
  type?: AssetType;
  /** Current pool size; only meaningful for QUANTITY_TRACKED. */
  quantity?: number | null;
  /** Optional low-stock threshold; QUANTITY_TRACKED only. */
  minQuantity?: number | null;
  /** Free-form label ("boxes", "kg"); QUANTITY_TRACKED only. */
  unitOfMeasure?: string | null;
  /** ONE_WAY / TWO_WAY; QUANTITY_TRACKED only. */
  consumptionType?: ConsumptionType | null;
  /** Current AssetModel link; INDIVIDUAL only. */
  assetModelId?: string | null;
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
 * Shape of the custom field value JSON stored on assets.
 * Re-exported here for convenience so diff logic doesn't need
 * to import directly from asset types.
 */
export type { ShelfAssetCustomFieldValueType };
