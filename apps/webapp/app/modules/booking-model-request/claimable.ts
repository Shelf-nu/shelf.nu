/**
 * Which assets already on a booking can still answer a model reservation.
 *
 * A scanner drawer renders a "now counts toward <model>" badge and moves a
 * per-model progress strip off this answer, while the write that has to agree
 * with it happens later and elsewhere. The two rules therefore have to be one
 * rule, which is why it lives here rather than inline in a loader: a looser
 * client-side version shows the operator a fulfilment the server refuses, and
 * the booking goes out with the reservation still owing a unit. Nothing throws
 * and no number looks wrong, so only reading both sides catches a divergence.
 *
 * Pure and dependency-free so a route may import it: see
 * `.claude/rules/no-server-module-in-route-client-exports.md`.
 *
 * @see {@link file://./service.server.ts} for `fulfilModelRequestsForAssets`,
 *   the write whose conditions these mirror.
 */
import { AssetType } from "@prisma/client";

/**
 * One `BookingAsset` row, reduced to what claimability depends on.
 *
 * Deliberately structural rather than a Prisma type: the loaders that call
 * this select different shapes, and widening one of them should not be the
 * thing that makes this compile.
 */
export type BookingAssetRowForClaim = {
  /** `null` for a standalone row, set for a kit-driven slice. */
  assetKitId: string | null;
  /** The reservation this row already answered, if any. */
  bookingModelRequestId: string | null;
  asset: { id: string; type: AssetType };
};

/**
 * The ids of assets whose rows make them claimable by a scan.
 *
 * Three conditions, all of them the server's:
 *
 * - **A standalone row carrying no stamp.** Such a row answers nothing yet: it
 *   arrived before the reservation existed, through a re-save, or before the
 *   asset's model matched one. Kit-driven rows are excluded because a
 *   reservation promises loose units, and a kit's are answered by scanning the
 *   kit.
 * - **No stamp on any of that asset's rows.** One physical unit discharges one
 *   reserved unit however it reached the booking, so an asset holding a stamp
 *   anywhere is refused, kit rows included. The unstamped-standalone plus
 *   stamped-kit pair is ordinary: it is what a kit member later scanned loose
 *   looks like.
 * - **`INDIVIDUAL`.** A reserved unit is a whole unit, so a quantity-tracked
 *   pool never answers one.
 *
 * @param bookingAssets - Every `BookingAsset` row on the booking, not just the
 *   candidates. The second condition is a fact about the asset across all its
 *   rows, so a filtered list would silently answer a different question.
 * @returns The claimable asset ids.
 */
export function resolveClaimableAssetIds(
  bookingAssets: BookingAssetRowForClaim[]
): Set<string> {
  const stampedAssetIds = new Set(
    bookingAssets
      .filter((row) => row.bookingModelRequestId !== null)
      .map((row) => row.asset.id)
  );

  return new Set(
    bookingAssets
      .filter(
        (row) =>
          row.assetKitId === null &&
          row.bookingModelRequestId === null &&
          row.asset.type === AssetType.INDIVIDUAL &&
          !stampedAssetIds.has(row.asset.id)
      )
      .map((row) => row.asset.id)
  );
}
