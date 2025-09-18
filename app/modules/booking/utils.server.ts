import { AssetStatus, BookingStatus } from "@prisma/client";
import type { Asset, Booking, Organization, Prisma } from "@prisma/client";
import { redirect } from "@remix-run/node";
import { DateTime } from "luxon";
import { getDateTimeFormat } from "~/utils/client-hints";
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
 * Formats the dates of bookings to be properly displayed in the UI based on the user's locale
 */
export function formatBookingsDates(bookings: Booking[], request: Request) {
  const dateFormat = getDateTimeFormat(request, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return bookings.map((b) => {
    if (b.from && b.to) {
      const displayFrom = dateFormat.format(b.from).split(",");
      const displayTo = dateFormat.format(b.to).split(",");

      const displayOriginalFrom = b.originalFrom
        ? dateFormat.format(b.originalFrom).split(",")
        : null;

      const displayOriginalTo = b.originalTo
        ? dateFormat.format(b.originalTo).split(",")
        : null;

      return {
        ...b,
        displayFrom,
        displayTo,
        displayOriginalFrom,
        displayOriginalTo,
      };
    }
    return b;
  });
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
