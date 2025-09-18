import type { Booking, BookingNote, Prisma, User } from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Booking";

type CreateBookingNoteArgs = Pick<BookingNote, "content"> & {
  bookingId: Booking["id"];
  userId: User["id"];
  type?: BookingNote["type"];
};

export async function createBookingNote({
  bookingId,
  content,
  userId,
  type,
}: CreateBookingNoteArgs) {
  try {
    const noteType = type ?? "COMMENT";

    const data: Prisma.BookingNoteCreateInput = {
      content,
      type: noteType,
      booking: {
        connect: { id: bookingId },
      },
      user: {
        connect: { id: userId },
      },
    };

    return await db.bookingNote.create({
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a booking note",
      additionalData: { bookingId, userId },
      label,
    });
  }
}

type CreateSystemBookingNoteArgs = Pick<BookingNote, "content"> & {
  bookingId: Booking["id"];
  userId?: User["id"];
  type?: BookingNote["type"];
};

export async function createSystemBookingNote({
  bookingId,
  content,
  userId,
  type,
}: CreateSystemBookingNoteArgs) {
  try {
    const noteType = type ?? "UPDATE";

    const data: Prisma.BookingNoteCreateInput = {
      content,
      type: noteType,
      booking: {
        connect: { id: bookingId },
      },
      ...(userId
        ? {
            user: {
              connect: { id: userId },
            },
          }
        : {}),
    };

    return await db.bookingNote.create({
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a system booking note",
      additionalData: { bookingId, userId },
      label,
    });
  }
}

type GetBookingNotesArgs = {
  bookingId: Booking["id"];
};

export async function getBookingNotes({ bookingId }: GetBookingNotesArgs) {
  try {
    return await db.bookingNote.findMany({
      where: { bookingId },
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while retrieving booking notes",
      additionalData: { bookingId },
      label,
    });
  }
}
