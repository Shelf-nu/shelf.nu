import type { Booking, BookingNote, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Booking";

/**
 * BOOKING ACTIVITY LOG SERVICE
 *
 * This service manages booking activity logs similar to the asset notes system.
 *
 * ARCHITECTURE:
 * - BookingNote model mirrors the existing Note model structure
 * - Supports two note types: COMMENT (manual user notes) and UPDATE (system-generated activity)
 * - Organization isolation is enforced INSIDE this service (see `assertBookingInOrganization`)
 *   — every create/delete requires `organizationId` and verifies the booking belongs to it
 *   before touching the note table. This is the defense-in-depth layer that protects against
 *   cross-organization note injection even if a route handler forgets to scope the booking.
 * - Indexed on bookingId and userId for efficient queries
 *
 * SECURITY:
 * - Notes are scoped to organization via booking relationship
 * - Only note creators can delete their manual notes (filter also requires `organizationId`)
 * - System-generated notes cannot be deleted (userId is null)
 * - All operations require proper permissions (bookingNote.read/create) at the route layer
 *
 * ACTIVITY TRACKING:
 * - Status changes (DRAFT→RESERVED, cancellation, archival)
 * - Detail updates (name, description, dates, custodian changes)
 * - Asset management (additions, removals)
 * - Check-in/check-out operations (full and partial)
 *
 * MESSAGE FORMAT:
 * - System messages use markdown formatting for consistency
 * - Links to related entities: **[Booking Name](/bookings/id)**
 * - Bold text for emphasis: **User Name**, **Asset Count**
 */

/**
 * Asserts that the given booking exists and belongs to the supplied organization.
 *
 * This is the service-layer defense-in-depth guard used by the booking-note
 * CREATE helpers (`createBookingNote`, `createSystemBookingNote`) to prevent
 * cross-organization note writes before touching the notes table.
 *
 * Delete operations enforce organization (and booking) scope through the
 * relational `where` filter on `db.bookingNote.deleteMany` rather than by
 * calling this helper directly — see {@link deleteBookingNote}.
 *
 * @throws {ShelfError} 404 if the booking does not exist in `organizationId`
 */
async function assertBookingInOrganization({
  bookingId,
  organizationId,
}: {
  bookingId: Booking["id"];
  organizationId: string;
}): Promise<void> {
  const booking = await db.booking.findFirst({
    where: { id: bookingId, organizationId },
    select: { id: true },
  });

  if (!booking) {
    throw new ShelfError({
      cause: null,
      message: "Booking not found or access denied",
      additionalData: { bookingId, organizationId },
      label,
      status: 404,
      shouldBeCaptured: false,
    });
  }
}

/**
 * Creates a singular booking note (manual or system-generated).
 *
 * @param content - The note content (supports markdown)
 * @param type - "COMMENT" for manual notes, "UPDATE" for system activity
 * @param userId - User ID for manual notes, undefined for system notes
 * @param bookingId - Booking ID to associate the note with
 * @param organizationId - Organization ID the booking MUST belong to. Verified before write.
 * @throws {ShelfError} 404 if the booking is not in `organizationId`
 */
export async function createBookingNote({
  content,
  type,
  userId,
  bookingId,
  organizationId,
}: Pick<BookingNote, "content"> & {
  type?: BookingNote["type"];
  userId?: User["id"];
  bookingId: Booking["id"];
  organizationId: string;
}) {
  try {
    await assertBookingInOrganization({ bookingId, organizationId });

    const data = {
      content,
      type: type || "COMMENT",
      booking: {
        connect: {
          id: bookingId,
        },
      },
      ...(userId && {
        user: {
          connect: {
            id: userId,
          },
        },
      }),
    };

    return await db.bookingNote.create({
      data,
    });
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a booking note",
      additionalData: { type, userId, bookingId, organizationId },
      label,
    });
  }
}

/**
 * Creates a system-generated booking note for automatic activity tracking.
 *
 * Convenience wrapper around {@link createBookingNote} that:
 * - Sets type to "UPDATE" for system activities
 * - Omits userId (system notes are not attributed to users)
 * - Requires `organizationId` so the invariant still holds for system writes
 *
 * @param content - Activity description with markdown formatting
 * @param bookingId - Booking ID to log activity for
 * @param organizationId - Organization ID the booking MUST belong to
 */
export function createSystemBookingNote({
  content,
  bookingId,
  organizationId,
}: Pick<BookingNote, "content"> & {
  bookingId: Booking["id"];
  organizationId: string;
}) {
  return createBookingNote({
    content,
    type: "UPDATE",
    bookingId,
    organizationId,
  });
}

/**
 * Gets booking notes for a specific booking with security validation.
 *
 * SECURITY CHECKS:
 * - Validates booking exists in the specified organization
 * - Returns notes ordered by creation date (desc) for recent-first display
 * - Includes user information for manual notes (excludes system notes)
 *
 * PERFORMANCE:
 * - Uses indexed query on bookingId for efficiency
 * - Selective loading (called only when activity tab is accessed)
 *
 * @param bookingId - Booking ID to get notes for
 * @param organizationId - Organization ID for security validation
 * @returns Array of booking notes with user information
 */
export async function getBookingNotes({
  bookingId,
  organizationId,
}: {
  bookingId: Booking["id"];
  organizationId: string;
}) {
  try {
    // First verify the booking belongs to the organization
    const booking = await db.booking.findFirst({
      where: {
        id: bookingId,
        organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        message: "Booking not found or access denied",
        additionalData: { bookingId, organizationId },
        label,
        shouldBeCaptured: false,
      });
    }

    return await db.bookingNote.findMany({
      where: {
        bookingId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    });
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching booking notes",
      additionalData: { bookingId, organizationId },
      label,
    });
  }
}

/**
 * Deletes a booking note with user + booking + organization authorization.
 *
 * SECURITY:
 * - Users can only delete their own manual notes (matches on `userId`)
 * - Deletion is scoped to the specific booking referenced in the URL
 *   (`bookingId`) AND that booking's organization, so a compromised `noteId`
 *   from a different booking — even in the same workspace — cannot be deleted
 *   through a route handler bound to another booking.
 * - System-generated notes cannot be deleted (userId is null ⇒ cannot match)
 *
 * @param id - Note ID to delete
 * @param bookingId - Booking the note must belong to (typically the route's `:bookingId` param)
 * @param userId - User ID (must match note creator)
 * @param organizationId - Organization the note's booking must belong to
 * @returns Delete operation result (0 if the note did not match the constraints)
 */
export async function deleteBookingNote({
  id,
  bookingId,
  userId,
  organizationId,
}: Pick<BookingNote, "id"> & {
  bookingId: Booking["id"];
  userId: User["id"];
  organizationId: string;
}) {
  try {
    const result = await db.bookingNote.deleteMany({
      where: {
        id,
        userId,
        booking: { id: bookingId, organizationId },
      },
    });
    return result;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the booking note",
      additionalData: { id, bookingId, userId, organizationId },
      label,
    });
  }
}
