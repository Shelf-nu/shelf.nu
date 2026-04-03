/**
 * @file Shared types and constants for the bulk asset update via CSV import.
 * This file contains no server-side imports and can be safely imported
 * from both client and server code.
 *
 * @see {@link file://./import-update.server.ts} Orchestration (server)
 * @see {@link file://./import-update-diff.ts} Diff computation (pure logic)
 * @see {@link file://./import-update-entities.server.ts} Entity resolution (server)
 */
import type { CustomField } from "@prisma/client";
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
 * Built from columnsLabelsMap. E.g. "Name" → "name", "Category" → "category"
 */
export const EXPORT_HEADER_TO_FIELD_MAP: Record<string, ColumnLabelKey> =
  Object.fromEntries(
    Object.entries(columnsLabelsMap).map(([key, label]) => [label, key])
  ) as Record<string, ColumnLabelKey>;

/** Fields that v1 supports updating (core metadata). */
export const UPDATABLE_FIELDS = new Set<string>([
  "name",
  "category",
  "location",
  "tags",
  "valuation",
  "availableToBook",
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
