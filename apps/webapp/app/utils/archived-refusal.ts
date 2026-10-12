/**
 * Archived Refusal Details
 *
 * A refusal over archived assets (issue #382) carries WHICH assets in its
 * `additionalData`: `archivedAssetIds` / `archivedAssetTitles` from
 * `assertAssetsAreNotArchived`, and `kitIdsWithoutActiveAssets` from
 * `assertKitsHaveActiveAssets`. Service wrappers often rethrow a caught error
 * as a new `ShelfError` with their own `additionalData`, so the details can
 * sit anywhere down the `cause` chain. This reads them from wherever they are,
 * so a route can hand them to its client (the scanner marks only those rows).
 *
 * @see {@link file://./org-validation.server.ts} assertAssetsAreNotArchived
 * @see {@link file://./../modules/booking/kit-holds.server.ts} assertKitsHaveActiveAssets
 */

/** The ids (and titles) an archived refusal is about. */
export type ArchivedRefusalDetails = {
  archivedAssetIds: string[];
  archivedAssetTitles: string[];
  kitIdsWithoutActiveAssets: string[];
};

/** How deep to follow `cause`; wrappers nest a few levels at most. */
const MAX_CAUSE_DEPTH = 10;

/** Reads `value` as a string array, or nothing. */
function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value
    : null;
}

/**
 * Finds the archived-refusal details in an error or any of its causes.
 *
 * @param error - The caught error (any shape)
 * @returns The details from the first error in the chain that carries any,
 *   or `null` when the error is not an archived refusal
 */
export function readArchivedRefusalDetails(
  error: unknown
): ArchivedRefusalDetails | null {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== "object" || current === null) return null;

    const data = (current as { additionalData?: unknown }).additionalData;
    if (typeof data === "object" && data !== null) {
      const record = data as Record<string, unknown>;
      const archivedAssetIds = stringArray(record.archivedAssetIds);
      const kitIdsWithoutActiveAssets = stringArray(
        record.kitIdsWithoutActiveAssets
      );
      if (archivedAssetIds || kitIdsWithoutActiveAssets) {
        return {
          archivedAssetIds: archivedAssetIds ?? [],
          archivedAssetTitles: stringArray(record.archivedAssetTitles) ?? [],
          kitIdsWithoutActiveAssets: kitIdsWithoutActiveAssets ?? [],
        };
      }
    }

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}
