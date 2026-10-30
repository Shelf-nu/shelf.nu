/**
 * Booking end-date change eligibility
 *
 * The state rules `extendBooking` applies before it measures a new end, later
 * or earlier: the booking has started (ONGOING or OVERDUE), and something on
 * it is still out.
 * Kept pure and in one place so the mobile booking detail offers "Extend
 * booking" on exactly the bookings the service accepts, and the extend
 * endpoints refuse the same statuses the service does.
 *
 * @see {@link file://./service.server.ts} `extendBooking`, the rule's owner
 * @see {@link file://../../routes/api+/mobile+/bookings.$bookingId.ts} the `canExtend` flag
 * @see {@link file://../../routes/api+/mobile+/bookings.extend.ts} the mobile extend endpoint
 */
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";

/** Statuses in which a booking's end date can change. */
export const EXTENDABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * Whether a booking in this status can have its end date changed.
 *
 * @param status - The booking's status
 * @returns `true` for ONGOING and OVERDUE
 */
export function isExtendableStatus(status: BookingStatus): boolean {
  return EXTENDABLE_BOOKING_STATUSES.includes(status);
}

/**
 * The asset fields the "still out" rules read. `type` lets the quantity rule
 * pick out pool items; without it no asset is treated as one.
 */
type ExtendAsset = { id: string; status: AssetStatus; type?: AssetType };

/** The slice markers the "kit still out" and "units still out" rules read. */
type ExtendSlice = {
  assetId?: string;
  assetKitId: string | null;
  checkedOutAt: Date | null;
  checkedInAt: Date | null;
};

/**
 * The booking's assets that are still out and not returned by a partial
 * check-in.
 *
 * @param assets - The assets on the booking
 * @param checkedInAssetIds - Assets returned through partial check-in
 * @returns The assets a new end keeps out
 */
export function getAssetsStillOutForExtend<T extends ExtendAsset>(
  assets: T[],
  checkedInAssetIds: string[]
): T[] {
  const checkedIn = new Set(checkedInAssetIds);
  return assets.filter(
    (asset) =>
      (asset.status === AssetStatus.CHECKED_OUT ||
        asset.status === AssetStatus.IN_CUSTODY) &&
      !checkedIn.has(asset.id)
  );
}

/**
 * Kit memberships this booking still has out, read from the slice markers.
 *
 * A kit is one physical case, so one still out stays exclusive to this booking
 * through the extension. The markers answer for quantity-tracked members too,
 * whose asset status only flips to CHECKED_OUT once every unit booked on the
 * asset has left.
 *
 * @param slices - The booking's BookingAsset rows
 * @returns The `assetKitId` of every kit slice that is out and not back
 */
export function getKitMembershipIdsStillOut(slices: ExtendSlice[]): string[] {
  return slices.flatMap((slice) =>
    slice.assetKitId && slice.checkedOutAt && !slice.checkedInAt
      ? [slice.assetKitId]
      : []
  );
}

/**
 * Quantity-tracked assets this booking still has units of out on a
 * standalone slice, read from the slice markers.
 *
 * A pool item's `Asset.status` is shared by every booking holding its units
 * and turns CHECKED_OUT only once every booked unit has left, so it cannot
 * say whether this booking's units are out. The slice can: `checkedOutAt` is
 * set when its first unit leaves, and `checkedInAt` only once it is fully
 * reconciled. Kit-driven slices are left to {@link getKitMembershipIdsStillOut}.
 *
 * @param args.assets - The assets on the booking, with their `type`
 * @param args.slices - The booking's BookingAsset rows, with their `assetId`
 * @returns The ids of the quantity-tracked assets with units still out
 */
export function getQuantityAssetIdsStillOut({
  assets,
  slices,
}: {
  assets: ExtendAsset[];
  slices: ExtendSlice[];
}): string[] {
  const pools = new Set(
    assets.filter((a) => a.type === AssetType.QUANTITY_TRACKED).map((a) => a.id)
  );
  const out = new Set<string>();
  for (const slice of slices) {
    if (
      slice.assetId &&
      pools.has(slice.assetId) &&
      !slice.assetKitId &&
      slice.checkedOutAt &&
      !slice.checkedInAt
    ) {
      out.add(slice.assetId);
    }
  }
  return [...out];
}

/**
 * Whether anything on the booking is still out, so a new end has something to
 * keep. A booking with everything returned is completed, not given a new end.
 *
 * @param args.assets - The assets on the booking
 * @param args.checkedInAssetIds - Assets returned through partial check-in
 * @param args.slices - The booking's BookingAsset rows
 * @returns `true` when an asset, a kit or units of a pool are still out
 */
export function hasItemsStillOutToExtend({
  assets,
  checkedInAssetIds,
  slices,
}: {
  assets: ExtendAsset[];
  checkedInAssetIds: string[];
  slices: ExtendSlice[];
}): boolean {
  return (
    getAssetsStillOutForExtend(assets, checkedInAssetIds).length > 0 ||
    getKitMembershipIdsStillOut(slices).length > 0 ||
    getQuantityAssetIdsStillOut({ assets, slices }).length > 0
  );
}
