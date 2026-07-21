import type { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

const label = "Booking Settings";

/**
 * Shared `select` clause for `BookingSettings` reads/writes in this module.
 *
 * Hoisted to module scope so the read-first `findUnique` in
 * {@link getBookingSettingsForOrganization} and its upsert fallback always
 * return the exact same shape — a single source of truth prevents the two
 * code paths from drifting apart over time.
 */
export const BOOKING_SETTINGS_SELECT = {
  id: true,
  bufferStartTime: true,
  maxBookingLength: true,
  maxBookingLengthSkipClosedDays: true,
  tagsRequired: true,
  autoArchiveBookings: true,
  autoArchiveDays: true,
  autoArchiveExpiredReservations: true,
  requireExplicitCheckinForAdmin: true,
  requireExplicitCheckinForSelfService: true,
  countKitsAsSingleUnit: true,
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
} satisfies Prisma.BookingSettingsSelect;

/**
 * Retrieves the `BookingSettings` row for an organization, creating a
 * default row only on first access.
 *
 * This is called from the root authenticated layout loader
 * (`_layout+/_layout.tsx`), so it runs on **every** authenticated page load
 * and React Router `.data` revalidation. It is deliberately **read-first**:
 * a plain `findUnique` satisfies the overwhelming majority of calls (the row
 * almost always already exists), avoiding an unconditional write + row lock
 * on every request. Only when the row is genuinely absent do we fall
 * through to an `upsert` (not a bare `create`) so two concurrent first
 * requests for the same organization can't race into a unique-constraint
 * error.
 *
 * @param organizationId - The organization whose settings to fetch
 * @returns The organization's booking settings, creating defaults if absent
 * @throws {ShelfError} If the database operation fails
 */
export async function getBookingSettingsForOrganization(
  organizationId: string
) {
  try {
    // Hot path: the row exists for almost every call, so a plain read avoids
    // taking a write lock on every authenticated page load.
    const existing = await db.bookingSettings.findUnique({
      where: { organizationId },
      select: BOOKING_SETTINGS_SELECT,
    });

    if (existing) {
      return existing;
    }

    // Cold path: first access for this organization. Use `upsert` (not
    // `create`) so a concurrent first-hit from another request doesn't
    // throw a unique-constraint error.
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
        autoArchiveExpiredReservations: false,
        requireExplicitCheckinForAdmin: false,
        requireExplicitCheckinForSelfService: false,
        countKitsAsSingleUnit: false,
        notifyBookingCreator: true,
        notifyAdminsOnNewBooking: true,
        organizationId,
      },
      select: BOOKING_SETTINGS_SELECT,
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
  autoArchiveExpiredReservations,
  requireExplicitCheckinForAdmin,
  requireExplicitCheckinForSelfService,
  countKitsAsSingleUnit,
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
  autoArchiveExpiredReservations?: boolean;
  requireExplicitCheckinForAdmin?: boolean;
  requireExplicitCheckinForSelfService?: boolean;
  countKitsAsSingleUnit?: boolean;
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
    if (autoArchiveExpiredReservations !== undefined)
      updateData.autoArchiveExpiredReservations =
        autoArchiveExpiredReservations;
    if (requireExplicitCheckinForAdmin !== undefined)
      updateData.requireExplicitCheckinForAdmin =
        requireExplicitCheckinForAdmin;
    if (requireExplicitCheckinForSelfService !== undefined)
      updateData.requireExplicitCheckinForSelfService =
        requireExplicitCheckinForSelfService;
    if (countKitsAsSingleUnit !== undefined)
      updateData.countKitsAsSingleUnit = countKitsAsSingleUnit;
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
        autoArchiveExpiredReservations: true,
        requireExplicitCheckinForAdmin: true,
        requireExplicitCheckinForSelfService: true,
        countKitsAsSingleUnit: true,
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
        countKitsAsSingleUnit,
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
