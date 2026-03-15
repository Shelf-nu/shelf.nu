import { db } from "~/database/db.server";
import { update, upsert } from "~/database/query-helpers.server";
import { ShelfError } from "~/utils/error";

const label = "Booking Settings";

export async function getBookingSettingsForOrganization(
  organizationId: string
) {
  try {
    // First try to find existing working hours
    const bookingSettings = await upsert(
      db,
      "BookingSettings",
      {
        bufferStartTime: 0,
        maxBookingLength: null,
        maxBookingLengthSkipClosedDays: false,
        tagsRequired: false,
        autoArchiveBookings: false,
        autoArchiveDays: 2,
        requireExplicitCheckinForAdmin: false,
        requireExplicitCheckinForSelfService: false,
        organizationId,
      },
      { onConflict: "organizationId" }
    );

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
  autoArchiveBookings,
  autoArchiveDays,
  requireExplicitCheckinForAdmin,
  requireExplicitCheckinForSelfService,
}: {
  organizationId: string;
  bufferStartTime?: number;
  tagsRequired?: boolean;
  maxBookingLength?: number | null;
  maxBookingLengthSkipClosedDays?: boolean;
  autoArchiveBookings?: boolean;
  autoArchiveDays?: number;
  requireExplicitCheckinForAdmin?: boolean;
  requireExplicitCheckinForSelfService?: boolean;
}) {
  try {
    const updateData: Record<string, unknown> = {};
    if (bufferStartTime !== undefined)
      updateData.bufferStartTime = bufferStartTime;
    if (tagsRequired !== undefined) updateData.tagsRequired = tagsRequired;
    if (maxBookingLength !== undefined)
      updateData.maxBookingLength = maxBookingLength;
    if (maxBookingLengthSkipClosedDays !== undefined)
      updateData.maxBookingLengthSkipClosedDays =
        maxBookingLengthSkipClosedDays;
    if (autoArchiveBookings !== undefined)
      updateData.autoArchiveBookings = autoArchiveBookings;
    if (autoArchiveDays !== undefined)
      updateData.autoArchiveDays = autoArchiveDays;
    if (requireExplicitCheckinForAdmin !== undefined)
      updateData.requireExplicitCheckinForAdmin =
        requireExplicitCheckinForAdmin;
    if (requireExplicitCheckinForSelfService !== undefined)
      updateData.requireExplicitCheckinForSelfService =
        requireExplicitCheckinForSelfService;

    const bookingSettings = await update(db, "BookingSettings", {
      where: { organizationId },
      data: updateData,
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
        autoArchiveBookings,
        autoArchiveDays,
      },
      label,
    });
  }
}
