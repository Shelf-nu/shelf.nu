/**
 * Scan target
 *
 * The item whose scans are read: an asset or a kit, never both. Pure and
 * client-safe, so the server reads, the endpoint URL and the card all branch
 * on the target in one place, and a new kind of target is a compile error
 * here rather than a silent fall into the kit branch elsewhere.
 *
 * @see {@link file://./history.server.ts}
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../../components/scan/scan-history-sheet.tsx}
 */

/** The item whose scans are read: an asset or a kit, never both. */
export type ScanTarget = { assetId: string } | { kitId: string };

/**
 * The target as the filter its scans are read by, and as the query string
 * the scan history endpoint takes.
 *
 * @param target - The asset or kit
 * @returns `{ assetId }` or `{ kitId }`
 */
export function scanTargetFilter(
  target: ScanTarget
): { assetId: string } | { kitId: string } {
  return "assetId" in target
    ? { assetId: target.assetId }
    : { kitId: target.kitId };
}

/**
 * A key naming the target, kind included, so an asset and a kit that share an
 * id can never be taken for one another.
 *
 * @param target - The asset or kit
 * @returns `asset:<id>` or `kit:<id>`
 */
export function scanTargetKey(target: ScanTarget): string {
  return "assetId" in target
    ? `asset:${target.assetId}`
    : `kit:${target.kitId}`;
}
