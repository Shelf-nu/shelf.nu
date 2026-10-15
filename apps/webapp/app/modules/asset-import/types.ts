/**
 * Asset import types
 *
 * Shapes shared by the import preview, the background job and the progress
 * UI. Type-only imports, so client components can use them.
 *
 * @see {@link file://./preview.server.ts}
 * @see {@link file://./worker.server.ts}
 */
import type { AssetImportPhase, AssetImportStatus } from "@prisma/client";
import type { CreateAssetFromContentImportPayload } from "~/modules/asset/types";
import type { ImportRowError } from "~/utils/import-row-errors";

/**
 * One parsed CSV row as stored on `AssetImport.rows`. `assetId` is allocated
 * at preview time and never changes, so a retried chunk writes the same ids
 * and the same image paths.
 */
export type StoredImportRow = CreateAssetFromContentImportPayload & {
  /** Id the asset will be created with (legacy 25-char cuid). */
  assetId: string;
  /** Line number as the user's spreadsheet shows it (header is line 1). */
  rowNumber: number;
};

/**
 * Name to id maps written by the PREPARE step. Keys follow the conventions of
 * the `create*IfNotExists` helpers that produce them: categories, locations
 * and asset models keyed by the raw cell; kits and custodians by the trimmed
 * cell; tags and custom fields by name.
 */
export type ResolvedImportEntities = {
  kits: Record<string, string>;
  categories: Record<string, string>;
  locations: Record<string, string>;
  teamMembers: Record<string, string>;
  tags: Record<string, string>;
  customFields: Record<string, string>;
  assetModels: Record<string, string>;
  /** Claimed QR code id per row `key`. */
  qrIdsByRowKey: Record<string, string>;
};

/** pg-boss payload for one import step. */
export type AssetImportJobData =
  | { importId: string; step: "PREPARE" }
  | { importId: string; step: "ROWS"; chunkIndex: number }
  | { importId: string; step: "FINALIZE" };

/**
 * A row imported without one conflicting piece (QR code, barcode, custom
 * field value, kit custody). Same shape as `ImportRowError`, so
 * `ImportRowErrorsTable` renders both.
 */
export type ImportWarning = ImportRowError;

/** What the status endpoint returns and the progress UI renders. */
export type AssetImportStatusPayload = {
  id: string;
  status: AssetImportStatus;
  phase: AssetImportPhase;
  fileName: string | null;
  totalRows: number;
  processedRows: number;
  errorMessage: string | null;
  warningCount: number;
  completedAt: string | null;
  /** True when the viewer started this import. */
  isMine: boolean;
};

/**
 * What members without import permission receive for the assets index
 * notice: progress only, no id, file name, error text or warning count.
 */
export type AssetImportNoticePayload = Pick<
  AssetImportStatusPayload,
  "status" | "phase" | "processedRows" | "totalRows"
>;

/** Status page payload: the status plus the stored warnings. */
export type AssetImportDetailsPayload = AssetImportStatusPayload & {
  warnings: ImportWarning[];
};

/** One cell in the generic import grid. */
export type ImportGridCell = {
  value: string;
  /** Previous value, shown struck through. Only the update flow sets it. */
  previous?: string;
  tone: "plain" | "changed" | "clearing" | "warning" | "new";
  /** Tooltip text, e.g. a warning or "Will be created". */
  note?: string;
};

/** One row in the generic import grid. */
export type ImportGridRow = {
  key: string;
  /** Leftmost cell, e.g. the spreadsheet row number or the asset ID. */
  label: string;
  /** Optional smaller line under the label, e.g. the asset ID under its title. */
  sublabel?: string;
  cells: Record<string, ImportGridCell>;
};

/** Entities the import will create, by kind, for the "will be created" notice. */
export type ImportNewEntities = {
  categories: string[];
  locations: string[];
  tags: string[];
  kits: string[];
  custodians: string[];
  customFields: string[];
  assetModels: string[];
};

/** Payload of a successful upload: everything the preview stage renders. */
export type ContentImportPreview = {
  importId: string;
  fileName: string | null;
  totalRows: number;
  columns: string[];
  rows: ImportGridRow[];
  newEntities: ImportNewEntities;
  counts: {
    withImage: number;
    withCustodian: number;
    inKit: number;
    quantityTracked: number;
  };
  /**
   * Values that will import but probably do not match their label, such as
   * an External QR value without a protocol. Capped at
   * `MAX_REPORTED_ROW_ERRORS`; never blocks the import.
   */
  valueWarnings: ImportWarning[];
  /** How many value warnings the whole file has, listed or not. */
  totalValueWarnings: number;
};
