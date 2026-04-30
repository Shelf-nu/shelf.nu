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
    bookingAssets: { asset: Pick<Asset, "status"> }[];
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
    const hasCheckedOutAssets = booking.bookingAssets.some(
      (ba) => ba.asset.status === AssetStatus.CHECKED_OUT
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
 * Creates standardized booking conflict query conditions for the
 * `asset.bookingAssets` pivot relation. The conditions filter through
 * `BookingAsset` to the related `Booking`, matching the explicit M2M
 * schema (`BookingAsset { booking, asset, quantity }`).
 *
 * Previously this returned `Prisma.Asset$bookingsArgs` for the implicit
 * M2M. Now it returns `Prisma.Asset$bookingAssetsArgs` with the booking
 * conditions nested under `booking: { ... }`.
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
}): Prisma.Asset$bookingAssetsArgs {
  /** Booking-level where clause for date-overlap & status filtering */
  const bookingWhere: Prisma.BookingWhereInput =
    fromDate && toDate
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
      : {};

  return {
    where: {
      booking: bookingWhere,
    },
    select: {
      id: true,
      quantity: true,
      booking: {
        select: { id: true, status: true, name: true },
      },
    },
  };
}

/**
 * Normalizes BookingAsset pivot records into a flat asset array
 * with bonus booking quantity info. Used at the boundary between
 * the service layer and UI components for backward compatibility.
 */
export function normalizeBookingAssets<
  T extends { asset: Record<string, unknown>; quantity: number; id: string },
>(bookingAssets: T[]) {
  return bookingAssets.map((ba) => ({
    ...ba.asset,
    bookingQuantity: ba.quantity,
    bookingAssetId: ba.id,
  }));
}
