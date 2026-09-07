/**
 * Kit Manage-Assets Picker Metadata
 *
 * Computes the per-asset `PickerAssetMeta` payload consumed by the kit
 * manage-assets picker (`/kits/$kitId/assets/manage-assets`). The picker
 * shows a qty input alongside QUANTITY_TRACKED rows, bounded by the
 * strict-available pool of units the kit may claim.
 *
 * Lives next to the kit service (rather than inline in the route) so
 * the route's loader stays readable and the strict-available formula
 * has one canonical implementation that can be tested in isolation.
 * The server-side re-validation in `updateKitAssets` follows the same
 * math — keep both in sync if you tweak the formula.
 *
 * @see {@link file://./../../routes/_layout+/kits.$kitId.assets.manage-assets.tsx}
 * @see {@link file://./service.server.ts} — `updateKitAssets` re-validates with the same formula
 */

import { AssetType } from "@prisma/client";

import { db } from "~/database/db.server";
import { getPeakReservedUnitsByAsset } from "~/modules/asset/availability-primitives.server";

/**
 * Per-asset picker metadata for QUANTITY_TRACKED rows.
 *
 * Drives the qty input's MAX and surfaces the "also in Kit X (N)"
 * indicator when the same qty-tracked asset is already in other kits.
 * INDIVIDUAL rows skip this entirely — they don't render a qty input.
 */
export type PickerAssetMeta = {
  /** `Asset.quantity` — the total pool the asset's units share. */
  assetQuantity: number;
  /** `AssetKit.quantity` for THIS kit (0 if the asset isn't in the kit yet). */
  currentInThisKit: number;
  /** AssetKit rows for kits other than this one — for the "also in" indicator. */
  inOtherKits: { kitId: string; kitName: string; quantity: number }[];
  /** Sum of operator-only `Custody.quantity` (kitCustodyId IS NULL). */
  operatorCustodyTotal: number;
  /** Sum of `BookingAsset.quantity` for ONGOING / OVERDUE bookings. */
  ongoingBookingTotal: number;
  /**
   * Strict-available pool — the upper bound on what this kit may claim.
   * Equals `max(currentInThisKit, spaceWithoutMe)` so the user can keep
   * their existing slice in the overcommitted edge case (operator /
   * booking growth pushed the pool below the kit's current allocation).
   */
  maxAllowedForThisKit: number;
  /** Unit of measure label (passed through for the qty input suffix). */
  unitOfMeasure: string | null;
};

/**
 * How many units of one asset a given kit may hold.
 *
 * Shared so the picker and the write guard cannot answer differently — the
 * guard exists to refuse what the picker would not have offered, which only
 * holds while both compute the same number.
 *
 * @param args.totalQuantity - `Asset.quantity`, the whole pool
 * @param args.currentInThisKit - what this kit already holds
 * @param args.otherKitsQuantity - Σ of every other kit's `AssetKit.quantity`
 * @param args.operatorCustodyQuantity - Σ of operator-only `Custody.quantity`
 * @param args.occupyingBookedQuantity - peak concurrent standalone booked
 *   units, from {@link getPeakReservedUnitsByAsset}
 * @returns `spaceWithoutMe` (the pool ignoring this kit) and the ceiling the
 *   picker offers, which keeps an over-committed slice reducible rather than
 *   locking the user out of fixing it
 */
export function computeKitClaimablePool({
  totalQuantity,
  currentInThisKit,
  otherKitsQuantity,
  operatorCustodyQuantity,
  occupyingBookedQuantity,
}: {
  totalQuantity: number;
  currentInThisKit: number;
  otherKitsQuantity: number;
  operatorCustodyQuantity: number;
  occupyingBookedQuantity: number;
}): { spaceWithoutMe: number; maxAllowedForThisKit: number } {
  const spaceWithoutMe = Math.max(
    0,
    totalQuantity -
      otherKitsQuantity -
      operatorCustodyQuantity -
      occupyingBookedQuantity
  );

  return {
    spaceWithoutMe,
    maxAllowedForThisKit: Math.max(currentInThisKit, spaceWithoutMe),
  };
}

