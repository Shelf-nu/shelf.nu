import type { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Booking Settings";

export async function getBookingSettingsForOrganization(
  organizationId: string
) {
  try {
    // First try to find existing working hours
    const bookingSettings = await db.bookingSettings.upsert({
      where: {
        organizationId,
      },
      update: {},
      create: {
        bufferStartTime: 0,
        maxBookingLength: null,
        maxBookingLengthSkipClosedDays: false,
        tagsRequired: false,
        organizationId,
      },
      select: {
        id: true,
        bufferStartTime: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
        tagsRequired: true,
      },
    });

    return bookingSettings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve booking settings configuration",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function updateBookingSettings({
  organizationId,
  bufferStartTime,
  tagsRequired,
  maxBookingLength,
  maxBookingLengthSkipClosedDays,
}: {
  organizationId: string;
  bufferStartTime?: number;
  tagsRequired?: boolean;
  maxBookingLength?: number | null;
  maxBookingLengthSkipClosedDays?: boolean;
}) {
  try {
    const updateData: Prisma.BookingSettingsUpdateInput = {};
    if (bufferStartTime !== undefined)
      updateData.bufferStartTime = bufferStartTime;
    if (tagsRequired !== undefined) updateData.tagsRequired = tagsRequired;
    if (maxBookingLength !== undefined)
      updateData.maxBookingLength = maxBookingLength;
    if (maxBookingLengthSkipClosedDays !== undefined)
      updateData.maxBookingLengthSkipClosedDays =
        maxBookingLengthSkipClosedDays;

    const bookingSettings = await db.bookingSettings.update({
      where: { organizationId },
      data: updateData,
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
      },
    });

    return bookingSettings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update booking settings configuration",
      additionalData: {
        organizationId,
        bufferStartTime,
        tagsRequired,
        maxBookingLength,
        maxBookingLengthSkipClosedDays,
      },
      label,
    });
  }
}
