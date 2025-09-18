import type { Booking, BookingNote, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "BookingNote";

/** Creates a singular booking note */
export function createBookingNote({
  content,
  type,
  userId,
  bookingId,
}: Pick<BookingNote, "content"> & {
  type?: BookingNote["type"];
  userId?: User["id"];
  bookingId: Booking["id"];
}) {
  try {
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

    return db.bookingNote.create({
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a booking note",
      additionalData: { type, userId, bookingId },
      label,
    });
  }
}

/** Creates a system-generated booking note for activity tracking */
export async function createSystemBookingNote({
  content,
  bookingId,
}: Pick<BookingNote, "content"> & {
  bookingId: Booking["id"];
}) {
  return createBookingNote({
    content,
    type: "UPDATE",
    bookingId,
  });
}

/** Gets booking notes for a specific booking */
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

    return db.bookingNote.findMany({
      where: {
        bookingId,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
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

export function deleteBookingNote({
  id,
  userId,
}: Pick<BookingNote, "id"> & { userId: User["id"] }) {
  try {
    return db.bookingNote.deleteMany({
      where: { id, userId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the booking note",
      additionalData: { id, userId },
      label,
    });
  }
}
