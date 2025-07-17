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
        organizationId,
      },
      select: {
        id: true,
        bufferStartTime: true,
        maxBookingLength: true,
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
}: {
  organizationId: string;
  bufferStartTime: number;
}) {
  try {
    const bookingSettings = await db.bookingSettings.update({
      where: { organizationId },
      data: { bufferStartTime },
      select: {
        id: true,
        bufferStartTime: true,
      },
    });

    return bookingSettings;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update booking settings configuration",
      additionalData: { organizationId, bufferStartTime },
      label,
    });
  }
}
