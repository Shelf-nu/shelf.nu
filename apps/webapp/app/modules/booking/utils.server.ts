import { AssetStatus, BookingStatus } from "@prisma/client";
import type { Asset, Booking, Organization, Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { redirect } from "react-router";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Booking";

export function getBookingWhereInput({
  organizationId,
  currentSearchParams,
}: {
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
}): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = { organizationId };

  if (!currentSearchParams) {
    return where;
  }

  const searchParams = new URLSearchParams(currentSearchParams);

  const status =
    searchParams.get("status") === "ALL"
      ? null
      : (searchParams.get("status") as BookingStatus);

  if (status) {
    where.status = status;
  }

  return where;
}

/** This function checks if the booking is expired or not */
export function isBookingExpired({ to }: { to: NonNullable<Booking["to"]> }) {
  try {
    const end = DateTime.fromJSDate(to);
    const now = DateTime.now();

    return end < now;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while checking if the booking is expired.",
      label,
    });
  }
}

/**
 * Calculate partial check-in progress data for a booking
 *
 * Counts progress at the ASSET granularity: every asset (whether standalone or
 * inside a kit) contributes one unit toward the total and one unit toward the
 * checked-in count once it is checked in.
 *
 * The returned object carries `countMode: "assets"` so consumers (e.g. the
 * booking statistics UI) can distinguish it from the unit-based counterpart
 * {@link calculateUnitCheckinProgress}.
 *
 * @param totalAssets - Total number of assets in the booking
 * @param checkedInAssetIds - IDs of assets that have been checked in
 * @param bookingStatus - Optional booking status; COMPLETE/ARCHIVED force 100%
 * @returns Progress data including counts, percentage and `countMode: "assets"`
 */
export function calculatePartialCheckinProgress(
  totalAssets: number,
  checkedInAssetIds: string[],
  bookingStatus?: BookingStatus
) {
  // For final booking statuses, always show 100% progress
  if (
    bookingStatus === BookingStatus.COMPLETE ||
    bookingStatus === BookingStatus.ARCHIVED
  ) {
    return {
      totalAssets,
      checkedInCount: totalAssets,
      uncheckedCount: 0,
      progressPercentage: 100,
      hasPartialCheckins: totalAssets > 0,
      checkedInAssetIds,
      countMode: "assets" as const,
    };
  }

  const checkedInCount = checkedInAssetIds.length;
  const uncheckedCount = totalAssets - checkedInCount;
  const progressPercentage =
    totalAssets > 0 ? Math.round((checkedInCount / totalAssets) * 100) : 0;
  const hasPartialCheckins = checkedInCount > 0;

  return {
    totalAssets,
    checkedInCount,
    uncheckedCount,
    progressPercentage,
    hasPartialCheckins,
    checkedInAssetIds,
    countMode: "assets" as const,
  };
}

/**
 * Calculate unit-based check-in progress for a booking.
 *
 * Unlike {@link calculatePartialCheckinProgress}, this treats each KIT as a
 * single unit instead of counting the individual assets inside it. This backs
 * the workspace `countKitsAsSingleUnit` setting on the booking details
 * "Check-in progress" bar.
 *
 * Counting rules:
 * - Each standalone asset (`kitId === null`) is one unit. It counts as checked
 *   in when its id is in `checkedInAssetIds`.
 * - Each distinct kit is one unit. A kit counts as checked in ONLY when EVERY
 *   asset belonging to it has been checked in. A partially checked-in kit
 *   contributes 0 toward the checked-in count.
 *
 * The total/checked-in numbers therefore represent UNITS, not assets. To keep a
 * shape compatible with the asset-based function, the unit total is still
 * exposed under the `totalAssets` field. The `countMode: "units"` discriminator
 * lets consumers render unit-aware UI.
 *
 * @param bookingAssets - All assets in the booking with their `id` and `kitId`
 * @param checkedInAssetIds - IDs of assets that have been checked in
 * @param bookingStatus - Optional booking status; COMPLETE/ARCHIVED force 100%
 * @returns Progress data including counts, percentage and `countMode: "units"`
 */