/**
 * Fetches and computes `PickerAssetMeta` for every QUANTITY_TRACKED
 * asset in `assetIds`. INDIVIDUAL ids are silently ignored.
 *
 * Strict-available formula:
 *
 *     spaceWithoutMe = Asset.quantity
 *                    − sum(other kits' AssetKit.quantity)
 *                    − sum(operator-only Custody.quantity)
 *                    − sum(ongoing / overdue BookingAsset.quantity)
 *     max            = max(currentInThisKit, spaceWithoutMe)
 *
 * Three subtleties:
 *
 *   1. Operator-only custody filters by `kitCustodyId IS NULL`. Rows
 *      where `kitCustodyId` points to a KitCustody are the materialised
 *      side of another kit's AssetKit slice — counting them on top of
 *      that kit's AssetKit row would double-count.
 *
 *   2. `max(currentInThisKit, spaceWithoutMe)` (not just spaceWithoutMe)
 *      lets the user keep or reduce an over-committed slice. Real-world
 *      creation paths shouldn't reach that state, but if they do the
 *      picker shouldn't lock the user out of fixing it.
 *
 *   3. We re-fetch the assets here even though the route loader already
 *      pulls them via `getPaginatedAndFilterableAssets`. The view-style
 *      payload that helper returns doesn't carry the relations we need
 *      (`assetKits[].kit`, `custody.kitCustodyId`, `bookingAssets`), and
 *      hydrating it would mean threading those relations into the
 *      shared list view used everywhere. Cheaper to do a second narrow
 *      fetch scoped to the qty-tracked rows on this page.
 *
 * @param kitId          The kit whose picker is being rendered.
 * @param organizationId The acting org — scopes the fetch.
 * @param assetIds       Asset ids visible on the current picker page. Mixed
 *                       types ok; the helper filters INDIVIDUAL out itself.
 * @returns              A `Map<assetId, PickerAssetMeta>` covering only the
 *                       QUANTITY_TRACKED ids. Callers should treat a missing
 *                       entry as "render no qty input for this row".
 */
export async function getKitPickerMeta({
  kitId,
  organizationId,
  assetIds,
}: {
  kitId: string;
  organizationId: string;
  assetIds: string[];
}): Promise<Map<string, PickerAssetMeta>> {
  if (assetIds.length === 0) return new Map();

  const rows = await db.asset.findMany({
    where: {
      id: { in: assetIds },
      organizationId,
      type: AssetType.QUANTITY_TRACKED,
    },
    select: {
      id: true,
      quantity: true,
      unitOfMeasure: true,
      assetKits: {
        select: {
          kitId: true,
          quantity: true,
          kit: { select: { id: true, name: true } },
        },
      },
      // `kitCustodyId` distinguishes operator-allocated rows from rows
      // that are the materialised custody of a kit. See subtlety (1).
      custody: { select: { quantity: true, kitCustodyId: true } },
    },
  });

  const peakReservedByAsset = await getPeakReservedUnitsByAsset({
    assetIds: rows.map((row) => row.id),
    organizationId,
    tx: db,
  });

  return new Map(
    rows.map((row) => {
      const totalQty = row.quantity ?? 0;
      const otherKits = row.assetKits.filter((ak) => ak.kitId !== kitId);
      const thisKitRow = row.assetKits.find((ak) => ak.kitId === kitId);
      const otherKitsQty = otherKits.reduce(
        (sum, ak) => sum + (ak.quantity ?? 0),
        0
      );
      const currentInThisKit = thisKitRow?.quantity ?? 0;
      const operatorCustodyTotal = row.custody
        .filter((c) => c.kitCustodyId == null)
        .reduce((sum, c) => sum + (c.quantity ?? 0), 0);
      // Peak, not sum: a kit slice has no dates, so it competes with the
      // highest demand at any one instant. Two reservations that never
      // overlap never hold units together.
      const ongoingBookingTotal = peakReservedByAsset.get(row.id) ?? 0;
      const { maxAllowedForThisKit } = computeKitClaimablePool({
        totalQuantity: totalQty,
        currentInThisKit,
        otherKitsQuantity: otherKitsQty,
        operatorCustodyQuantity: operatorCustodyTotal,
        occupyingBookedQuantity: ongoingBookingTotal,
      });

      const meta: PickerAssetMeta = {
        assetQuantity: totalQty,
        currentInThisKit,
        inOtherKits: otherKits.map((ak) => ({
          kitId: ak.kit.id,
          kitName: ak.kit.name,
          quantity: ak.quantity,
        })),
        operatorCustodyTotal,
        ongoingBookingTotal,
        maxAllowedForThisKit,
        unitOfMeasure: row.unitOfMeasure,
      };
      return [row.id, meta];
    })
  );
}
