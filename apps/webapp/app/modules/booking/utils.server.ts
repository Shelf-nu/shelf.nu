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
