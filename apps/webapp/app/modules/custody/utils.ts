/**
 * Custody Utilities
 *
 * Helper functions for working with the Custody model.
 * After Phase 2, Asset.custody changed from Custody? (one-to-one) to
 * Custody[] (one-to-many) to support multiple custodians for
 * quantity-tracked assets. These helpers ease the transition.
 */

/**
 * Returns the primary (first) custody record from a custody array.
 * For INDIVIDUAL assets, there is at most one custody record.
 * For QUANTITY_TRACKED assets, returns the first of potentially many.
 *
 * The generic constraint accepts any object type (including partial Custody
 * records from Prisma selects or raw SQL results that may lack `id`).
 *
 * @param custody - Array of custody records from the Asset relation
 * @returns The first custody record, or null if none exist
 */
export function getPrimaryCustody<T extends Record<string, unknown>>(
  custody: T[] | null | undefined
): T | null {
  if (!custody || custody.length === 0) return null;
  return custody[0] ?? null;
}

/**
 * Checks whether an asset has any active custody records.
 *
 * @param custody - Array of custody records from the Asset relation
 * @returns True if at least one custody record exists
 */
export function hasCustody(
  custody: Record<string, unknown>[] | null | undefined
): boolean {
  return !!custody && custody.length > 0;
}
