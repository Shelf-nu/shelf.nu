import type {
  Booking,
  BookingStatus,
  Organization,
  Prisma,
} from "@prisma/client";
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
  checkedInAssetIds: string[]
) {
  const checkedInCount = checkedInAssetIds.length;
  const uncheckedCount = totalAssets - checkedInCount;
  const progressPercentage = totalAssets > 0 
    ? Math.round((checkedInCount / totalAssets) * 100) 
    : 0;
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
