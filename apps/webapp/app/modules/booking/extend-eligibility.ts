/**
 * Booking extension eligibility
 *
 * The state rules `extendBooking` applies before it measures a new end: the
 * booking has started (ONGOING or OVERDUE), and something on it is still out.
 * Kept pure and in one place so the mobile booking detail offers "Extend
 * booking" on exactly the bookings the service accepts, and the extend
 * endpoints refuse the same statuses the service does.
 *
 * @see {@link file://./service.server.ts} `extendBooking`, the rule's owner
 * @see {@link file://../../routes/api+/mobile+/bookings.$bookingId.ts} the `canExtend` flag
 * @see {@link file://../../routes/api+/mobile+/bookings.extend.ts} the mobile extend endpoint
 */
import { AssetStatus, BookingStatus } from "@prisma/client";

/** Statuses a booking can be extended from. */
export const EXTENDABLE_BOOKING_STATUSES: readonly BookingStatus[] = [
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * Whether a booking in this status can be extended.
 *
 * @param status - The booking's status
 * @returns `true` for ONGOING and OVERDUE
 */
export function isExtendableStatus(status: BookingStatus): boolean {
  return EXTENDABLE_BOOKING_STATUSES.includes(status);
}

/** The asset fields the "still out" rule reads. */
type ExtendAsset = { id: string; status: AssetStatus };

/** The slice markers the "kit still out" rule reads. */
type ExtendSlice = {
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
 * @returns The assets an extension keeps out
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
 * Whether anything on the booking is still out, so an extension has something
 * to keep. A booking with everything returned is completed, not extended.
 *
 * @param args.assets - The assets on the booking
 * @param args.checkedInAssetIds - Assets returned through partial check-in
 * @param args.slices - The booking's BookingAsset rows
 * @returns `true` when an asset or a kit is still out
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
    getKitMembershipIdsStillOut(slices).length > 0
  );
}
