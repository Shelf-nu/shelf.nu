import { AssetStatus, KitStatus } from "@prisma/client";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";

export type AssetWithStatus = {
  id: string;
  status: string;
  [key: string]: any;
};

export type KitWithStatus = {
  id: string;
  status: string;
  assets?: AssetWithStatus[];
  [key: string]: any;
};

/**
 * Booking-context status extensions beyond the raw Prisma `AssetStatus`:
 *
 * - `PARTIALLY_CHECKED_IN` — INDIVIDUAL-asset flow OR a fully-reconciled
 *   QUANTITY_TRACKED row (`dispositioned >= booked` for THIS row). Rendered
 *   as "Already checked in" (blue).
 * - `PARTIALLY_CHECKED_IN_QTY` — legacy Phase 3c label. Kept for callers
 *   that need the "Partially checked in" wording. Rendered amber.
 * - `PARTIALLY_CHECKED_OUT_QTY` — QUANTITY_TRACKED, this row has SOME
 *   units dispositioned but `remaining > 0`. Rendered as "Partially
 *   checked out" (violet) to emphasise that work is still outstanding.
 *   Booking rows use this in preference to `PARTIALLY_CHECKED_IN_QTY`
 *   so the user sees "still partly out" rather than "already partly in".
 */
export type ExtendedAssetStatus =
  | AssetStatus
  | "PARTIALLY_CHECKED_IN"
  | "PARTIALLY_CHECKED_IN_QTY"
  | "PARTIALLY_CHECKED_OUT_QTY";
export type ExtendedKitStatus = KitStatus | "PARTIALLY_CHECKED_IN";

/**
 * Context-aware asset status resolver for booking operations.
 *
 * Determines the effective status of an asset within a booking context:
 * - INDIVIDUAL asset, partial check-in + booking ONGOING/OVERDUE → PARTIALLY_CHECKED_IN
 * - INDIVIDUAL asset, otherwise → raw `Asset.status`
 *
 * QUANTITY_TRACKED assets need a different treatment for DRAFT/RESERVED
 * bookings. The global `Asset.status` (e.g. `CHECKED_OUT`) can reflect
 * state from a *different* active booking or stale data from a prior
 * cancellation — neither is relevant to a DRAFT/RESERVED row in the
 * current booking, and surfacing "Checked out" there is misleading
 * ("this booking hasn't checked anything out yet"). So for qty-tracked
 * assets we hard-override to `AVAILABLE` when the booking is
 * DRAFT/RESERVED, letting the row focus on this booking's own progress
 * (reserved qty, disposition indicator) rather than global pool state.
 */
export function getBookingContextAssetStatus(
  asset: AssetWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): ExtendedAssetStatus {
  // Check if asset is partially checked in within this booking context
  const hasPartialCheckin = Boolean(partialCheckinDetails[asset.id]);

  // Only show as PARTIALLY_CHECKED_IN for active bookings
  // For COMPLETE bookings, assets should show as its Real status
  if (
    hasPartialCheckin &&
    bookingStatus &&
    ["ONGOING", "OVERDUE"].includes(bookingStatus)
  ) {
    return "PARTIALLY_CHECKED_IN";
  }

  /**
   * QUANTITY_TRACKED + DRAFT/RESERVED: the per-row badge should reflect
   * *this* booking's state, not the shared pool's. "Checked out" leaking
   * in from a prior booking (or from stale data) is noise at best and
   * incorrect at worst. Force AVAILABLE; the qty progress indicator
   * elsewhere in the row surfaces whatever real signal exists.
   */
  const isQtyTracked = (asset as { type?: string }).type === "QUANTITY_TRACKED";
  if (
    isQtyTracked &&
    (bookingStatus === "DRAFT" || bookingStatus === "RESERVED")
  ) {
    return AssetStatus.AVAILABLE;
  }

  return asset.status as AssetStatus;
}

/**
 * Helper to check if asset is effectively checked out in booking context
 * Returns true if asset needs to be checked in (not partially checked in)
 */
export function isAssetCheckedOutInBooking(
  asset: AssetWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): boolean {
  const contextStatus = getBookingContextAssetStatus(
    asset,
    partialCheckinDetails,
    bookingStatus
  );
  return contextStatus === AssetStatus.CHECKED_OUT;
}

/**
 * Helper to check if asset is partially checked in within booking
 * Only returns true for ONGOING/OVERDUE bookings, false for COMPLETE bookings
 */
export function isAssetPartiallyCheckedIn(
  asset: AssetWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingStatus: string
): boolean {
  const hasPartialCheckin = Boolean(partialCheckinDetails[asset.id]);

  if (!hasPartialCheckin) {
    return false;
  }

  // Only consider as "partially checked in" for active & finished bookings
  return ["ONGOING", "OVERDUE", "COMPLETE", "ARCHIVED"].includes(bookingStatus);
}

