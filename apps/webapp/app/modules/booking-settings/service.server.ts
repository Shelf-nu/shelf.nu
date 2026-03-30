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
        autoArchiveBookings: false,
        autoArchiveDays: 2,
        requireExplicitCheckinForAdmin: false,
        requireExplicitCheckinForSelfService: false,
        notifyBookingCreator: true,
        notifyAdminsOnNewBooking: true,
        organizationId,
      },
      select: {
        id: true,
        bufferStartTime: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
        tagsRequired: true,
        autoArchiveBookings: true,
        autoArchiveDays: true,
        requireExplicitCheckinForAdmin: true,
        requireExplicitCheckinForSelfService: true,
        notifyBookingCreator: true,
        notifyAdminsOnNewBooking: true,
        alwaysNotifyTeamMembers: {
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
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
  autoArchiveBookings,
  autoArchiveDays,
  requireExplicitCheckinForAdmin,
  requireExplicitCheckinForSelfService,
  notifyBookingCreator,
  notifyAdminsOnNewBooking,
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
  notifyBookingCreator?: boolean;
  notifyAdminsOnNewBooking?: boolean;
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
    if (notifyBookingCreator !== undefined)
      updateData.notifyBookingCreator = notifyBookingCreator;
    if (notifyAdminsOnNewBooking !== undefined)
      updateData.notifyAdminsOnNewBooking = notifyAdminsOnNewBooking;

    const bookingSettings = await db.bookingSettings.update({
      where: { organizationId },
      data: updateData,
      select: {
        id: true,
        bufferStartTime: true,
        tagsRequired: true,
        maxBookingLength: true,
        maxBookingLengthSkipClosedDays: true,
        autoArchiveBookings: true,
        autoArchiveDays: true,
        requireExplicitCheckinForAdmin: true,
        requireExplicitCheckinForSelfService: true,
        notifyBookingCreator: true,
        notifyAdminsOnNewBooking: true,
        alwaysNotifyTeamMembers: {
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
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
        autoArchiveBookings,
        autoArchiveDays,
      },
      label,
    });
  }
}

/**
 * Lean query that returns only the notification-related booking settings
 * for an organization: `notifyBookingCreator`, `notifyAdminsOnNewBooking`,
 * and the `alwaysNotifyTeamMembers` relation.
 *
 * This is intentionally separate from `getBookingSettingsForOrganization()`
 * (which fetches the full settings object including buffer times, archive
 * config, etc.) to keep the notification resolver lightweight and avoid
 * pulling unnecessary data on every booking email.
 *
 * Uses `upsert` to lazily create default settings if the organization
 * doesn't have a `BookingSettings` row yet.
 *
 * @param organizationId - The organization whose settings to fetch
 * @returns Notification flags and the always-notify team member list
 */
export async function getBookingNotificationSettingsForOrg(
  organizationId: string
) {
  try {
    return await db.bookingSettings.upsert({
      where: { organizationId },
      update: {},
      create: {
        organizationId,
        notifyBookingCreator: true,
        notifyAdminsOnNewBooking: true,
      },
      select: {
        notifyBookingCreator: true,
        notifyAdminsOnNewBooking: true,
        alwaysNotifyTeamMembers: {
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve booking notification settings",
      additionalData: { organizationId },
      label,
    });
  }
}

/**
 * Replaces the "always notify" team member list for booking notifications.
 *
 * Uses Prisma's `set` operation, which disconnects all existing relations
 * and reconnects only the provided IDs. This means the caller must always
 * pass the complete desired list — omitting an ID removes that member.
 *
 * @param organizationId - The organization whose settings to update
 * @param teamMemberIds - Complete list of team member IDs that should
 *   always receive booking notifications. Pass an empty array to clear.
 * @returns The updated always-notify team member list with user details
 */
export async function updateAlwaysNotifyTeamMembers({
  organizationId,
  teamMemberIds,
}: {
  organizationId: string;
  teamMemberIds: string[];
}) {
  try {
    // Validate that all provided team member IDs belong to this organization,
    // preventing cross-org data injection.
    const validTeamMembers = await db.teamMember.findMany({
      where: {
        organizationId,
        id: { in: teamMemberIds },
      },
      select: { id: true },
    });
    const validTeamMemberIds = validTeamMembers.map((m) => m.id);

    return await db.bookingSettings.update({
      where: { organizationId },
      data: {
        alwaysNotifyTeamMembers: {
          set: validTeamMemberIds.map((id) => ({ id })),
        },
      },
      select: {
        alwaysNotifyTeamMembers: {
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
              },
            },
          },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update always-notify team members",
      additionalData: { organizationId, teamMemberIds },
      label,
    });
  }
}
