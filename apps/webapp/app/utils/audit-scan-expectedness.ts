/**
 * Whether a scanned row belonged to the audit.
 *
 * The audit scan screen normally answers this by looking the asset up in the
 * expected list. That fails for exactly one row: a scan whose asset has been
 * DELETED. Deleting an asset cascades away its `AuditAsset` row, so it can
 * never appear in the expected list, and the restored row's `id` is empty —
 * which makes a membership test report "unexpected", or, where the id is used
 * as a truthiness guard, report neither expected nor unexpected.
 *
 * Those rows carry the answer with them instead: the server resolves
 * expectedness from the scan's own `wasExpected` snapshot and sends it as
 * `isExpected`. This is the one place that decides between the two sources, so
 * the drawer's counts and the row's badge cannot disagree.
 *
 * @see {@link file://./../components/audit/audit-drawer.tsx}
 * @see {@link file://./../components/audit/audit-item-row.tsx}
 */
export function resolveScannedExpectedness({
  assetId,
  assetDeleted,
  isExpected,
  expectedAssetIds,
}: {
  /** The scanned asset's id — empty string once the asset is deleted. */
  assetId: string | undefined;
  /** True when the asset behind this scan has been deleted. */
  assetDeleted: boolean | undefined;
  /** The server's resolved expectedness, from the scan's snapshot. */
  isExpected: boolean | undefined;
  /** Ids of the assets the audit expects. */
  expectedAssetIds: Set<string>;
}): boolean {
  if (assetDeleted) {
    return isExpected === true;
  }

  return !!assetId && expectedAssetIds.has(assetId);
}