/**
 * Context-aware kit status resolver for booking operations
 *
 * Determines the effective status of a kit within a booking context:
 * - If ALL kit assets in booking have partial check-in details AND booking is ONGOING/OVERDUE -> PARTIALLY_CHECKED_IN
 * - If ALL kit assets in booking have partial check-in details AND booking is COMPLETE -> AVAILABLE
 * - Otherwise -> original database status
 *
 * This follows kit logic: Available = ALL assets available, Checked In = ALL assets checked in
 */
export function getBookingContextKitStatus(
  kit: KitWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingAssetIds: Set<string>,
  bookingStatus: string
): ExtendedKitStatus {
  const kitAssetsInBooking =
    kit.assets?.filter((asset) => bookingAssetIds.has(asset.id)) || [];

  /**
   * "All checked in" needs per-row awareness for QUANTITY_TRACKED kit
   * members. `partialCheckinDetails` is keyed by `assetId` and only
   * surfaces an asset when it's fully reconciled across the whole
   * booking — but with Polish-6 multi-row slices a qty-tracked member
   * can have its kit-driven slice fully reconciled (the only slice
   * relevant to this kit) while a parallel standalone slice still has
   * outstanding units. Fall back to per-row `bookedQuantity` vs
   * `dispositionedQuantity` when those are available on the asset.
   * INDIVIDUAL members keep the original `partialCheckinDetails` check.
   */
  const allAssetsCheckedIn =
    kitAssetsInBooking.length > 0 &&
    kitAssetsInBooking.every((asset) => {
      const a = asset as AssetWithStatus & {
        type?: string;
        bookedQuantity?: number;
        dispositionedQuantity?: number;
      };
      if (a.type === "QUANTITY_TRACKED") {
        const booked = a.bookedQuantity ?? 0;
        const dispositioned = a.dispositionedQuantity ?? 0;
        return booked > 0 && dispositioned >= booked;
      }
      return Boolean(partialCheckinDetails[asset.id]);
    });

  // Only show as PARTIALLY_CHECKED_IN for active bookings
  // For COMPLETE bookings, kits should show as AVAILABLE
  if (
    allAssetsCheckedIn &&
    bookingStatus &&
    ["ONGOING", "OVERDUE"].includes(bookingStatus)
  ) {
    return "PARTIALLY_CHECKED_IN";
  }

  return kit.status as KitStatus;
}

/**
 * Helper to check if kit is effectively checked out in booking context
 * Returns true if kit needs to be checked in (not all assets checked in)
 */
export function isKitCheckedOutInBooking(
  kit: KitWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingAssetIds: Set<string>,
  bookingStatus: string
): boolean {
  const contextStatus = getBookingContextKitStatus(
    kit,
    partialCheckinDetails,
    bookingAssetIds,
    bookingStatus
  );
  return contextStatus === KitStatus.CHECKED_OUT;
}

/**
 * Helper to check if kit is partially checked in within booking
 * A kit is considered partially checked in only if ALL of its assets in the booking are checked in
 * AND the booking is ONGOING/OVERDUE (not COMPLETE)
 * This follows kit logic: Available = ALL assets available, Checked In = ALL assets checked in
 */
export function isKitPartiallyCheckedIn(
  kit: KitWithStatus,
  partialCheckinDetails: PartialCheckinDetailsType,
  bookingAssetIds: Set<string>,
  bookingStatus: string
): boolean {
  const contextStatus = getBookingContextKitStatus(
    kit,
    partialCheckinDetails,
    bookingAssetIds,
    bookingStatus
  );
  return contextStatus === "PARTIALLY_CHECKED_IN";
}

/**
 * Sorts booking assets by priority:
 * 1. CHECKED_OUT assets (need to be checked in)
 * 2. PARTIALLY_CHECKED_IN assets (already checked in, ordered by most recent)
 * 3. AVAILABLE assets
 */
export function sortBookingAssets<T extends AssetWithStatus>(
  assets: T[],
  partialCheckinDetails: PartialCheckinDetailsType
): T[] {
  return assets.sort((a, b) => {
    // Check if assets have partial check-in dates
    const aPartialCheckin = partialCheckinDetails[a.id];
    const bPartialCheckin = partialCheckinDetails[b.id];

    // Priority order: CHECKED_OUT first, then PARTIALLY_CHECKED_IN, then AVAILABLE
    const getStatusPriority = (asset: T, hasPartialCheckin: boolean) => {
      if (asset.status === "CHECKED_OUT" && !hasPartialCheckin) return 1; // CHECKED_OUT
      if (hasPartialCheckin) return 2; // PARTIALLY_CHECKED_IN
      return 3; // AVAILABLE
    };

    const aPriority = getStatusPriority(a, !!aPartialCheckin);
    const bPriority = getStatusPriority(b, !!bPartialCheckin);

    // Sort by priority first
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // Within same priority, sort partial check-ins by most recent first
    if (aPartialCheckin && bPartialCheckin) {
      return (
        new Date(bPartialCheckin.checkinDate).getTime() -
        new Date(aPartialCheckin.checkinDate).getTime()
      );
    }

    // Finally, sort by asset ID as fallback for consistency
    return a.id.localeCompare(b.id);
  });
}
