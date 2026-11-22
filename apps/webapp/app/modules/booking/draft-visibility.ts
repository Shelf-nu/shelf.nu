/**
 * Booking Draft Visibility
 *
 * The rule deciding which DRAFT bookings a viewer may see, kept dependency-free
 * so any module that counts or lists bookings can apply it without importing
 * the booking service.
 *
 * @see {@link file://./service.server.ts} `getBookings`, which applies it
 * @see {@link file://./../tag/service.server.ts} the tags list bookings count
 */
import type { Booking, Prisma } from "@prisma/client";

/**
 * DRAFT-visibility rule shared by every booking-list query: bookings that are
 * not DRAFT are visible to everyone in the org, while DRAFT bookings are only
 * visible to their creator. Every list and count of bookings applies this one
 * function (`getBookings`, `getMinimalBookings`, the bookings export, the tags
 * list count), so they cannot disagree on this permission-sensitive predicate.
 *
 * @param userId - The viewer, matched against `Booking.creatorId` for drafts.
 * @returns A `Prisma.BookingWhereInput` OR-clause to push into `where.AND`.
 */
export function bookingDraftVisibilityClause(
  userId: Booking["creatorId"]
): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: { not: "DRAFT" } },
      { AND: [{ status: "DRAFT" }, { creatorId: userId }] },
    ],
  };
}
