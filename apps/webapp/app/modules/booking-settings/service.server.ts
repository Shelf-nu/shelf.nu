import type { Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  BOOKING_APPROVAL_SWITCHES_SELECT,
  isBookingApprovalEnabled,
} from "~/utils/bookings";
import { ShelfError } from "~/utils/error";

const label = "Booking Settings";

/**
 * Shared `select` clause for the full `BookingSettings` shape.
 *
 * Hoisted to module scope so the read-first `findUnique` in
 * {@link getBookingSettingsForOrganization}, its `upsert` fallback, and the
 * `update` in {@link updateBookingSettings} all return the exact same shape —
 * a single source of truth keeps those paths from drifting apart over time.
 * (The notification-only helpers below deliberately select a leaner subset.)
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
  requireApprovalForBase: true,
  requireApprovalForSelfService: true,
  requireExplicitCheckinForAdmin: true,
  requireExplicitCheckinForSelfService: true,
  requireExplicitCheckoutForAdmin: true,
  requireExplicitCheckoutForSelfService: true,
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
          displayName: true,
          profilePicture: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSettingsSelect;

/**
 * Lean `select` for the notification-only booking settings.
 *
 * Hoisted so the `upsert` in {@link getBookingNotificationSettingsForOrg} and
 * its `P2002` re-read return the exact same shape (single source of truth).
 */
export const BOOKING_NOTIFICATION_SETTINGS_SELECT = {
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
          displayName: true,
          profilePicture: true,
          // Format-preference columns so the booking notification resolver can
          // carry them onto each recipient and resolve recipient-specific email
          // date/time formatting from the loaded row (no per-recipient DB
          // fetch). See `NotificationRecipient`.
          dateFormat: true,
          timeFormat: true,
          weekStart: true,
          timeZone: true,
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
 * on every request. Only when the row is genuinely absent do we fall through
 * to an `upsert` that also catches `P2002` and re-reads, so two concurrent
 * first requests for the same organization can't race into a unique-constraint
 * error (the upsert emulates a read + create because it returns a nested
 * relation, so it isn't atomic on its own).
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

    // Cold path: first access for this organization. `upsert` (not `create`)
    // makes a concurrent first-hit idempotent — but because this returns a
    // nested relation (`alwaysNotifyTeamMembers` in BOOKING_SETTINGS_SELECT),
    // Prisma emulates the upsert with a separate read + create rather than a
    // native atomic `INSERT … ON CONFLICT`, so a concurrent create can still
    // throw P2002. Catch it and re-read the row the winning request created.
    try {
      return await db.bookingSettings.upsert({
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
          requireExplicitCheckoutForAdmin: false,
          requireExplicitCheckoutForSelfService: false,
          countKitsAsSingleUnit: false,
          notifyBookingCreator: true,
          notifyAdminsOnNewBooking: true,
          organizationId,
        },
        select: BOOKING_SETTINGS_SELECT,
      });
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
        // `await` so a (rare) re-read failure is caught by the outer try and
        // wrapped in a ShelfError rather than escaping as a bare rejection.
        return await db.bookingSettings.findUniqueOrThrow({
          where: { organizationId },
          select: BOOKING_SETTINGS_SELECT,
        });
      }
      throw cause;
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve booking settings configuration",
      additionalData: { organizationId },
      label,
    });
  }
}

/**
 * Stamps every unapproved reservation of a workspace as approved, in the save
 * that turns its first approval switch on.
 *
 * While both switches are off, `reserveBooking` stamps every reservation
 * approved as it is made, so a RESERVED booking with no stamp in that state
 * is never a request: it predates approval, or was made by a server version
 * that did not know the column (the overlap between running the migrations
 * and the new version taking over). Without the stamp, turning a switch on
 * would show those reservations as pending and refuse their check-out.
 *
 * It runs inside the settings transaction, so it covers exactly the
 * reservations made while approval was off, with no deploy-time step. The
 * stamp is the booking's last update, as the backfill migration
 * (`20261110120100_backfill_booking_approval`) sets it.
 *
 * @param tx - The settings transaction
 * @param organizationId - The workspace turning approval on
 */
async function stampLeftoverReservationsApproved(
  tx: Pick<typeof db, "$executeRaw">,
  organizationId: string
) {
  // Raw SQL so the stamp does not move `updatedAt`, the request version an
  // approver compares. Columns carry no `@map`: field names are column names.
  await tx.$executeRaw`
    UPDATE "Booking"
    SET "approvedAt" = COALESCE("updatedAt", "createdAt", NOW())
    WHERE "organizationId" = ${organizationId}
      AND "approvedAt" IS NULL
      AND "status" = 'RESERVED'
  `;
}