export function calculateUnitCheckinProgress(
  bookingAssets: { id: string; kitId: string | null }[],
  checkedInAssetIds: string[],
  bookingStatus?: BookingStatus
) {
  const checkedInSet = new Set(checkedInAssetIds);

  // Standalone assets: each one is a unit.
  const standaloneAssets = bookingAssets.filter(
    (asset) => asset.kitId === null
  );
  const standaloneTotal = standaloneAssets.length;
  const standaloneCheckedIn = standaloneAssets.filter((asset) =>
    checkedInSet.has(asset.id)
  ).length;

  // Group kitted assets by their kitId; each distinct kit is a unit.
  const kitGroups = new Map<string, string[]>();
  for (const asset of bookingAssets) {
    if (asset.kitId === null) {
      continue;
    }
    const existing = kitGroups.get(asset.kitId);
    if (existing) {
      existing.push(asset.id);
    } else {
      kitGroups.set(asset.kitId, [asset.id]);
    }
  }

  const distinctKits = kitGroups.size;
  // A kit is "checked in" only when every one of its assets is checked in.
  let fullyCheckedInKits = 0;
  for (const assetIds of kitGroups.values()) {
    if (assetIds.every((assetId) => checkedInSet.has(assetId))) {
      fullyCheckedInKits += 1;
    }
  }

  // `totalAssets` here represents total UNITS (standalone assets + distinct kits).
  const totalAssets = standaloneTotal + distinctKits;

  // For final booking statuses, always show 100% progress (mirrors the
  // asset-based function's early-return behavior exactly).
  if (
    bookingStatus === BookingStatus.COMPLETE ||
    bookingStatus === BookingStatus.ARCHIVED
  ) {
    return {
      totalAssets,
      checkedInCount: totalAssets,
      uncheckedCount: 0,
      progressPercentage: 100,
      hasPartialCheckins: totalAssets > 0,
      checkedInAssetIds,
      countMode: "units" as const,
    };
  }

  const checkedInCount = standaloneCheckedIn + fullyCheckedInKits;
  const uncheckedCount = totalAssets - checkedInCount;
  const progressPercentage =
    totalAssets > 0 ? Math.round((checkedInCount / totalAssets) * 100) : 0;
  // `hasPartialCheckins` is deliberately ASSET-level, not unit-level: it drives
  // whether the booking page shows the check-in progress section and the
  // per-asset "checked in on/by" columns. A kit with some (but not all) of its
  // assets checked in produces a unit `checkedInCount` of 0, yet there ARE
  // asset-level check-ins to surface — basing this on the kit-unit count would
  // hide that detail. See BookingAssetsColumn / BookingStatistics.
  const hasPartialCheckins = checkedInAssetIds.length > 0;

  return {
    totalAssets,
    checkedInCount,
    uncheckedCount,
    progressPercentage,
    hasPartialCheckins,
    checkedInAssetIds,
    countMode: "units" as const,
  };
}

/** One asset's minimal shape for lifecycle bucketing. */
type LifecycleAsset = {
  id: string;
  kitId: string | null;
  status: AssetStatus;
};

/** Result of {@link calculateBookingLifecycleProgress}. */
export type BookingLifecycleProgress = {
  totalUnits: number;
  bookedCount: number;
  checkedOutCount: number;
  returnedCount: number;
  /** checkedOut + returned — items that have left the Booked bucket. */
  checkoutProgressCount: number;
  checkoutProgressPercentage: number;
  /** returned only. */
  checkinProgressCount: number;
  checkinProgressPercentage: number;
  hasPartialCheckouts: boolean;
  hasPartialCheckins: boolean;
  countMode: "assets" | "units";
};

/**
 * Compute the three lifecycle buckets (Booked / Checked out / Returned) for a
 * booking, backing the segmented progress bar on the booking detail page.
 *
 * Per-asset bucket (resolution order matters):
 * - **Checked out**: `status === CHECKED_OUT`.
 * - **Returned**: `AVAILABLE` and present in `checkedInAssetIds` (was checked
 *   out, then checked back in).
 * - **Booked**: everything else (reserved, not yet scanned out).
 *
 * In unit mode (`countKitsAsSingleUnit`), each standalone asset is one unit and
 * each distinct kit is one unit that falls into a bucket ONLY when every one of
 * its assets shares that bucket; a kit split across buckets counts as Booked.
 *
 * For COMPLETE/ARCHIVED bookings, live status is no longer meaningful (all
 * assets are AVAILABLE), so a unit is "Returned" only if it was actually
 * checked out (`checkedOutAssetIds`); never-checked-out assets — which only
 * exist when progressive checkout was used — stay in the Booked bucket.
 * Percentages reflect that split rather than being forced to 100%.
 *
 * @returns bucket counts, checkout/check-in counts + percentages, and flags.
 */
