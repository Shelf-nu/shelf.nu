/**
 * @file Shapes the active import for the viewer's permissions.
 *
 * The layout loader sends one `activeAssetImport` value to every member. The
 * status API and page require import permission, so members without it get
 * only the progress fields the assets index notice needs. Pure and
 * client-safe so both the loader and the components share it.
 *
 * @see {@link file://./../../routes/_layout+/_layout.tsx}
 * @see {@link file://./types.ts}
 */
import type {
  AssetImportNoticePayload,
  AssetImportStatusPayload,
} from "./types";

/**
 * Reduces an import payload to what the viewer may see.
 *
 * @param payload - The full payload, or null when no import is active
 * @param canImport - Whether the viewer holds the asset import permission
 * @returns The full payload for importers, the narrow notice payload for
 * everyone else, null when there is no active import
 */
export function shapeActiveImportForViewer(
  payload: AssetImportStatusPayload | null,
  canImport: boolean
): AssetImportStatusPayload | AssetImportNoticePayload | null {
  if (!payload) return null;
  if (canImport) return payload;
  return {
    status: payload.status,
    phase: payload.phase,
    processedRows: payload.processedRows,
    totalRows: payload.totalRows,
  };
}

/**
 * Type guard: true for the full payload (importers), false for the narrow one.
 *
 * @param payload - Value from the layout loader
 * @returns Whether `payload` carries the full status fields
 */
export function isFullImportPayload(
  payload:
    | AssetImportStatusPayload
    | AssetImportNoticePayload
    | null
    | undefined
): payload is AssetImportStatusPayload {
  return !!payload && "id" in payload;
}
