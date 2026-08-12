/**
 * Custody-driven `Asset.status` writes.
 *
 * Custody and bookings are independent commitments that share ONE column, so
 * without a rule the last writer wins. The rule is a precedence:
 *
 * ```
 * CHECKED_OUT > IN_CUSTODY > AVAILABLE
 * ```
 *
 * **Booking flows own the exit from `CHECKED_OUT`. Custody flows never decide
 * it.** Assigning custody to an asset already out on a booking must not erase
 * `CHECKED_OUT`, and releasing the last custody row must not advertise a
 * physically absent asset as free.
 *
 * Both directions were live defects. The release direction is the more
 * dangerous: an asset out on an ONGOING booking would return to every picker,
 * index and availability sum as `AVAILABLE`, overstating free stock by exactly
 * the booked quantity.
 *
 * ## Why the guard is on the WHERE clause
 *
 * `status: { not: CHECKED_OUT }` lives in the `where` rather than in a
 * read-then-write, so it evaluates against the row at write time inside the
 * caller's transaction. A pre-check outside the transaction is a TOCTOU gap: a
 * checkout committing between the read and the write would be silently
 * overwritten, which is the exact class this module exists to close.
 *
 * ## Two shapes of the same bug
 *
 * - **Release → `AVAILABLE`.** Releasing custody on an asset with units still
 *   out on an ONGOING booking advertised it as free everywhere while it was
 *   physically gone.
 * - **Assign → `IN_CUSTODY`.** Taking a kit into custody, or adding an asset to
 *   an already-custodied kit, erased `CHECKED_OUT`, so the checked-out units
 *   stopped being counted and `Available` overstated free stock. Note that the
 *   add-to-custodied-kit path filters on `hasCustody` alone, which does NOT
 *   exclude a checked-out asset — custody absence and checkout absence are
 *   different questions.
 *
 * Every custody-driven status write routes through here — `assignCustody`,
 * `bulkAssignKitCustody`, `updateKitAssets` (add and remove), `releaseCustody`,
 * `bulkReleaseKitCustody`, `bulkRemoveAssetsFromKits`, kit deletion,
 * `checkOutQuantity`, `releaseQuantity` and `bulkCheckOutAssets` — so the
 * rationale lives in one place, the guard cannot drift between them, and the
 * call sites stay one line.
 *
 * @see {@link file://./../kit/service.server.ts} — kit custody flows
 * @see {@link file://./../custody/service.server.ts} — single-asset release
 * @see {@link file://./service.server.ts} — quantity custody + bulk checkout
 */
import { AssetStatus } from "@prisma/client";

/**
 * Sets `Asset.status` for a custody flow, refusing to disturb `CHECKED_OUT`.
 *
 * @param tx - Interactive transaction client. Required: the status write must
 *   commit or roll back with the custody rows it accompanies.
 * @param assetIds - Assets to update. An empty array is a no-op.
 * @param organizationId - Caller's org; scopes the write.
 * @param nextStatus - The status a custody flow wants to set.
 * @returns Number of rows actually updated. A shortfall means at least one
 *   asset was `CHECKED_OUT` and was correctly left alone — callers that need
 *   to report on the outcome should read it rather than assume.
 */
export async function setCustodyDrivenAssetStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  assetIds: string[],
  organizationId: string,
  nextStatus: AssetStatus
): Promise<number> {
  if (assetIds.length === 0) return 0;

  const { count } = await tx.asset.updateMany({
    where: {
      id: { in: assetIds },
      organizationId,
      // The whole point. See the module JSDoc.
      status: { not: AssetStatus.CHECKED_OUT },
    },
    data: { status: nextStatus },
  });

  return count;
}

/**
 * Returns assets to `AVAILABLE` after their last custody row has gone.
 *
 * Thin alias over {@link setCustodyDrivenAssetStatus} that names the intent at
 * release call sites, where "set status to AVAILABLE" reads as unconditional
 * and this emphatically is not.
 */
export async function releaseAssetsToAvailableUnlessCheckedOut(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  assetIds: string[],
  organizationId: string
): Promise<number> {
  return setCustodyDrivenAssetStatus(
    tx,
    assetIds,
    organizationId,
    AssetStatus.AVAILABLE
  );
}