/**
 * Updates an organization's booking settings.
 *
 * Only the fields passed with a value are written; every field left
 * `undefined` keeps its stored value, so each settings card can save its own
 * fields without resending the others.
 *
 * A save that turns the workspace's first approval switch on also stamps its
 * unapproved reservations approved, in the same transaction (see
 * {@link stampLeftoverReservationsApproved}).
 *
 * @param args - The organization id plus the settings fields to change
 * @returns The updated settings, in the {@link BOOKING_SETTINGS_SELECT} shape
 * @throws {ShelfError} If the organization has no settings row or the update fails
 */
export async function updateBookingSettings({
  organizationId,
  bufferStartTime,
  tagsRequired,
  maxBookingLength,
  maxBookingLengthSkipClosedDays,
  autoArchiveBookings,
  autoArchiveDays,
  autoArchiveExpiredReservations,
  requireApprovalForBase,
  requireApprovalForSelfService,
  requireExplicitCheckinForAdmin,
  requireExplicitCheckinForSelfService,
  requireExplicitCheckoutForAdmin,
  requireExplicitCheckoutForSelfService,
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
  requireApprovalForBase?: boolean;
  requireApprovalForSelfService?: boolean;
  requireExplicitCheckinForAdmin?: boolean;
  requireExplicitCheckinForSelfService?: boolean;
  requireExplicitCheckoutForAdmin?: boolean;
  requireExplicitCheckoutForSelfService?: boolean;
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
    if (requireApprovalForBase !== undefined)
      updateData.requireApprovalForBase = requireApprovalForBase;
    if (requireApprovalForSelfService !== undefined)
      updateData.requireApprovalForSelfService = requireApprovalForSelfService;
    if (requireExplicitCheckinForAdmin !== undefined)
      updateData.requireExplicitCheckinForAdmin =
        requireExplicitCheckinForAdmin;
    if (requireExplicitCheckinForSelfService !== undefined)
      updateData.requireExplicitCheckinForSelfService =
        requireExplicitCheckinForSelfService;
    if (requireExplicitCheckoutForAdmin !== undefined)
      updateData.requireExplicitCheckoutForAdmin =
        requireExplicitCheckoutForAdmin;
    if (requireExplicitCheckoutForSelfService !== undefined)
      updateData.requireExplicitCheckoutForSelfService =
        requireExplicitCheckoutForSelfService;
    if (countKitsAsSingleUnit !== undefined)
      updateData.countKitsAsSingleUnit = countKitsAsSingleUnit;
    if (notifyBookingCreator !== undefined)
      updateData.notifyBookingCreator = notifyBookingCreator;
    if (notifyAdminsOnNewBooking !== undefined)
      updateData.notifyAdminsOnNewBooking = notifyAdminsOnNewBooking;

    // Only a save that turns a switch on can start approval.
    const mayTurnApprovalOn =
      requireApprovalForBase === true || requireApprovalForSelfService === true;

    const bookingSettings = await db.$transaction(async (tx) => {
      const before = mayTurnApprovalOn
        ? await tx.bookingSettings.findUnique({
            where: { organizationId },
            select: BOOKING_APPROVAL_SWITCHES_SELECT,
          })
        : null;

      const updated = await tx.bookingSettings.update({
        where: { organizationId },
        data: updateData,
        select: BOOKING_SETTINGS_SELECT,
      });

      if (
        mayTurnApprovalOn &&
        !isBookingApprovalEnabled(before) &&
        isBookingApprovalEnabled(updated)
      ) {
        await stampLeftoverReservationsApproved(tx, organizationId);
      }

      return updated;
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
 * Uses `upsert` to lazily create default settings if the organization doesn't
 * have a `BookingSettings` row yet. Because the select returns a nested
 * relation (`alwaysNotifyTeamMembers`), Prisma emulates the upsert with a
 * separate read + create, so a concurrent first-hit can throw `P2002`; we catch
 * it and re-read (same as {@link getBookingSettingsForOrganization}).
 *
 * @param organizationId - The organization whose settings to fetch
 * @returns Notification flags and the always-notify team member list
 */
export async function getBookingNotificationSettingsForOrg(
  organizationId: string
) {
  try {
    try {
      return await db.bookingSettings.upsert({
        where: { organizationId },
        update: {},
        create: {
          organizationId,
          notifyBookingCreator: true,
          notifyAdminsOnNewBooking: true,
        },
        select: BOOKING_NOTIFICATION_SETTINGS_SELECT,
      });
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
        // `await` so a (rare) re-read failure is caught by the outer try and
        // wrapped in a ShelfError rather than escaping as a bare rejection.
        return await db.bookingSettings.findUniqueOrThrow({
          where: { organizationId },
          select: BOOKING_NOTIFICATION_SETTINGS_SELECT,
        });
      }
      throw cause;
    }
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
                displayName: true,
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
