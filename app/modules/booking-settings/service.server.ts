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
        tagsRequired: false,
        organizationId,
      },
      select: {
        id: true,
        bufferStartTime: true,
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
}: {
  organizationId: string;
  bufferStartTime?: number;
  tagsRequired?: boolean;
}) {
  try {
    const updateData: { bufferStartTime?: number; tagsRequired?: boolean } = {};
    if (bufferStartTime !== undefined)
      updateData.bufferStartTime = bufferStartTime;
    if (tagsRequired !== undefined) updateData.tagsRequired = tagsRequired;

    const bookingSettings = await db.bookingSettings.update({
      where: { organizationId },
      data: updateData,
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
      },
    });

    return bookingSettings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update booking settings configuration",
      additionalData: { organizationId, bufferStartTime, tagsRequired },
      label,
    });
  }
}
