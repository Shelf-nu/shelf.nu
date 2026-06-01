import { AssetStatus, KitStatus } from "@prisma/client";
import type { PartialCheckinDetailsType } from "~/modules/booking/service.server";

/**
 * Minimal asset shape these booking-context helpers need: an `id` and a raw
 * `status` string. The index signature lets callers pass richer asset objects
 * (e.g. Prisma rows) without widening every call site.
 */
export type AssetWithStatus = {
  id: string;
  status: string;
  [key: string]: any;
};

/**
 * Minimal kit shape these helpers need: an `id`, a raw `status`, and optionally
 * its member assets (used to roll a kit's status up from its assets). The index
 * signature allows passing richer kit objects without widening call sites.
 */
export type KitWithStatus = {
  id: string;
  status: string;
  assets?: AssetWithStatus[];
  [key: string]: any;
};

/**
 * Asset status as surfaced in a booking context: the persisted {@link AssetStatus}
 * plus the synthetic `"PARTIALLY_CHECKED_IN"` state, which only exists relative
 * to a specific booking and is never stored on the asset itself.
 */
export type ExtendedAssetStatus = AssetStatus | "PARTIALLY_CHECKED_IN";

/**
 * Kit status as surfaced in a booking context: the persisted {@link KitStatus}
 * plus the synthetic `"PARTIALLY_CHECKED_IN"` state (all member assets checked
 * in while the booking is still active). Not stored on the kit itself.
 */
export type ExtendedKitStatus = KitStatus | "PARTIALLY_CHECKED_IN";

/**
 * Context-aware asset status resolver for booking operations
 *
 * Determines the effective status of an asset within a booking context:
 * - If asset has partial check-in details AND booking is ONGOING/OVERDUE -> PARTIALLY_CHECKED_IN
 * - If asset has partial check-in details AND booking is COMPLETE -> AVAILABLE
 * - Otherwise -> original database status
 *
 * This ensures consistent logic across validation, display, and business operations
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
 * Human-readable check-in label for a single booking asset, for use in the
 * bookings CSV export.
 *
 * Mirrors the partial check-in semantics used across the booking UI
 * ({@link getBookingContextAssetStatus}, {@link calculatePartialCheckinProgress})
 * but flattens them to the three plain-text tokens an export consumer needs:
 *
 * - `"Checked in"`  — the asset has been returned. True when the booking is in
 *   a final state (COMPLETE/ARCHIVED, where every asset is returned by
 *   definition) OR when the asset appears in the booking's partial check-ins
 *   while the booking is still ONGOING/OVERDUE.
 * - `"Checked out"` — the booking is active (ONGOING/OVERDUE) and the asset has
 *   not yet been checked in.
 * - `""` (blank)    — check-in status does not apply. Covers DRAFT/RESERVED
 *   (nothing was ever checked out) and CANCELLED. CANCELLED is deliberately
 *   blank rather than labeled: `cancelBooking` returns assets to AVAILABLE only
 *   when cancelling from ONGOING/OVERDUE, but a RESERVED→CANCELLED booking never
 *   checked its assets out — and both collapse to the same `CANCELLED` status
 *   here, so we cannot tell them apart from status alone. Any affirmative label
 *   would be wrong for one path; blank is the only non-misleading value. The
 *   booking-level `Status`/rollup columns still show "Cancelled" and `0 / N`.
 *
 * The tokens are deliberately exact and status-agnostic so a downstream script
 * (e.g. a reminder workflow) can filter to "Checked out" across both
 * Checked-Out and Overdue bookings without parsing prose. A blank CANCELLED row
 * correctly yields no reminder (it won't match a "Checked out" filter).
 *
 * @param assetId - The asset whose label to resolve
 * @param checkedInAssetIds - Set of asset IDs partially checked in for the booking
 * @param bookingStatus - The parent booking's status (BookingStatus value)
 * @returns The export label: "Checked in", "Checked out", or "" when N/A
 */
export function getBookingAssetCheckinLabel(
  assetId: string,
  checkedInAssetIds: Set<string>,
  bookingStatus: string
): "Checked in" | "Checked out" | "" {
  // Final booking states: every asset is returned by definition.
  if (["COMPLETE", "ARCHIVED"].includes(bookingStatus)) {
    return "Checked in";
  }

  // Active states: distinguish returned vs still-out per asset.
  if (["ONGOING", "OVERDUE"].includes(bookingStatus)) {
    return checkedInAssetIds.has(assetId) ? "Checked in" : "Checked out";
  }

  // DRAFT / RESERVED — nothing was ever checked out.
  // CANCELLED — ambiguous (could be RESERVED→CANCELLED, never out, or
  // ONGOING/OVERDUE→CANCELLED, returned on cancel); blank is the only
  // non-misleading value since status alone can't distinguish them. See JSDoc.
  return "";
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

  // Check if ALL kit assets in booking are partially checked in
  const allAssetsCheckedIn =
    kitAssetsInBooking.length > 0 &&
    kitAssetsInBooking.every((asset) =>
      Boolean(partialCheckinDetails[asset.id])
    );

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
  const kitAssetsInBooking =
    kit.assets?.filter((asset) => bookingAssetIds.has(asset.id)) || [];

  // Check if ALL kit assets in booking are checked in
  const allAssetsCheckedIn =
    kitAssetsInBooking.length > 0 &&
    kitAssetsInBooking.every((asset) =>
      Boolean(partialCheckinDetails[asset.id])
    );

  if (!allAssetsCheckedIn) {
    return false;
  }

  // Only consider as "partially checked in" for active bookings
  return ["ONGOING", "OVERDUE"].includes(bookingStatus);
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
