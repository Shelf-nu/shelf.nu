import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import { ShelfError } from "~/utils/error";

const label = "Booking Settings";

export async function getBookingSettingsForOrganization(
  organizationId: string
) {
  try {
    // Try to find existing booking settings
    const { data: existing, error: fetchError } = await sbDb
      .from("BookingSettings")
      .select(
        "id, bufferStartTime, maxBookingLength, maxBookingLengthSkipClosedDays, tagsRequired, autoArchiveBookings, autoArchiveDays, requireExplicitCheckinForAdmin, requireExplicitCheckinForSelfService"
      )
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (existing) return existing;

    // Create default settings if not found
    const { data: created, error: createError } = await sbDb
      .from("BookingSettings")
      .insert({
        bufferStartTime: 0,
        maxBookingLength: null,
        maxBookingLengthSkipClosedDays: false,
        tagsRequired: false,
        autoArchiveBookings: false,
        autoArchiveDays: 2,
        requireExplicitCheckinForAdmin: false,
        requireExplicitCheckinForSelfService: false,
        organizationId,
      })
      .select(
        "id, bufferStartTime, maxBookingLength, maxBookingLengthSkipClosedDays, tagsRequired, autoArchiveBookings, autoArchiveDays, requireExplicitCheckinForAdmin, requireExplicitCheckinForSelfService"
      )
      .single();

    if (createError) throw createError;
    return created;
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

    const { data: bookingSettings, error } = await sbDb
      .from("BookingSettings")
      .update(updateData as Sb.BookingSettingsUpdate)
      .eq("organizationId", organizationId)
      .select(
        "id, bufferStartTime, tagsRequired, maxBookingLength, maxBookingLengthSkipClosedDays, autoArchiveBookings, autoArchiveDays, requireExplicitCheckinForAdmin, requireExplicitCheckinForSelfService"
      )
      .single();

    if (error) throw error;
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