export function calculateBookingLifecycleProgress({
  bookingAssets,
  checkedInAssetIds,
  checkedOutAssetIds = [],
  bookingStatus,
  countKitsAsSingleUnit = false,
}: {
  bookingAssets: LifecycleAsset[];
  checkedInAssetIds: string[];
  /**
   * Asset ids that were ACTUALLY checked out in this booking (have a
   * PartialBookingCheckout record). Used in the COMPLETE/ARCHIVED branch to
   * avoid marking never-checked-out assets as "Returned". An EMPTY array means
   * "no progressive-checkout records" → every asset was checked out (a pure
   * quick/all-at-once checkout leaves no records).
   */
  checkedOutAssetIds?: string[];
  bookingStatus?: BookingStatus;
  countKitsAsSingleUnit?: boolean;
}): BookingLifecycleProgress {
  const countMode = countKitsAsSingleUnit ? "units" : "assets";
  const checkedInSet = new Set(checkedInAssetIds);
  const isFinal =
    bookingStatus === BookingStatus.COMPLETE ||
    bookingStatus === BookingStatus.ARCHIVED;

  // An asset "was actually checked out" iff it has a checkout record. When no
  // records exist at all (empty array), every asset was checked out.
  const checkedOutSet = new Set(checkedOutAssetIds);
  const wasCheckedOut = (id: string) =>
    checkedOutAssetIds.length === 0 || checkedOutSet.has(id);

  // Live-status bucketing for non-final bookings.
  const bucketOf = (
    a: LifecycleAsset
  ): "checkedOut" | "returned" | "booked" => {
    if (a.status === AssetStatus.CHECKED_OUT) return "checkedOut";
    if (checkedInSet.has(a.id)) return "returned";
    return "booked";
  };

  // Final (COMPLETE/ARCHIVED) bucketing. Live status is AVAILABLE for every
  // asset at this point, so it carries no signal — instead, an asset is
  // "Returned" only if it was ever checked out; never-checked-out assets fall
  // into "Booked". (CHECKED_OUT live status, if somehow present, is treated as
  // returned defensively since nothing should still be out at COMPLETE.)
  const finalBucketOf = (
    a: LifecycleAsset
  ): "checkedOut" | "returned" | "booked" =>
    a.status === AssetStatus.CHECKED_OUT || wasCheckedOut(a.id)
      ? "returned"
      : "booked";

  const resolveBucket = isFinal ? finalBucketOf : bucketOf;

  let booked = 0;
  let checkedOut = 0;
  let returned = 0;

  if (!countKitsAsSingleUnit) {
    for (const a of bookingAssets) {
      const b = resolveBucket(a);
      if (b === "checkedOut") checkedOut += 1;
      else if (b === "returned") returned += 1;
      else booked += 1;
    }
  } else {
    for (const a of bookingAssets.filter((x) => x.kitId === null)) {
      const b = resolveBucket(a);
      if (b === "checkedOut") checkedOut += 1;
      else if (b === "returned") returned += 1;
      else booked += 1;
    }
    const kitGroups = new Map<string, LifecycleAsset[]>();
    for (const a of bookingAssets) {
      if (a.kitId === null) continue;
      const g = kitGroups.get(a.kitId);
      if (g) g.push(a);
      else kitGroups.set(a.kitId, [a]);
    }
    for (const group of kitGroups.values()) {
      const buckets = new Set(group.map(resolveBucket));
      if (buckets.size === 1) {
        const only = [...buckets][0];
        if (only === "checkedOut") checkedOut += 1;
        else if (only === "returned") returned += 1;
        else booked += 1;
      } else {
        booked += 1;
      }
    }
  }

  const totalUnits = booked + checkedOut + returned;

  if (isFinal) {
    // No asset is still CHECKED_OUT at COMPLETE — finalBucketOf only yields
    // "returned" or "booked", so checkedOut is 0 and progress is derived from
    // the returned/booked split (NOT hard-coded to 100%).
    const checkoutProgressCount = checkedOut + returned;
    const pctFinal = (n: number) =>
      totalUnits > 0 ? Math.round((n / totalUnits) * 100) : 0;

    return {
      totalUnits,
      bookedCount: booked,
      checkedOutCount: checkedOut,
      returnedCount: returned,
      checkoutProgressCount,
      checkoutProgressPercentage: pctFinal(checkoutProgressCount),
      checkinProgressCount: returned,
      checkinProgressPercentage: pctFinal(returned),
      hasPartialCheckouts: checkoutProgressCount > 0,
      hasPartialCheckins: returned > 0,
      countMode,
    };
  }

  const checkoutProgressCount = checkedOut + returned;
  const pct = (n: number) =>
    totalUnits > 0 ? Math.round((n / totalUnits) * 100) : 0;

  return {
    totalUnits,
    bookedCount: booked,
    checkedOutCount: checkedOut,
    returnedCount: returned,
    checkoutProgressCount,
    checkoutProgressPercentage: pct(checkoutProgressCount),
    checkinProgressCount: returned,
    checkinProgressPercentage: pct(returned),
    hasPartialCheckouts: checkoutProgressCount > 0,
    hasPartialCheckins: returned > 0,
    countMode,
  };
}

