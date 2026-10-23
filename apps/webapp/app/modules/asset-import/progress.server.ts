/**
 * Asset import progress helpers
 *
 * Small pure readers shared by the import steps: the stored rows and resolved
 * maps of an import, and which step continues an import from its progress.
 * They live apart from the steps so the job runner and each step can share
 * them without importing each other.
 *
 * @see {@link file://./worker.server.ts}
 * @see {@link file://./prepare.server.ts}
 * @see {@link file://./finalize.server.ts}
 */
import type { AssetImport } from "@prisma/client";
import { ShelfError } from "~/utils/error";
import { ASSET_IMPORT_CHUNK_SIZE } from "./constants";
import type {
  AssetImportJobData,
  ResolvedImportEntities,
  StoredImportRow,
} from "./types";

const label = "Asset Import";

/**
 * The step that continues an import with `processedRows` rows already
 * written: the chunk holding the first unwritten row, or FINALIZE when every
 * row is written.
 *
 * @param args.importId - The import
 * @param args.processedRows - Rows committed so far
 * @param args.totalRows - Rows in the file
 * @returns The next step's payload
 */
export function nextStepAfter({
  importId,
  processedRows,
  totalRows,
}: {
  importId: string;
  processedRows: number;
  totalRows: number;
}): AssetImportJobData {
  if (processedRows >= totalRows) {
    return { importId, step: "FINALIZE" };
  }
  return {
    importId,
    step: "ROWS",
    chunkIndex: Math.floor(processedRows / ASSET_IMPORT_CHUNK_SIZE),
  };
}

/**
 * Reads the stored rows of an import.
 *
 * @param assetImport - The import
 * @returns The stored rows
 * @throws {ShelfError} When the import has no rows. They are cleared only on
 * completion, so this marks a broken import.
 */
export function storedRowsOf(
  assetImport: Pick<AssetImport, "id" | "rows">
): StoredImportRow[] {
  if (!Array.isArray(assetImport.rows)) {
    throw new ShelfError({
      cause: null,
      message: "The import has no stored rows",
      additionalData: { importId: assetImport.id },
      label,
    });
  }
  return assetImport.rows as unknown as StoredImportRow[];
}

/**
 * Reads the name to id maps PREPARE stored on an import.
 *
 * @param assetImport - The import
 * @returns The resolved maps
 * @throws {ShelfError} When PREPARE has not stored them
 */
export function resolvedOf(
  assetImport: Pick<AssetImport, "id" | "resolved">
): ResolvedImportEntities {
  const { resolved } = assetImport;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new ShelfError({
      cause: null,
      message: "The import has no resolved entities",
      additionalData: { importId: assetImport.id },
      label,
    });
  }
  return resolved as unknown as ResolvedImportEntities;
}
