/**
 * Import mapping: names why an asset import failed, for analytics.
 *
 * The import route reports every failure after its permission and plan gates
 * as one `import_failed` event whose `reason` comes from a fixed list, so the
 * funnel can be counted without reading messages or file contents.
 *
 * Errors raised by the mapping step carry their reason in
 * `additionalData.failureReason`. Errors raised by the existing importer are
 * recognised by the `additionalData` keys their error tables already read.
 *
 * Pure.
 *
 * @see {@link file://./../../routes/_layout+/assets.import.tsx} the caller
 */

/** Every reason an `import_failed` event can carry. */
export const IMPORT_FAILURE_REASONS = [
  "empty_file",
  "unreadable_file",
  "too_many_columns",
  "invalid_mapping",
  "duplicate_targets",
  "invalid_headers",
  "row_errors",
  "qr_codes",
  "barcodes",
  "barcodes_not_enabled",
  "kit_custody",
  "other",
] as const;

/** Why an asset import failed, see {@link IMPORT_FAILURE_REASONS}. */
export type ImportFailureReason = (typeof IMPORT_FAILURE_REASONS)[number];

const REASON_SET = new Set<string>(IMPORT_FAILURE_REASONS);

/** The parts of a `ShelfError` the classifier reads. */
type ClassifiableError = {
  additionalData?: Record<string, unknown> | null;
  status?: number;
  label?: string;
};

/**
 * Names the reason an import failed.
 *
 * @param error - The error the route is about to return
 * @returns One of {@link IMPORT_FAILURE_REASONS}
 */
export function classifyImportFailure(
  error: ClassifiableError
): ImportFailureReason {
  const data = error.additionalData ?? {};
  const tagged = data.failureReason;
  if (typeof tagged === "string" && REASON_SET.has(tagged)) {
    return tagged as ImportFailureReason;
  }

  if ("defectedHeaders" in data) return "invalid_headers";
  if ("rowErrors" in data) return "row_errors";
  if (
    "duplicateCodes" in data ||
    "nonExistentCodes" in data ||
    "linkedCodes" in data ||
    "connectedToOtherOrgs" in data
  ) {
    return "qr_codes";
  }
  if ("duplicateBarcodes" in data) return "barcodes";
  if ("kitCustodyConflicts" in data) return "kit_custody";
  // Past the route's gates, the importer's only 403 is a file with barcode
  // columns in a workspace without the barcode add-on.
  if (error.status === 403) return "barcodes_not_enabled";
  if (error.label === "CSV") return "unreadable_file";
  return "other";
}