/**
 * Determines if a booking page should redirect to apply appropriate status filters
 * Handles smart status param management for better UX
 */
export function getBookingStatusRedirect({
  bookingId,
  booking,
  currentStatusParam,
  isMainBookingPage,
}: {
  bookingId: string;
  booking: Pick<Booking, "id" | "status"> & {
    assets: Pick<Asset, "status">[];
  };
  currentStatusParam: string | null;
  isMainBookingPage: boolean;
}) {
  if (!isMainBookingPage) {
    return null;
  }

  // Case 1: ONGOING/OVERDUE booking with no status param
  // -> Redirect to CHECKED_OUT if there are assets to show
  if (!currentStatusParam && ["ONGOING", "OVERDUE"].includes(booking.status)) {
    const hasCheckedOutAssets = booking.assets.some(
      (asset) => asset.status === AssetStatus.CHECKED_OUT
    );

    if (hasCheckedOutAssets) {
      return redirect(
        `/bookings/${bookingId}?status=${AssetStatus.CHECKED_OUT}`
      );
    }
    // If no CHECKED_OUT assets, let it show all assets (no redirect needed)
  }

  // Case 2: COMPLETE booking with CHECKED_OUT status param
  // -> Redirect to clean URL since CHECKED_OUT filter doesn't make sense anymore
  if (
    currentStatusParam === AssetStatus.CHECKED_OUT &&
    booking.status === BookingStatus.COMPLETE
  ) {
    return redirect(`/bookings/${bookingId}`);
  }

  // Case 3: All other cases - no redirect needed
  return null;
}

/**
 * Creates standardized booking conflict query conditions for asset.bookings includes
 * This implements Pattern 1 from booking-conflict-queries.md documentation
 */
export function createBookingConflictConditions({
  currentBookingId,
  fromDate,
  toDate,
  includeCurrentBooking = false,
}: {
  currentBookingId: string;
  fromDate?: Date | string | null;
  toDate?: Date | string | null;
  includeCurrentBooking?: boolean;
}): Prisma.Asset$bookingsArgs {
  return {
    where: {
      ...(fromDate && toDate
        ? {
            OR: [
              // Rule 1: RESERVED bookings always conflict
              {
                status: BookingStatus.RESERVED,
                ...(includeCurrentBooking
                  ? {}
                  : { id: { not: currentBookingId } }),
                OR: [
                  {
                    from: { lte: toDate },
                    to: { gte: fromDate },
                  },
                  {
                    from: { gte: fromDate },
                    to: { lte: toDate },
                  },
                ],
              },
              // Rule 2: ONGOING/OVERDUE bookings (filtered by asset status in helpers)
              {
                status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
                ...(includeCurrentBooking
                  ? {}
                  : { id: { not: currentBookingId } }),
                OR: [
                  {
                    from: { lte: toDate },
                    to: { gte: fromDate },
                  },
                  {
                    from: { gte: fromDate },
                    to: { lte: toDate },
                  },
                ],
              },
            ],
          }
        : {}),
    },
    select: { id: true, status: true, name: true },
  };
}
