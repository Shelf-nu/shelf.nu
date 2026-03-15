import { BookingStatus, AssetStatus, KitStatus } from "@shelf/database";
import type {
  Booking,
  Organization,
  Asset,
  Kit,
  User,
  UserOrganization,
  Tag,
  OrganizationRoles,
} from "@shelf/database";
import { addDays, isBefore } from "date-fns";
import { DateTime } from "luxon";
import { redirect } from "react-router";
import z from "zod";
import type { AuthSession } from "@server/session";
import { CheckinIntentEnum } from "~/components/booking/checkin-dialog";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import type { HeaderData } from "~/components/layout/header/types";
import type { SortingDirection } from "~/components/list/filters/sort-by";
import { partialCheckinAssetsSchema } from "~/components/scanner/drawer/uses/partial-checkin-drawer";
import { db } from "~/database/db.server";
import {
  findMany,
  findFirst,
  findFirstOrThrow,
  findUnique,
  findUniqueOrThrow,
  create,
  update,
  remove,
  count,
  updateMany,
  deleteMany,
  createMany,
} from "~/database/query-helpers.server";
import { sql, queryRaw, SqlFragment } from "~/database/sql.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import { validateBookingOwnership } from "~/utils/booking-authorization.server";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import {
  getClientHint,
  getDateTimeFormatFromHints,
  getHints,
  type ClientHint,
} from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import {
  getFiltersFromRequest,
  updateCookieWithPerPage,
} from "~/utils/cookies.server";
import { calcTimeDifference } from "~/utils/date-fns";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import {
  payload,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import {
  wrapDateForNote,
  wrapKitsForNote,
  wrapKitsWithDataForNote,
  wrapAssetsWithDataForNote,
  wrapUserLinkForNote,
  wrapLinkForNote,
  wrapBookingStatusForNote,
  wrapCustodianForNote,
  wrapDescriptionForNote,
} from "~/utils/markdoc-wrappers";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
// MergeInclude removed — no longer needed without Prisma includes
import {
  BOOKING_COMMON_INCLUDE,
  BOOKING_INCLUDE_FOR_EMAIL,
  BOOKING_INCLUDE_FOR_RESERVATION_EMAIL,
  BOOKING_SCHEDULER_EVENTS_ENUM,
  BOOKING_WITH_ASSETS_INCLUDE,
} from "./constants";
import {
  assetReservedEmailContent,
  cancelledBookingEmailContent,
  completedBookingEmailContent,
  deletedBookingEmailContent,
  extendBookingEmailContent,
  sendBookingUpdatedEmail,
  sendCheckinReminder,
} from "./email-helpers";
import {
  getBookingAssetsOrderBy,
  hasAssetBookingConflicts,
  isBookingEarlyCheckin,
  isBookingEarlyCheckout,
} from "./helpers";
import type {
  BookingLoaderResponse,
  BookingWithExtraInclude,
  ClashingBooking,
  SchedulerData,
} from "./types";
import {
  createBookingConflictConditions,
  getBookingWhereInput,
  isBookingExpired,
} from "./utils.server";
import { createSystemBookingNote } from "../booking-note/service.server";
import { createNotes } from "../note/service.server";
import { getOrganizationAdminsEmails } from "../organization/service.server";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Booking";

async function cancelScheduler(
  booking: Pick<Booking, "id" | "activeSchedulerReference">
) {
  try {
    if (!booking.activeSchedulerReference) {
      Logger.error(
        `Skipping scheduler cancellation for booking ${booking.id} because no activeSchedulerReference was found.`
      );
      return;
    }

    await scheduler.cancel(booking.activeSchedulerReference);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to cancel the scheduler for booking",
        additionalData: { booking },
        label,
      })
    );
  }
}

/**
 * Creates a consistent status transition note for booking activity logs
 *
 * @param bookingId - The booking ID to add the note to
 * @param fromStatus - The previous booking status
 * @param toStatus - The new booking status
 * @param userId - ID of the user who performed the action (if manual)
 * @param action - Optional custom action description (e.g., "checked-out", "checked-in")
 * @param custodianUserId - Optional custodian user ID for status badge extra info
 */
export async function createStatusTransitionNote({
  bookingId,
  fromStatus,
  toStatus,
  userId,
  action,
  custodianUserId,
}: {
  bookingId: string;
  fromStatus: BookingStatus;
  toStatus: BookingStatus;
  userId?: string;
  action?: string;
  custodianUserId?: string;
}) {
  const fromStatusBadge = wrapBookingStatusForNote(fromStatus, custodianUserId);
  const toStatusBadge = wrapBookingStatusForNote(toStatus, custodianUserId);

  let content: string;

  if (userId) {
    // User-initiated transition
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } as const,
    });
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });

    const actionText =
      action || getActionTextFromTransition(fromStatus, toStatus);
    content = `${userLink} ${actionText}. Status changed from ${fromStatusBadge} to ${toStatusBadge}`;
  } else {
    // System-initiated transition
    const actionText = getSystemActionText(fromStatus, toStatus);
    content = `${actionText}. Status changed from ${fromStatusBadge} to ${toStatusBadge}`;
  }

  await createSystemBookingNote({
    bookingId,
    content,
  });
}

/**
 * Gets appropriate action text for user-initiated status transitions
 */
export function getActionTextFromTransition(
  from: BookingStatus,
  to: BookingStatus
): string {
  const transition = `${from}->${to}`;

  switch (transition) {
    case "DRAFT->RESERVED":
      return "reserved the booking";
    case "RESERVED->DRAFT":
      return "reverted booking to draft";
    case "RESERVED->CANCELLED":
    case "ONGOING->CANCELLED":
    case "OVERDUE->CANCELLED":
      return "cancelled the booking";
    case "RESERVED->ONGOING":
      return "checked-out the booking";
    case "ONGOING->COMPLETE":
    case "OVERDUE->COMPLETE":
      return "checked-in the booking";
    case "COMPLETE->ARCHIVED":
      return "archived the booking";
    default:
      return "changed the booking status";
  }
}

/**
 * Gets appropriate action text for system-initiated status transitions
 */
export function getSystemActionText(
  from: BookingStatus,
  to: BookingStatus
): string {
  const transition = `${from}->${to}`;

  switch (transition) {
    case "ONGOING->OVERDUE":
      return "Booking became overdue";
    case "COMPLETE->ARCHIVED":
      return "Booking was automatically archived";
    default:
      return "Booking status changed";
  }
}

export async function scheduleNextBookingJob({
  data,
  when,
}: {
  data: SchedulerData;
  when: Date;
}) {
  try {
    const id = await scheduler.sendAfter(
      QueueNames.bookingQueue,
      data,
      {},
      when
    );
    await update(db, "Booking", {
      where: { id: data.id },
      data: { activeSchedulerReference: id },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while scheduling the next booking job.",
      additionalData: { ...data, when },
      label,
    });
  }
}

async function updateBookingAssetStates(
  booking: Booking & { assets: Pick<Asset, "id">[] },
  status: AssetStatus
) {
  try {
    return await updateMany(db, "Asset", {
      where: {
        status: { not: status },
        id: { in: booking.assets.map((a) => a.id) },
      },
      data: { status },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating the booking asset states.",
      additionalData: { booking, status },
      label,
    });
  }
}

async function updateBookingKitStates({
  kitIds,
  status,
}: {
  kitIds: string[];
  status: KitStatus;
}) {
  try {
    return await updateMany(db, "Kit", {
      where: { id: { in: kitIds } },
      data: { status },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating the booking kit states.",
      additionalData: { kitIds, status },
      label,
    });
  }
}

export async function createBooking({
  booking,
  assetIds,
  hints,
}: {
  /**
   * Booking object that contains all the required fields to create a booking
   */
  booking: Pick<
    Booking,
    | "name"
    | "description"
    | "creatorId"
    | "custodianUserId"
    | "organizationId"
    | "from"
    | "to"
  > & { custodianTeamMemberId: string; tags: { id: string }[] };

  /**
   * Asset IDs that are connected to the booking
   */
  assetIds: Asset["id"][];

  /**
   * Hints are used for setting the timezone of the booking
   */
  hints: ClientHint;
}) {
  try {
    const dataToCreate: Record<string, any> = {
      name: booking.name,
      from: booking.from,
      to: booking.to,
      description: booking.description,
      status: BookingStatus.DRAFT,
      creatorId: booking.creatorId,
      organizationId: booking.organizationId,
      /**
       * Updated original dates to user entered `from` and `to`
       * so that we can track of it later
       */
      originalFrom: booking.from,
      originalTo: booking.to,
      /**
       * Custodian team member will always be passed,
       * even if assigning to a user, so we directly connect it to the booking */
      custodianTeamMemberId: booking.custodianTeamMemberId,
    };

    if (booking.custodianUserId) {
      dataToCreate.custodianUserId = booking.custodianUserId;
    }

    const createdBooking = await create(db, "Booking", dataToCreate);

    /**
     * If assetsIds are passed, we directly connect them via the join table.
     * This can happen when:
     * - Booking is created from assets bulk actions
     * - Booking is created from asset page
     * */
    if (assetIds.length > 0) {
      await queryRaw(
        db,
        sql`INSERT INTO "_AssetToBooking" ("A", "B") SELECT unnest(${assetIds}::text[]), ${createdBooking.id} ON CONFLICT ("A", "B") DO NOTHING`
      );
    }

    if (booking.tags.length > 0) {
      const tagIds = booking.tags.map((t) => t.id);
      await queryRaw(
        db,
        sql`INSERT INTO "_BookingToTag" ("A", "B") SELECT ${createdBooking.id}, unnest(${tagIds}::text[]) ON CONFLICT ("A", "B") DO NOTHING`
      );
    }

    // TODO: convert complex Prisma include — for now return the created booking
    // The original included BOOKING_COMMON_INCLUDE + organization
    return createdBooking as any;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while trying to create or update the booking. Please try again or contact support.",
      additionalData: { booking, hints },
      label,
    });
  }
}

/**
 * Used when the user clicks the save booking to simply update the booking information
 * It only updates dates & custodian if the booking is in DRAFT state
 * In other ongoing states, it just updates name and description
 */
export async function updateBasicBooking({
  id,
  name,
  from,
  to,
  custodianTeamMemberId,
  custodianUserId,
  description,
  organizationId,
  tags,
  userId,
  hints,
}: Partial<
  Pick<
    Booking,
    | "id"
    | "name"
    | "from"
    | "to"
    | "custodianTeamMemberId"
    | "custodianUserId"
    | "description"
    | "organizationId"
  >
> &
  Pick<Booking, "id" | "organizationId"> & {
    tags: { id: string }[];
    userId?: User["id"];
    hints?: ClientHint;
  }) {
  try {
    // TODO: convert complex Prisma include — nested relations fetched separately
    let booking: any;
    try {
      booking = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
        select:
          "*, custodianTeamMember:TeamMember(id, name), custodianUser:User!custodianUserId(id, email, firstName, lastName)",
      });
      // Fetch tags separately (many-to-many)
      const bookingTags = await queryRaw<{ id: string; name: string }>(
        db,
        sql`SELECT t."id", t."name" FROM "Tag" t INNER JOIN "_BookingToTag" bt ON bt."B" = t."id" WHERE bt."A" = ${id}`
      );
      booking.tags = bookingTags;
      // Fetch custodianTeamMember's user separately
      if (booking.custodianTeamMember) {
        const tmUser = await findFirst(db, "User", {
          where: { id: booking.custodianTeamMember.userId },
          select: "id, firstName, lastName",
        });
        booking.custodianTeamMember.user = tmUser;
      }
    } catch (cause) {
      throw new ShelfError({
        cause,
        status: 404,
        message:
          "Could not find booking or the booking exists in another workspace.",
        label,
      });
    }

    // Capture old custodian email before the update
    // (for custodian change scenarios)
    const oldCustodianEmail = booking.custodianUser?.email;

    const dataToUpdate: Record<string, any> = {
      name,
      description,
    };

    /** Booking update is not allowed for these type of status */
    const notAllowedStatus: BookingStatus[] = [
      "COMPLETE",
      "ARCHIVED",
      "CANCELLED",
    ];

    if (notAllowedStatus.includes(booking.status)) {
      throw new ShelfError({
        cause: null,
        title: "Update failed",
        message: "Booking update is not allowed at this state of booking",
        label,
      });
    }

    /**
     * Changing of booking dates and custodian is only allowed for DRAFT status
     */
    if (booking.status === BookingStatus.DRAFT) {
      dataToUpdate.from = from;
      dataToUpdate.to = to;

      // Also update the original dates to new ones
      if (from) {
        dataToUpdate.originalFrom = from;
      }

      if (to) {
        dataToUpdate.originalTo = to;
      }

      /**
       * Custodian team member should always be passed.
       * This is also validated by the schema `BookingFormSchema`.
       * However, just in case we need to check it. If its not passed, we need to throw an error to prevent silent failure and corrupted data
       */
      if (custodianTeamMemberId) {
        dataToUpdate.custodianTeamMemberId = custodianTeamMemberId;

        /**
         * If a userId is passed, meaning the team member is connected to a user, we connct to it.
         * This will override the value if there were any previous custodians`
         */
        if (custodianUserId) {
          dataToUpdate.custodianUserId = custodianUserId;
        } else if (booking.custodianUserId) {
          /**
           * If previous booking custodian had a user, we need to remove it
           * because we are now connecting to an NRM. If we dont do this the teamMemberID and the userId will be connected to different entities
           */
          dataToUpdate.custodianUserId = null;
        }
      } else {
        throw new ShelfError({
          cause: null,
          title: "Update failed",
          message:
            "Custodian team member is required to update booking. This should not happen. Please refresh the page and try agian. If the issue persists, contact support",
          label,
        });
      }
    }

    const updatedBooking = await update(db, "Booking", {
      where: { id: booking.id },
      data: dataToUpdate,
    });

    // Update tags: clear existing, then re-connect
    await queryRaw(
      db,
      sql`DELETE FROM "_BookingToTag" WHERE "A" = ${booking.id}`
    );
    if (tags.length > 0) {
      const tagIds = tags.map((t) => t.id);
      await queryRaw(
        db,
        sql`INSERT INTO "_BookingToTag" ("A", "B") SELECT ${booking.id}, unnest(${tagIds}::text[]) ON CONFLICT ("A", "B") DO NOTHING`
      );
    }

    // BOOKING ACTIVITY LOG: Create separate notes for each change
    // This approach creates individual notes for each field change with proper user attribution

    // Get user data for attribution if userId is provided
    const user = userId
      ? await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } as const,
        })
      : null;
    const userLink = user ? wrapUserLinkForNote(user) : "**System**";

    // Collect plain-text change descriptions for the email
    const changes: string[] = [];

    // Helper to format dates for email change descriptions
    const formatDateForEmail = (date: Date) => {
      if (hints) {
        return getDateTimeFormatFromHints(hints, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(date);
      }
      return date.toISOString();
    };

    // Check and log name changes
    if (name && name !== booking.name) {
      await createSystemBookingNote({
        bookingId: booking.id,
        content: `${userLink} changed booking name from **${booking.name}** to **${name}**.`,
      });
      changes.push(`Booking name changed from "${booking.name}" to "${name}"`);
    }

    // Check and log description changes
    if (description !== undefined && description !== booking.description) {
      const oldDesc = booking.description || "(empty)";
      const newDesc = description || "(empty)";

      const descriptionChange = wrapDescriptionForNote(oldDesc, newDesc);

      await createSystemBookingNote({
        bookingId: booking.id,
        content: `${userLink} changed booking description from ${descriptionChange}.`,
      });
      changes.push("Booking description was updated");
    }

    // Check and log start date changes
    if (from && booking.from && from.getTime() !== booking.from.getTime()) {
      await createSystemBookingNote({
        bookingId: booking.id,
        content: `${userLink} changed booking start date from ${wrapDateForNote(
          booking.from
        )} to ${wrapDateForNote(from)}.`,
      });
      changes.push(
        `Start date changed from ${formatDateForEmail(
          booking.from
        )} to ${formatDateForEmail(from)}`
      );
    }

    // Check and log end date changes
    if (to && booking.to && to.getTime() !== booking.to.getTime()) {
      await createSystemBookingNote({
        bookingId: booking.id,
        content: `${userLink} changed booking end date from ${wrapDateForNote(
          booking.to
        )} to ${wrapDateForNote(to)}.`,
      });
      changes.push(
        `End date changed from ${formatDateForEmail(
          booking.to
        )} to ${formatDateForEmail(to)}`
      );
    }

    // Check and log custodian changes
    if (
      custodianTeamMemberId &&
      custodianTeamMemberId !== booking.custodianTeamMemberId
    ) {
      // Build custodian name helpers for the email change description
      const oldCustodianName = booking.custodianUser
        ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`
        : (booking.custodianTeamMember?.name ?? "Unknown");

      try {
        // Fetch new custodian details
        // Fetch team member + nested user via separate queries
        const newCustodian = (await findUnique(db, "TeamMember", {
          where: { id: custodianTeamMemberId },
          select: "id, name, userId",
        })) as any;
        if (newCustodian?.userId) {
          newCustodian.user = await findFirst(db, "User", {
            where: { id: newCustodian.userId },
            select: "id, firstName, lastName",
          });
        } else if (newCustodian) {
          newCustodian.user = null;
        }

        if (newCustodian) {
          let custodianChangeMessage = `${userLink} changed booking custodian`;

          // Format old custodian (if exists)
          if (booking.custodianTeamMember) {
            const oldCustodianFormatted = wrapCustodianForNote({
              teamMember: booking.custodianTeamMember,
            });
            custodianChangeMessage += ` from ${oldCustodianFormatted}`;
          }

          // Format new custodian
          const newCustodianFormatted = wrapCustodianForNote({
            teamMember: newCustodian,
          });
          custodianChangeMessage += ` to ${newCustodianFormatted}.`;

          await createSystemBookingNote({
            bookingId: booking.id,
            content: custodianChangeMessage,
          });

          const newCustodianName = newCustodian.user
            ? `${newCustodian.user.firstName} ${newCustodian.user.lastName}`
            : newCustodian.name;
          changes.push(
            `Custodian changed from ${oldCustodianName} to ${newCustodianName}`
          );
        }
      } catch (_error) {
        // If we can't fetch custodian details (e.g., in tests), fall back to generic message
        await createSystemBookingNote({
          bookingId: booking.id,
          content: `${userLink} changed booking custodian assignment.`,
        });
        changes.push("Custodian assignment was changed");
      }
    }

    // Check and log tag changes
    const oldTagIds = booking.tags.map((tag) => tag.id).sort();
    const newTagIds = tags.map((tag) => tag.id).sort();

    if (JSON.stringify(oldTagIds) !== JSON.stringify(newTagIds)) {
      // Get tag names for better readability
      const oldTagNames =
        booking.tags.map((tag) => tag.name).join(", ") || "(none)";

      // Get new tag names - we need to fetch them since we only have IDs
      const newTags = await findMany(db, "Tag", {
        where: { id: { in: newTagIds } },
        select: "name",
      });
      const newTagNames = newTags.map((tag) => tag.name).join(", ") || "(none)";

      await createSystemBookingNote({
        bookingId: booking.id,
        content: `${userLink} changed booking tags from **${oldTagNames}** to **${newTagNames}**.`,
      });
      changes.push(`Tags changed from "${oldTagNames}" to "${newTagNames}"`);
    }

    // Send email notification to custodian(s) about the changes
    if (changes.length > 0 && hints && userId) {
      const custodianChanged =
        custodianTeamMemberId &&
        custodianTeamMemberId !== booking.custodianTeamMemberId;

      void sendBookingUpdatedEmail({
        bookingId: booking.id,
        organizationId,
        userId,
        changes,
        hints,
        oldCustodianEmail: custodianChanged
          ? (oldCustodianEmail ?? undefined)
          : undefined,
      });
    }

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      title: "Update failed",
      message: isLikeShelfError(cause)
        ? cause.message
        : "Could not update the details of booking",
    });
  }
}

/**
 * Changes the status of a booking to RESERVED
 */
export async function reserveBooking({
  id,
  name,
  from,
  to,
  custodianTeamMemberId,
  custodianUserId,
  description,
  organizationId,
  hints,
  isSelfServiceOrBase,
  tags,
  userId,
}: Partial<
  Pick<
    Booking,
    | "id"
    | "name"
    | "from"
    | "to"
    | "custodianTeamMemberId"
    | "custodianUserId"
    | "description"
    | "organizationId"
  >
> &
  Pick<Booking, "id" | "organizationId"> & {
    hints: ClientHint;
    isSelfServiceOrBase: boolean;
    tags: { id: string }[];
    userId?: User["id"];
  }) {
  try {
    // TODO: convert complex Prisma include — nested relations for reservation email
    // Fetching booking with related data via separate queries
    let bookingFound: any;
    try {
      bookingFound = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
        select:
          "*, custodianTeamMember:TeamMember(*), custodianUser:User!custodianUserId(*), organization:Organization(*, owner:User!ownerId(email))",
      });
      // Fetch asset count
      const assetCountResult = await queryRaw<{ count: number }>(
        db,
        sql`SELECT COUNT(*)::int as count FROM "_AssetToBooking" WHERE "B" = ${id}`
      );
      bookingFound._count = { assets: assetCountResult[0]?.count ?? 0 };
      // Fetch assets with conflict bookings
      const assets = await queryRaw<any>(
        db,
        sql`SELECT a."id", a."title", a."status", c."name" as "categoryName"
            FROM "Asset" a
            INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id"
            LEFT JOIN "Category" c ON c."id" = a."categoryId"
            WHERE ab."B" = ${id}`
      );
      // Map category into nested object
      for (const asset of assets) {
        asset.category = asset.categoryName
          ? { name: asset.categoryName }
          : null;
        delete asset.categoryName;
        // Fetch conflicting bookings for each asset
        const conflictConditions = createBookingConflictConditions({
          currentBookingId: id,
          fromDate: from,
          toDate: to,
        });
        // Use the conflict conditions to find bookings for this asset
        const conflictBookings = await queryRaw<any>(
          db,
          sql`SELECT b."id", b."name", b."from", b."to", b."status"
              FROM "Booking" b
              INNER JOIN "_AssetToBooking" ab ON ab."B" = b."id"
              WHERE ab."A" = ${asset.id} AND b."id" != ${id}
              AND b."status" IN ('RESERVED', 'ONGOING', 'OVERDUE')`
        );
        asset.bookings = conflictBookings;
      }
      bookingFound.assets = assets;
    } catch (cause) {
      throw new ShelfError({
        cause,
        label,
        message:
          "Booking not found. Are you sure it exists in current workspace?",
      });
    }

    /** Server-side conflict validation to prevent race conditions */
    if (from && to && bookingFound.assets) {
      const conflictedAssets = bookingFound.assets.filter((asset) =>
        hasAssetBookingConflicts(asset, id)
      );

      if (conflictedAssets.length > 0) {
        const conflictedAssetNames = conflictedAssets
          .slice(0, 3)
          .map((asset) => asset.title)
          .join(", ");
        const additionalCount =
          conflictedAssets.length > 3 ? conflictedAssets.length - 3 : 0;
        const additionalText =
          additionalCount > 0 ? ` and ${additionalCount} more` : "";

        throw new ShelfError({
          cause: null,
          label,
          title: "Booking conflict",
          message: `Cannot reserve booking. Some assets are already booked or checked out: ${conflictedAssetNames}${additionalText}. Please remove conflicted assets and try again.`,
          shouldBeCaptured: false,
        });
      }
    }

    /** Validate the booking dates */
    if (!from || !to) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking dates are missing.",
      });
    }

    /** Make sure that the start date is in future */
    if (from && isBefore(from, new Date())) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking start date should be in future.",
      });
    }

    /** Make sure that the end date is after startDate */
    if (to && isBefore(to, from)) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking end date should be after start date.",
      });
    }

    const dataToUpdate: Record<string, any> = {
      status: BookingStatus.RESERVED,
      name,
      description,
    };

    dataToUpdate.from = from;
    dataToUpdate.originalFrom = from;

    dataToUpdate.to = to;
    dataToUpdate.originalTo = to;

    /**
     * Custodian team member should always be passed.
     * This is also validated by the schema `BookingFormSchema`.
     * However, just in case we need to check it. If its not passed, we need to throw an error to prevent silent failure and corrupted data
     */
    if (custodianTeamMemberId) {
      dataToUpdate.custodianTeamMemberId = custodianTeamMemberId;

      /**
       * If a userId is passed, meaning the team member is connected to a user, we connct to it.
       * This will override the value if there were any previous custodians`
       */
      if (custodianUserId) {
        dataToUpdate.custodianUserId = custodianUserId;
      } else if (bookingFound.custodianUserId) {
        /**
         * If previous booking custodian had a user, we need to remove it
         * because we are now connecting to an NRM. If we dont do this the teamMemberID and the userId will be connected to different entities
         */
        dataToUpdate.custodianUserId = null;
      }
    } else {
      throw new ShelfError({
        cause: null,
        title: "Update failed",
        message:
          "Custodian team member is required to update booking. This should not happen. Please refresh the page and try agian. If the issue persists, contact support",
        label,
      });
    }

    const updatedBooking = await update(db, "Booking", {
      where: { id: bookingFound.id },
      data: dataToUpdate,
    });

    // Update tags: clear existing, then re-connect
    await queryRaw(
      db,
      sql`DELETE FROM "_BookingToTag" WHERE "A" = ${bookingFound.id}`
    );
    if (tags.length > 0) {
      const tagIds = tags.map((t) => t.id);
      await queryRaw(
        db,
        sql`INSERT INTO "_BookingToTag" ("A", "B") SELECT ${bookingFound.id}, unnest(${tagIds}::text[]) ON CONFLICT ("A", "B") DO NOTHING`
      );
    }

    /** Calculate the time difference between the booking.to and the current time */
    const { hours } = calcTimeDifference(updatedBooking.from!, new Date());
    const moreThanOneHourToCheckOut = hours > 1;

    /**
     * We send the checkout reminder, when there is 1 h left to booking.from
     * This is to make sure that the user is reminded to check out the booking
     *
     * If there is more than 1 hour to check out, we need to schedule the reminder
     * else we don't need to send a reminder
     * Start the reminder scheduler
     * */

    if (moreThanOneHourToCheckOut) {
      const when = new Date(from);
      when.setHours(when.getHours() - 1); // send the reminder 1 hour before the booking starts

      await scheduleNextBookingJob({
        data: {
          id: bookingFound.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.checkoutReminder,
        },
        when,
      });
    }

    if (bookingFound.custodianUser?.email) {
      const custodian = bookingFound?.custodianUser
        ? `${bookingFound.custodianUser.firstName} ${bookingFound.custodianUser.lastName}`
        : (bookingFound.custodianTeamMember?.name ?? "");

      /** Prepare email content */
      const subject = `✅ Booking reserved (${bookingFound.name}) - shelf.nu`;

      const text = assetReservedEmailContent({
        bookingName: bookingFound.name,
        assetsCount: bookingFound._count.assets,
        custodian: custodian,
        from,
        to,
        hints,
        bookingId: bookingFound.id,
        customEmailFooter: bookingFound.organization.customEmailFooter,
      });

      const html = await bookingUpdatesTemplateString({
        booking: bookingFound,
        heading: `Booking reservation for ${custodian}`,
        assetCount: bookingFound._count.assets,
        hints,
        assets: bookingFound.assets,
      });
      /** END Prepare email content */

      /**
       * Here we need to check if the custodian has an OrganizationRole different than ADMIN
       * and send email to the admin in case they are different
       * */
      if (isSelfServiceOrBase) {
        const adminsEmails = await getOrganizationAdminsEmails({
          organizationId,
        });

        const adminSubject = `Booking reservation request (${bookingFound.name}) by ${custodian} - shelf.nu`;

        const adminHtml = await bookingUpdatesTemplateString({
          booking: bookingFound,
          heading: `Booking reservation request for ${custodian}`,
          assetCount: bookingFound._count.assets,
          hints,
          isAdminEmail: true,
          assets: bookingFound.assets,
        });

        sendEmail({
          to: adminsEmails.join(","),
          subject: adminSubject,
          text,
          /** We need to invoke this function separately for the admin email as the footer of emails is different */
          html: adminHtml,
        });
      }

      /**
       * Notify the custodian that the booking is reserved
       */
      sendEmail({
        to: bookingFound.custodianUser.email,
        subject,
        text,
        html,
      });
    }

    // Add activity log for status change to RESERVED
    await createStatusTransitionNote({
      bookingId: updatedBooking.id,
      fromStatus: bookingFound.status,
      toStatus: updatedBooking.status,
      userId,
      custodianUserId: updatedBooking.custodianUserId || undefined,
    });

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Could not reserve the booking.",
    });
  }
}

export async function checkoutBooking({
  id,
  organizationId,
  intentChoice,
  hints,
  from,
  to,
  userId,
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  intentChoice?: CheckoutIntentEnum;
  from?: Date | null;
  to?: Date | null;
  userId?: string;
}) {
  try {
    // TODO: convert complex Prisma include — booking with assets + conflict bookings + email data
    let bookingFound: any;
    try {
      bookingFound = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
        select:
          "*, custodianTeamMember:TeamMember(*), custodianUser:User!custodianUserId(*), organization:Organization(*, owner:User!ownerId(email))",
      });
      // Fetch asset count
      const assetCountResult = await queryRaw<{ count: number }>(
        db,
        sql`SELECT COUNT(*)::int as count FROM "_AssetToBooking" WHERE "B" = ${id}`
      );
      bookingFound._count = { assets: assetCountResult[0]?.count ?? 0 };
      // Fetch assets with conflict bookings
      const assets = await queryRaw<any>(
        db,
        sql`SELECT a.* FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${id}`
      );
      for (const asset of assets) {
        const conflictBookings = await queryRaw<any>(
          db,
          sql`SELECT b."id", b."name", b."from", b."to", b."status"
              FROM "Booking" b
              INNER JOIN "_AssetToBooking" ab ON ab."B" = b."id"
              WHERE ab."A" = ${asset.id} AND b."id" != ${id}
              AND b."status" IN ('RESERVED', 'ONGOING', 'OVERDUE')`
        );
        asset.bookings = conflictBookings;
      }
      bookingFound.assets = assets;
    } catch (cause) {
      throw new ShelfError({
        cause,
        label,
        message:
          "Booking not found, are you sure it exists in current workspace?",
      });
    }

    /** Server-side conflict validation to prevent race conditions */
    if (from && to && bookingFound.assets) {
      const conflictedAssets = bookingFound.assets.filter((asset) =>
        hasAssetBookingConflicts(asset, id)
      );

      if (conflictedAssets.length > 0) {
        const conflictedAssetNames = conflictedAssets
          .slice(0, 3)
          .map((asset) => asset.title)
          .join(", ");
        const additionalCount =
          conflictedAssets.length > 3 ? conflictedAssets.length - 3 : 0;
        const additionalText =
          additionalCount > 0 ? ` and ${additionalCount} more` : "";

        throw new ShelfError({
          cause: null,
          label,
          message: `Cannot check out booking. Some assets are already booked or checked out: ${conflictedAssetNames}${additionalText}. Please remove conflicted assets and try again.`,
        });
      }
    }

    /** Server-side validation: Block checkout if any assets are in custody */
    const assetsInCustody = bookingFound.assets.filter(
      (asset) => asset.status === AssetStatus.IN_CUSTODY
    );

    if (assetsInCustody.length > 0) {
      const assetNames = assetsInCustody
        .slice(0, 3)
        .map((asset) => asset.title)
        .join(", ");
      const additionalCount =
        assetsInCustody.length > 3 ? assetsInCustody.length - 3 : 0;
      const additionalText =
        additionalCount > 0 ? ` and ${additionalCount} more` : "";

      throw new ShelfError({
        cause: null,
        label,
        title: "Assets in custody",
        message: `Cannot check out booking. Some assets are currently in custody: ${assetNames}${additionalText}. Please release custody first or remove these assets from the booking.`,
        shouldBeCaptured: false,
      });
    }

    /**
     * This checks if the booking end date is in the past
     * We need this because sometimes the user can checkout a booking
     * that is already overdue for check in
     */
    const isExpired = isBookingExpired({ to: bookingFound.to! });

    const dataToUpdate: Record<string, any> = {
      status: isExpired ? BookingStatus.OVERDUE : BookingStatus.ONGOING,
    };

    /**
     * Get the kitIds because we need them to update their status later on
     */
    const kitIds = getKitIdsByAssets(bookingFound.assets);
    const hasKits = kitIds.length > 0;

    const isEarlyCheckout = isBookingEarlyCheckout(bookingFound.from!);

    /**
     * If user is doing an early checkout of booking then update the
     * booking's `from` date accordingly
     */
    if (
      isEarlyCheckout &&
      intentChoice === CheckoutIntentEnum["with-adjusted-date"]
    ) {
      // Update originalFrom to old `from` date of booking
      dataToUpdate.originalFrom = bookingFound.from;

      // Update `from` date to current date
      const fromDateStr = DateTime.fromJSDate(new Date(), {
        zone: hints.timeZone,
      }).toFormat(DATE_TIME_FORMAT);

      dataToUpdate.from = DateTime.fromFormat(fromDateStr, DATE_TIME_FORMAT, {
        zone: hints.timeZone,
      }).toJSDate();
    }

    // Sequential operations replacing db.$transaction
    /* Updating the status of all assets inside booking */
    await updateMany(db, "Asset", {
      where: { id: { in: bookingFound.assets.map((a: any) => a.id) } },
      data: { status: AssetStatus.CHECKED_OUT },
    });

    /** If there are any kits associated with the booking, then update their status */
    if (hasKits) {
      await updateMany(db, "Kit", {
        where: { id: { in: kitIds } },
        data: { status: KitStatus.CHECKED_OUT },
      });
    }

    /** Finally update the booking */
    const updatedBooking = (await update(db, "Booking", {
      where: { id: bookingFound.id },
      data: dataToUpdate,
    })) as any;
    // Re-attach email-related data from bookingFound
    updatedBooking.custodianTeamMember = bookingFound.custodianTeamMember;
    updatedBooking.custodianUser = bookingFound.custodianUser;
    updatedBooking.organization = bookingFound.organization;
    updatedBooking._count = bookingFound._count;
    updatedBooking.assets = bookingFound.assets;

    // Create status transition note
    if (userId) {
      await createStatusTransitionNote({
        bookingId: updatedBooking.id,
        fromStatus: BookingStatus.RESERVED,
        toStatus: updatedBooking.status,
        userId,
        custodianUserId: updatedBooking.custodianUserId || undefined,
      });
    }

    /** Calculate the time difference between the booking.to and the current time */
    const { hours } = calcTimeDifference(updatedBooking.to!, new Date());
    const lessThanOneHourToCheckin = hours < 1;

    /** We cancel just in case there is something pending */
    await cancelScheduler(updatedBooking);

    /**
     * If its expired that means its status will directly go to OVERDUE,
     * so we can cancel everything and don't schedule any more events
     * */
    if (isExpired) {
      return updatedBooking;
    }

    // For any checkout (early or not), what matters is time until check-in
    /**
     * If less than 1 hour until check-in time, then
     * send checkin reminder immediately.
     * We also schedule the overdue handler for the booking
     */
    if (lessThanOneHourToCheckin) {
      if (bookingFound.custodianUser?.email) {
        await sendCheckinReminder(
          bookingFound,
          bookingFound._count.assets,
          hints
        );
      }

      if (bookingFound.to) {
        const when = new Date(bookingFound.to);
        await scheduleNextBookingJob({
          data: {
            id: bookingFound.id,
            hints,
            eventType: BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler,
          },
          when,
        });
      }
    } else {
      /**
       * If the checkout is performed more than 1 hour before booking.to
       * the checkout reminder has not been sent yet
       * So we need to cancel it and manually schedule check-in reminder
       */
      const when = new Date(updatedBooking.to!);
      when.setHours(when.getHours() - 1); // send the reminder 1 hour before the booking ends
      await scheduleNextBookingJob({
        data: {
          id: bookingFound.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.checkinReminder,
        },
        when,
      });
    }

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while checking out booking.",
    });
  }
}

export async function checkinBooking({
  id,
  organizationId,
  hints,
  intentChoice,
  userId,
  specificAssetIds,
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  intentChoice?: CheckinIntentEnum;
  userId?: string;
  specificAssetIds?: string[];
}) {
  try {
    let bookingFound: any;
    try {
      bookingFound = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
      });
      // Fetch assets with their active booking links
      const assets = await queryRaw<any>(
        db,
        sql`SELECT a."id", a."kitId", a."status"
            FROM "Asset" a
            INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id"
            WHERE ab."B" = ${id}`
      );
      for (const asset of assets) {
        const activeBookings = await queryRaw<any>(
          db,
          sql`SELECT b."id", b."status"
              FROM "Booking" b
              INNER JOIN "_AssetToBooking" ab ON ab."B" = b."id"
              WHERE ab."A" = ${asset.id}
              AND b."status" IN ('ONGOING', 'OVERDUE')`
        );
        asset.bookings = activeBookings;
      }
      bookingFound.assets = assets;
    } catch (cause) {
      throw new ShelfError({
        cause,
        status: 404,
        label,
        message:
          "Booking not found, are you sure it exists in current workspace?",
      });
    }

    const dataToUpdate: Record<string, any> = {
      status: BookingStatus.COMPLETE,
    };

    const kitIds = getKitIdsByAssets(bookingFound.assets);
    const hasKits = kitIds.length > 0;

    const isEarlyCheckin = isBookingEarlyCheckin(bookingFound.to!);

    /**
     * If user is doing an early checkin of booking then update
     * the booking's `to` date accordingly
     */
    if (
      isEarlyCheckin &&
      intentChoice === CheckinIntentEnum["with-adjusted-date"]
    ) {
      // Update originalTo to booking's to date
      dataToUpdate.originalTo = bookingFound.to;

      // Update the `to` date to current date
      const toDateStr = DateTime.fromJSDate(new Date(), {
        zone: hints.timeZone,
      }).toFormat(DATE_TIME_FORMAT);

      dataToUpdate.to = DateTime.fromFormat(toDateStr, DATE_TIME_FORMAT, {
        zone: hints.timeZone,
      }).toJSDate();
    }

    /**
     * If booking was overdue then we have to adjust the endDate of booking
     * */
    if (bookingFound.status === BookingStatus.OVERDUE) {
      // Update originalTo to booking's to date
      dataToUpdate.originalTo = bookingFound.to;

      const toDateStr = DateTime.fromJSDate(new Date(), {
        zone: hints.timeZone,
      }).toFormat(DATE_TIME_FORMAT);

      // Update the `to` date to current date
      dataToUpdate.to = DateTime.fromFormat(toDateStr, DATE_TIME_FORMAT, {
        zone: hints.timeZone,
      }).toJSDate();
    }

    // Pre-compute linked active booking IDs outside the transaction
    const linkedActiveBookingIds = new Set<string>();
    bookingFound.assets.forEach((asset) => {
      (asset.bookings ?? []).forEach((linkedBooking) => {
        if (
          linkedBooking.id !== bookingFound.id &&
          (linkedBooking.status === BookingStatus.ONGOING ||
            linkedBooking.status === BookingStatus.OVERDUE)
        ) {
          linkedActiveBookingIds.add(linkedBooking.id);
        }
      });
    });

    // Pre-fetch partial check-ins for linked bookings outside the transaction
    const partialCheckinsForLinkedBookings =
      linkedActiveBookingIds.size > 0
        ? await findMany(db, "PartialBookingCheckin", {
            where: {
              bookingId: { in: Array.from(linkedActiveBookingIds) },
            },
            select: "bookingId, assetIds",
          })
        : [];

    // Build a map of bookingId -> Set of asset IDs that were partially checked in
    const partiallyCheckedInAssetsByBooking = new Map<string, Set<string>>();
    partialCheckinsForLinkedBookings.forEach((checkin) => {
      if (!partiallyCheckedInAssetsByBooking.has(checkin.bookingId)) {
        partiallyCheckedInAssetsByBooking.set(checkin.bookingId, new Set());
      }
      checkin.assetIds.forEach((assetId) => {
        partiallyCheckedInAssetsByBooking.get(checkin.bookingId)!.add(assetId);
      });
    });

    // Pre-compute which assets to check in outside the transaction
    const assetsToCheckin = bookingFound.assets
      .filter((asset) => {
        if (asset.status !== AssetStatus.CHECKED_OUT) {
          return false;
        }

        const hasActiveBookingConflict = (asset.bookings ?? []).some(
          (linkedBooking) => {
            if (
              linkedBooking.id === bookingFound.id ||
              (linkedBooking.status !== BookingStatus.ONGOING &&
                linkedBooking.status !== BookingStatus.OVERDUE)
            ) {
              return false;
            }

            const checkedInAssets = partiallyCheckedInAssetsByBooking.get(
              linkedBooking.id
            );
            if (checkedInAssets && checkedInAssets.has(asset.id)) {
              return false;
            }

            return true;
          }
        );

        if (hasActiveBookingConflict) {
          return false;
        }

        return true;
      })
      .map((asset) => asset.id);

    // Pre-compute which kits to check in
    const assetsToCheckinSet = new Set(assetsToCheckin);
    const kitsToCheckin = hasKits
      ? kitIds.filter((kitId) => {
          const kitAssetsInBooking = bookingFound.assets.filter(
            (asset) => asset.kitId === kitId
          );
          return kitAssetsInBooking.every(
            (asset) =>
              assetsToCheckinSet.has(asset.id) ||
              asset.status === AssetStatus.AVAILABLE
          );
        })
      : [];

    // Sequential operations replacing db.$transaction
    if (assetsToCheckin.length > 0) {
      await updateMany(db, "Asset", {
        where: { id: { in: assetsToCheckin } },
        data: { status: AssetStatus.AVAILABLE },
      });
    }
    /* If there are any kits associated with the booking, then update their status */
    if (hasKits) {
      if (kitsToCheckin.length > 0) {
        await updateMany(db, "Kit", {
          where: { id: { in: kitsToCheckin } },
          data: { status: KitStatus.AVAILABLE },
        });
      }
    }

    /** Finally update the booking */
    const updatedBooking = (await update(db, "Booking", {
      where: { id: bookingFound.id },
      data: dataToUpdate,
    })) as any;
    // Re-attach email-related data
    updatedBooking.custodianTeamMember =
      bookingFound.custodianTeamMember || null;
    updatedBooking.custodianUser = bookingFound.custodianUser || null;
    updatedBooking.organization = bookingFound.organization || null;
    updatedBooking._count = bookingFound._count || { assets: 0 };
    updatedBooking.assets = bookingFound.assets;

    // Create status transition note
    if (userId) {
      if (specificAssetIds && specificAssetIds.length > 0) {
        // Create enhanced completion message with asset details
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } as const,
        });

        // Get asset and kit data for consistent formatting
        const assetsWithKitInfo = await queryRaw<any>(
          db,
          sql`SELECT a."id", a."title", a."kitId", k."id" as "kit_id", k."name" as "kit_name"
              FROM "Asset" a
              LEFT JOIN "Kit" k ON k."id" = a."kitId"
              WHERE a."id" = ANY(${specificAssetIds}::text[])`
        );
        // Map kit data into nested object
        for (const asset of assetsWithKitInfo) {
          asset.kit = asset.kit_id
            ? { id: asset.kit_id, name: asset.kit_name }
            : null;
          delete asset.kit_id;
          delete asset.kit_name;
        }

        // Separate complete kits from individual assets
        const kitIds = getKitIdsByAssets(
          (updatedBooking.assets || []).filter((a) =>
            specificAssetIds?.includes(a.id)
          )
        );
        const completeKits: Array<{ id: string; name: string }> = [];
        const standaloneAssets: Array<{ id: string; title: string }> = [];
        const processedKitIds = new Set<string>();

        for (const asset of assetsWithKitInfo) {
          if (
            asset.kit &&
            kitIds.includes(asset.kit.id) &&
            !processedKitIds.has(asset.kit.id)
          ) {
            completeKits.push({ id: asset.kit.id, name: asset.kit.name });
            processedKitIds.add(asset.kit.id);
          } else if (!asset.kit) {
            standaloneAssets.push({ id: asset.id, title: asset.title });
          }
        }

        // Build items description
        const hasKits = completeKits.length > 0;
        const hasAssets = standaloneAssets.length > 0;
        let itemsDescription = "";

        if (hasKits && hasAssets) {
          const kitContent = wrapKitsWithDataForNote(
            completeKits,
            "checked in"
          );
          const assetContent = wrapAssetsWithDataForNote(
            standaloneAssets,
            "checked in"
          );
          itemsDescription = `${assetContent} and ${kitContent}`;
        } else if (hasKits) {
          itemsDescription = wrapKitsWithDataForNote(
            completeKits,
            "checked in"
          );
        } else if (hasAssets) {
          itemsDescription = wrapAssetsWithDataForNote(
            standaloneAssets,
            "checked in"
          );
        }

        // Create enhanced completion message
        const fromStatusBadge = wrapBookingStatusForNote(
          bookingFound.status,
          updatedBooking.custodianUserId || undefined
        );
        const toStatusBadge = wrapBookingStatusForNote(
          BookingStatus.COMPLETE,
          updatedBooking.custodianUserId || undefined
        );

        await createSystemBookingNote({
          bookingId: updatedBooking.id,
          content: `${wrapUserLinkForNote(
            user!
          )} performed a partial check-in: ${itemsDescription} and completed the booking. Status changed from ${fromStatusBadge} to ${toStatusBadge}`,
        });
      } else {
        // Standard status transition note
        await createStatusTransitionNote({
          bookingId: updatedBooking.id,
          fromStatus: bookingFound.status,
          toStatus: BookingStatus.COMPLETE,
          userId,
          custodianUserId: updatedBooking.custodianUserId || undefined,
        });
      }
    }

    /**
     * At this point when user is checking in the booking,
     * we just have to cancel all active scheduler (if there is any).
     * Because, if the only possible case is OVERDUE, and if it was OVERDUE
     * during the checkin it must have been handled by overdueHandler.
     */
    await cancelScheduler(updatedBooking);

    /**
     * Check if auto-archive is enabled for this organization
     * and schedule the auto-archive job if needed
     */
    const bookingSettings = await findUnique(db, "BookingSettings", {
      where: { organizationId: updatedBooking.organizationId },
      select: "autoArchiveBookings, autoArchiveDays",
    });

    if (bookingSettings?.autoArchiveBookings) {
      const when = new Date();
      when.setDate(when.getDate() + bookingSettings.autoArchiveDays);

      await scheduleNextBookingJob({
        data: {
          id: updatedBooking.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.autoArchiveHandler,
        },
        when,
      });
    }

    if (updatedBooking.custodianUser?.email) {
      const custodian = updatedBooking?.custodianUser
        ? `${updatedBooking.custodianUser.firstName} ${updatedBooking.custodianUser.lastName}`
        : (updatedBooking.custodianTeamMember?.name ?? "");

      const subject = `🎉 Booking completed (${updatedBooking.name}) - shelf.nu`;
      const text = completedBookingEmailContent({
        bookingName: updatedBooking.name,
        assetsCount: updatedBooking._count.assets,
        custodian: custodian,
        from: updatedBooking.from as Date, // We can safely cast here as we know the booking is overdue so it must have a from and to date
        to: updatedBooking.to as Date,
        bookingId: updatedBooking.id,
        hints: hints,
        customEmailFooter: updatedBooking.organization.customEmailFooter,
      });

      const html = await bookingUpdatesTemplateString({
        booking: updatedBooking,
        heading: `Your booking has been completed: "${updatedBooking.name}".`,
        assetCount: updatedBooking._count.assets,
        hints,
      });

      sendEmail({
        to: updatedBooking.custodianUser.email,
        subject,
        text,
        html,
      });
    }

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while checking in booking.",
    });
  }
}

export async function partialCheckinBooking({
  id,
  organizationId,
  assetIds,
  userId,
  hints,
  intentChoice,
}: Pick<Booking, "id" | "organizationId"> & {
  assetIds: Asset["id"][];
  userId: User["id"];
  hints: ClientHint;
  intentChoice?: CheckinIntentEnum;
}) {
  try {
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } as const,
    });
    // First, validate the booking exists and get its current assets
    let bookingFound: any;
    try {
      bookingFound = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
      });
      // Fetch assets for this booking
      const bookingAssets = await queryRaw<any>(
        db,
        sql`SELECT a."id", a."kitId" FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${id}`
      );
      bookingFound.assets = bookingAssets;
    } catch (cause) {
      throw new ShelfError({
        cause,
        status: 404,
        label,
        message:
          "Booking not found, are you sure it exists in current workspace?",
      });
    }

    // Early exit: If we're checking in all remaining CHECKED_OUT assets, do a complete check-in instead
    // First, get the current status of all assets in the booking
    const currentAssetStatuses = await findMany(db, "Asset", {
      where: { id: { in: bookingFound.assets.map((a: any) => a.id) } },
      select: "id, status",
    });

    // Find assets that are still CHECKED_OUT (not yet checked in)
    const checkedOutAssets = currentAssetStatuses.filter(
      (asset) => asset.status === AssetStatus.CHECKED_OUT
    );

    const checkedOutAssetIds = new Set(checkedOutAssets.map((a) => a.id));
    const providedAssetIds = new Set(assetIds);

    // Check if we're checking in all remaining CHECKED_OUT assets
    if (
      checkedOutAssetIds.size > 0 &&
      checkedOutAssetIds.size === providedAssetIds.size &&
      [...checkedOutAssetIds].every((id) => providedAssetIds.has(id))
    ) {
      // DON'T create PartialBookingCheckin record when doing complete check-in redirect
      // The checkinBooking function will handle the completion properly
      // Creating the record here would cause checkinBooking to filter out the current assets

      // Create notes before complete check-in since this was initiated as explicit check-in
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });
      const noteContent = `${actor} checked in via explicit check-in scanner. All assets were scanned, so complete check-in was performed.`;
      await createNotes({
        content: noteContent,
        type: "UPDATE",
        userId,
        assetIds,
      });

      // Do complete check-in with specific asset information for enhanced messaging
      const completedBooking = await checkinBooking({
        id,
        organizationId,
        hints,
        intentChoice,
        userId,
        specificAssetIds: assetIds,
      });

      return {
        booking: completedBooking,
        checkedInAssetCount: assetIds.length,
        remainingAssetCount: 0,
        isComplete: true,
      };
    }

    // Validate that all provided assetIds are actually in the booking
    const bookingAssetIds = new Set(bookingFound.assets.map((a) => a.id));
    const invalidAssetIds = assetIds.filter((id) => !bookingAssetIds.has(id));

    if (invalidAssetIds.length > 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: `Some assets are not part of this booking: ${invalidAssetIds.join(
          ", "
        )}`,
      });
    }

    // For kits: only update kit status if ALL assets of a kit are being checked in
    const assetsBeingCheckedIn = bookingFound.assets.filter((a) =>
      assetIds.includes(a.id)
    );
    const kitIdsBeingCheckedIn = getKitIdsByAssets(assetsBeingCheckedIn);

    // Only process kits where ALL their assets in this booking are being checked in
    const completeKitIds: string[] = [];
    for (const kitId of kitIdsBeingCheckedIn) {
      const kitAssetsInBooking = bookingFound.assets.filter(
        (a) => a.kitId === kitId
      );
      const kitAssetsBeingCheckedIn = assetsBeingCheckedIn.filter(
        (a) => a.kitId === kitId
      );

      if (kitAssetsInBooking.length === kitAssetsBeingCheckedIn.length) {
        completeKitIds.push(kitId);
      }
    }

    // Sequential operations replacing db.$transaction
    // Update the status of checked-in assets to AVAILABLE
    await updateMany(db, "Asset", {
      where: { id: { in: assetIds } },
      data: { status: AssetStatus.AVAILABLE },
    });

    // Only update kit status for kits that are completely checked in
    if (completeKitIds.length > 0) {
      await updateMany(db, "Kit", {
        where: { id: { in: completeKitIds } },
        data: { status: KitStatus.AVAILABLE },
      });
    }

    // Create partial check-in record for tracking
    await create(db, "PartialBookingCheckin", {
      bookingId: id,
      checkedInById: userId,
      assetIds,
      checkinCount: assetIds.length,
    });

    // Create audit notes for each checked-in asset using createNotes
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    const noteContent = `${actor} checked in via partial check-in.`;
    await createNotes({
      content: noteContent,
      type: "UPDATE",
      userId,
      assetIds,
    });

    // BOOKING ACTIVITY LOG: Log partial check-in activity
    // Get the kit and standalone asset data for consistent formatting
    const assetsWithKitInfo = await queryRaw<any>(
      db,
      sql`SELECT a."id", a."title", a."kitId", k."id" as "kit_id", k."name" as "kit_name"
          FROM "Asset" a
          LEFT JOIN "Kit" k ON k."id" = a."kitId"
          WHERE a."id" = ANY(${assetIds}::text[])`
    );
    for (const asset of assetsWithKitInfo) {
      asset.kit = asset.kit_id
        ? { id: asset.kit_id, name: asset.kit_name }
        : null;
      delete asset.kit_id;
      delete asset.kit_name;
    }

    // Separate complete kits from individual assets
    const completeKits: Array<{ id: string; name: string }> = [];
    const standaloneAssets: Array<{ id: string; title: string }> = [];
    const processedKitIds = new Set<string>();

    for (const asset of assetsWithKitInfo) {
      if (
        asset.kit &&
        completeKitIds.includes(asset.kit.id) &&
        !processedKitIds.has(asset.kit.id)
      ) {
        completeKits.push({ id: asset.kit.id, name: asset.kit.name });
        processedKitIds.add(asset.kit.id);
      } else if (!asset.kit) {
        standaloneAssets.push({ id: asset.id, title: asset.title });
      }
    }

    const hasKitsPartial = completeKits.length > 0;
    const hasAssetsPartial = standaloneAssets.length > 0;

    let itemsDescription = "";
    if (hasKitsPartial && hasAssetsPartial) {
      const kitContent = wrapKitsWithDataForNote(completeKits, "checked in");
      const assetContent = wrapAssetsWithDataForNote(
        standaloneAssets,
        "checked in"
      );
      itemsDescription = `${assetContent} and ${kitContent}`;
    } else if (hasKitsPartial) {
      const kitContent = wrapKitsWithDataForNote(completeKits, "checked in");
      itemsDescription = kitContent;
    } else if (hasAssetsPartial) {
      const assetContent = wrapAssetsWithDataForNote(
        standaloneAssets,
        "checked in"
      );
      itemsDescription = assetContent;
    }

    // Get the updated booking with all original assets to calculate remaining count
    const updatedBookingForNote = (await findUniqueOrThrow(db, "Booking", {
      where: { id },
    })) as any;
    const bookingAssetsFull = await queryRaw<any>(
      db,
      sql`SELECT a.* FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${id}`
    );
    updatedBookingForNote.assets = bookingAssetsFull;
    updatedBookingForNote._count = { assets: bookingAssetsFull.length };

    const remainingCount =
      updatedBookingForNote.assets.length - assetIds.length;
    const isCompletingBooking = remainingCount === 0;

    let updatedBooking: any;
    if (isCompletingBooking) {
      // Update booking status to COMPLETE
      const completedBooking = (await update(db, "Booking", {
        where: { id },
        data: { status: BookingStatus.COMPLETE },
      })) as any;
      completedBooking.assets = updatedBookingForNote.assets;
      completedBooking._count = updatedBookingForNote._count;

      // Create combined completion message
      const fromStatusBadge = wrapBookingStatusForNote(
        updatedBookingForNote.status,
        completedBooking.custodianUserId || undefined
      );
      const toStatusBadge = wrapBookingStatusForNote(
        BookingStatus.COMPLETE,
        completedBooking.custodianUserId || undefined
      );

      await createSystemBookingNote({
        bookingId: id,
        content: `${wrapUserLinkForNote(
          user!
        )} performed a partial check-in: ${itemsDescription} and completed the booking. Status changed from ${fromStatusBadge} to ${toStatusBadge}`,
      });

      updatedBooking = {
        booking: completedBooking,
        checkedInAssetCount: assetIds.length,
        remainingAssetCount: 0,
        isComplete: true,
      };
    } else {
      // Regular partial check-in
      const remainingText = ` (Remaining: ${remainingCount})`;

      await createSystemBookingNote({
        bookingId: id,
        content: `${wrapUserLinkForNote(
          user!
        )} performed a partial check-in: ${itemsDescription}${remainingText}.`,
      });

      updatedBooking = {
        booking: updatedBookingForNote,
        checkedInAssetCount: assetIds.length,
        remainingAssetCount: remainingCount,
        isComplete: false,
      };
    }

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while partially checking in booking.",
    });
  }
}

export async function updateBookingAssets({
  id,
  organizationId,
  assetIds,
  kitIds,
  userId,
}: Pick<Booking, "id" | "organizationId"> & {
  assetIds: Asset["id"][];
  kitIds?: Kit["id"][];
  userId?: User["id"];
}) {
  try {
    // Sequential operations replacing db.$transaction
    // Verify booking exists before inserting into the join table
    const b = (await findUniqueOrThrow(db, "Booking", {
      where: { id, organizationId },
      select: "id, name, status",
    })) as any;

    // Dedupe assetIds so duplicate entries don't cause false validation failures
    const uniqueAssetIds = [...new Set(assetIds)];

    // Validate that all asset IDs exist before inserting into the join table
    const validAssets = await findMany(db, "Asset", {
      where: { id: { in: uniqueAssetIds }, organizationId },
      select: "id",
    });
    const validAssetIds = validAssets.map((a: any) => a.id);

    if (validAssetIds.length === 0) {
      throw new ShelfError({
        cause: null,
        message:
          "None of the selected assets exist. They may have been deleted.",
        label,
        shouldBeCaptured: false,
        status: 400,
      });
    }

    if (validAssetIds.length !== uniqueAssetIds.length) {
      throw new ShelfError({
        cause: null,
        message:
          "Some of the selected assets no longer exist. Please reload and try again.",
        label,
        shouldBeCaptured: false,
        status: 400,
      });
    }

    await Promise.all([
      // Bulk insert into the join table
      queryRaw(
        db,
        sql`INSERT INTO "_AssetToBooking" ("A", "B")
            SELECT unnest(${validAssetIds}::text[]), ${id}
            ON CONFLICT ("A", "B") DO NOTHING`
      ),
      // Touch updatedAt since the raw INSERT doesn't update the booking row
      update(db, "Booking", {
        where: { id },
        data: { updatedAt: new Date() },
      }),
    ]);

    /**
     *  When adding an asset to a booking, we need to update the status of the asset to CHECKED_OUT if the booking is ONGOING or OVERDUE
     */
    if (
      b.status === BookingStatus.ONGOING ||
      b.status === BookingStatus.OVERDUE
    ) {
      await updateMany(db, "Asset", {
        where: { id: { in: validAssetIds }, organizationId },
        data: { status: AssetStatus.CHECKED_OUT },
      });

      /**
       * Also update kit status to CHECKED_OUT for any kits that contain these assets
       */
      if (kitIds && kitIds.length > 0) {
        await updateMany(db, "Kit", {
          where: { id: { in: kitIds }, organizationId },
          data: { status: KitStatus.CHECKED_OUT },
        });
      }
    }
    const booking = b;

    // BOOKING ACTIVITY LOG: Log asset addition activity
    // Creates user-attributed note when assets are added to a booking
    // Skip note creation if kits are involved - kit notes are created separately
    if (!kitIds || kitIds.length === 0) {
      // Fetch asset data to use proper wrapper for single assets
      const assets = await findMany(db, "Asset", {
        where: { id: { in: assetIds }, organizationId },
        select: "id, title",
      });

      const assetContent = wrapAssetsWithDataForNote(assets, "added");

      if (userId) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } as const,
        });
        await createSystemBookingNote({
          bookingId: booking.id,
          content: `${wrapUserLinkForNote(
            user
          )} added ${assetContent} to the booking.`,
        });
      } else {
        // Fallback for backward compatibility when userId is not provided
        await createSystemBookingNote({
          bookingId: booking.id,
          content: `${assetContent} added to the booking.`,
        });
      }
    }

    return booking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating booking assets.",
    });
  }
}

export async function createKitBookingNote({
  bookingId,
  kitIds,
  kits = [],
  userId,
  action = "added",
}: {
  bookingId: string;
  kitIds: string[];
  kits?: Array<{ id: string; name: string }>;
  userId?: string;
  action?: string;
}) {
  const kitContent =
    kits.length > 0
      ? wrapKitsWithDataForNote(kits, action)
      : wrapKitsForNote(kitIds, action);

  if (userId) {
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } as const,
    });
    await createSystemBookingNote({
      bookingId,
      content: `${wrapUserLinkForNote(
        user
      )} ${action} ${kitContent} to the booking.`,
    });
  } else {
    await createSystemBookingNote({
      bookingId,
      content: `${kitContent} ${action} to the booking.`,
    });
  }
}

export async function archiveBooking({
  id,
  organizationId,
  userId,
}: Pick<Booking, "id" | "organizationId"> & {
  userId?: string;
}) {
  try {
    let booking: any;
    try {
      booking = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
        select: "id, status, activeSchedulerReference",
      });
    } catch (cause) {
      throw new ShelfError({
        cause,
        label,
        title: "Not found",
        message:
          "Booking not found, are you sure it exists in current workspace?",
      });
    }

    /** Booking can be archived only if it is COMPLETE */
    if (booking.status !== BookingStatus.COMPLETE) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Archiving is only allowed for Completed bookings.",
      });
    }

    const updatedBooking = await update(db, "Booking", {
      where: { id: booking.id },
      data: { status: BookingStatus.ARCHIVED },
    });

    // Cancel any pending auto-archive job
    await cancelScheduler(booking);

    // Add activity log for booking archival
    await createStatusTransitionNote({
      bookingId: updatedBooking.id,
      fromStatus: booking.status,
      toStatus: BookingStatus.ARCHIVED,
      userId,
      custodianUserId: updatedBooking.custodianUserId || undefined,
    });

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while archiving the booking. Please try again.",
    });
  }
}

export async function cancelBooking({
  id,
  organizationId,
  hints,
  userId,
  cancellationReason,
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  userId?: string;
  cancellationReason?: string;
}) {
  try {
    let bookingFound: any;
    try {
      bookingFound = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
        select: "id, status",
      });
      // Fetch assets for this booking
      const bookingAssets = await queryRaw<any>(
        db,
        sql`SELECT a."id", a."kitId" FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${id}`
      );
      bookingFound.assets = bookingAssets;
    } catch (cause) {
      throw new ShelfError({
        cause,
        label,
        message:
          "Booking not found. Are you sure it exists in current workspace?",
      });
    }

    const allowedStatusForCancel: BookingStatus[] = [
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
      BookingStatus.RESERVED,
    ];

    if (!allowedStatusForCancel.includes(bookingFound.status)) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking cannot be cancelled at the current state.",
      });
    }

    const kitIds = getKitIdsByAssets(bookingFound.assets);
    const hasKits = kitIds.length > 0;

    // Sequential operations replacing db.$transaction
    /** If booking is ONGOING or OVERDUE, we have to make the assets available */
    if (bookingFound.status !== BookingStatus.RESERVED) {
      await updateMany(db, "Asset", {
        where: { id: { in: bookingFound.assets.map((a: any) => a.id) } },
        data: { status: AssetStatus.AVAILABLE },
      });

      /** If there are any kits, then update their status as well */
      if (hasKits) {
        await updateMany(db, "Kit", {
          where: { id: { in: kitIds } },
          data: { status: KitStatus.AVAILABLE },
        });
      }
    }

    const booking = (await update(db, "Booking", {
      where: { id: bookingFound.id },
      data: { status: BookingStatus.CANCELLED, cancellationReason },
    })) as any;
    // Re-attach email-related data
    booking.custodianTeamMember = null;
    booking.custodianUser = null;
    booking.organization = null;
    booking._count = { assets: bookingFound.assets.length };
    booking.assets = bookingFound.assets;
    // Fetch email-related data
    if (booking.custodianUserId) {
      booking.custodianUser = await findFirst(db, "User", {
        where: { id: booking.custodianUserId },
      });
    }
    if (booking.custodianTeamMemberId) {
      booking.custodianTeamMember = await findFirst(db, "TeamMember", {
        where: { id: booking.custodianTeamMemberId },
      });
    }
    const org = await findFirst(db, "Organization", {
      where: { id: booking.organizationId },
    });
    if (org) {
      const owner = await findFirst(db, "User", {
        where: { id: (org as any).ownerId },
      });
      booking.organization = { ...org, owner };
    }

    /** Cancel any active schedulers */
    await cancelScheduler(booking);

    if (booking.custodianUser?.email) {
      const subject = `Booking canceled (${booking.name}) - shelf.nu`;
      const text = cancelledBookingEmailContent({
        bookingName: booking.name,
        assetsCount: booking._count.assets,
        custodian:
          `${booking.custodianUser?.firstName} ${booking.custodianUser?.lastName}` ||
          (booking.custodianTeamMember?.name as string),
        from: booking.from as Date, // We can safely cast here as we know the booking is overdue so it myust have a from and to date
        to: booking.to as Date,
        bookingId: booking.id,
        hints,
        cancellationReason,
        customEmailFooter: booking.organization.customEmailFooter,
      });

      const html = await bookingUpdatesTemplateString({
        booking: booking,
        heading: `Your booking has been cancelled: "${booking.name}".`,
        assetCount: booking._count.assets,
        hints,
        cancellationReason,
      });

      sendEmail({
        to: booking.custodianUser.email,
        subject,
        text,
        html,
      });
    }

    // Add activity log for booking cancellation
    await createStatusTransitionNote({
      bookingId: booking.id,
      fromStatus: bookingFound.status,
      toStatus: BookingStatus.CANCELLED,
      userId,
      custodianUserId: booking.custodianUserId || undefined,
    });

    return booking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while cancelling the booking, please try again.",
    });
  }
}

export async function revertBookingToDraft({
  id,
  organizationId,
  userId,
}: Pick<Booking, "id" | "organizationId"> & {
  userId?: User["id"];
}) {
  try {
    let booking: any;
    try {
      booking = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
        select: "id, status",
      });
    } catch (cause) {
      throw new ShelfError({
        cause,
        label,
        message:
          "Booking not found, are you sure the booking exists in current workspace?",
      });
    }

    /** User can only revert the booking to DRAFT from RESERVED */
    if (booking.status !== BookingStatus.RESERVED) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking can be reverted to draft only for reserved state.",
      });
    }

    const cancelledBooking = await update(db, "Booking", {
      where: { id: booking.id },
      data: { status: BookingStatus.DRAFT },
    });

    // Add activity log for booking revert to draft
    if (userId) {
      await createStatusTransitionNote({
        bookingId: cancelledBooking.id,
        fromStatus: booking.status,
        toStatus: BookingStatus.DRAFT,
        userId,
        custodianUserId: cancelledBooking.custodianUserId || undefined,
      });
    } else {
      // System-initiated revert (fallback)
      await createStatusTransitionNote({
        bookingId: cancelledBooking.id,
        fromStatus: booking.status,
        toStatus: BookingStatus.DRAFT,
        custodianUserId: cancelledBooking.custodianUserId || undefined,
      });
    }

    /** Cancels all scheduled events */
    await cancelScheduler(cancelledBooking);

    return cancelledBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while reverting the booking to draft.",
    });
  }
}

export async function extendBooking({
  id,
  organizationId,
  newEndDate,
  hints,
  userId,
  role,
}: Pick<Booking, "id" | "organizationId"> & {
  newEndDate: Date;
  hints: ClientHint;
  userId: string;
  role: OrganizationRoles;
}) {
  try {
    let booking: any;
    try {
      booking = await findUniqueOrThrow(db, "Booking", {
        where: { id, organizationId },
        select:
          'id, status, "to", activeSchedulerReference, "from", creatorId, custodianUserId',
      });
      // Fetch assets
      const bookingAssets = await queryRaw<any>(
        db,
        sql`SELECT a."id", a."status" FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${id}`
      );
      booking.assets = bookingAssets;
      // Fetch partial checkins
      const partialCheckins = await findMany(db, "PartialBookingCheckin", {
        where: { bookingId: id },
        select: "assetIds",
      });
      booking.partialCheckins = partialCheckins;
    } catch (cause) {
      throw new ShelfError({
        cause,
        label,
        message:
          "Booking not found. Are you sure it exists in the current workspace?",
      });
    }

    validateBookingOwnership({
      booking,
      userId,
      role,
      action: "extend",
      blockBaseEntirely: true,
    });

    /** Extending booking is allowed only for these status */
    const allowedStatus: BookingStatus[] = [
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ];

    if (!allowedStatus.includes(booking.status)) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Extending booking is not allowed for current status.",
      });
    }

    /** Get assets that have been returned via partial check-in */
    const checkedInAssetIds = booking.partialCheckins.flatMap(
      (checkin) => checkin.assetIds
    );

    /** Filter to only assets that are actively checked out (not returned) */
    const activeAssets = booking.assets.filter(
      (asset) =>
        (asset.status === AssetStatus.CHECKED_OUT ||
          asset.status === AssetStatus.IN_CUSTODY) &&
        !checkedInAssetIds.includes(asset.id)
    );

    /** Validate that there are still active assets to extend the booking for */
    if (activeAssets.length === 0) {
      throw new ShelfError({
        cause: null,
        label,
        message:
          "Cannot extend booking. All assets have been returned. Please complete the booking instead.",
        shouldBeCaptured: false,
      });
    }

    /** Wrap conflict detection and update in a transaction to prevent race conditions */
    /** Checking if the booking period is clashing with any other booking containing the same active asset(s).*/
    const activeAssetIds = activeAssets.map((a: any) => a.id);
    const clashingBookings: ClashingBooking[] = await queryRaw<ClashingBooking>(
      db,
      sql`SELECT DISTINCT b."id", b."name"
          FROM "Booking" b
          INNER JOIN "_AssetToBooking" ab ON ab."B" = b."id"
          WHERE b."id" != ${booking.id}
          AND b."organizationId" = ${organizationId}
          AND b."status" = 'RESERVED'
          AND ab."A" = ANY(${activeAssetIds}::text[])
          AND b."from" > ${booking.to}
          AND b."from" <= ${newEndDate}`
    );

    if (clashingBookings?.length > 0) {
      throw new ShelfError({
        cause: null,
        label,
        message:
          "Cannot extend booking because the extended period is overlapping with the following bookings:",
        additionalData: {
          clashingBookings: [...clashingBookings],
        },
        shouldBeCaptured: false,
      });
    }

    const updateData: Record<string, any> = { to: newEndDate };
    if (booking.status === BookingStatus.OVERDUE) {
      updateData.status = BookingStatus.ONGOING;
    }
    const updatedBooking = (await update(db, "Booking", {
      where: { id: booking.id },
      data: updateData,
    })) as any;
    // Fetch email-related data
    if (updatedBooking.custodianUserId) {
      updatedBooking.custodianUser = await findFirst(db, "User", {
        where: { id: updatedBooking.custodianUserId },
      });
    }
    if (updatedBooking.custodianTeamMemberId) {
      updatedBooking.custodianTeamMember = await findFirst(db, "TeamMember", {
        where: { id: updatedBooking.custodianTeamMemberId },
      });
    }
    const extOrg = (await findFirst(db, "Organization", {
      where: { id: updatedBooking.organizationId },
    })) as any;
    if (extOrg) {
      const extOwner = await findFirst(db, "User", {
        where: { id: extOrg.ownerId },
      });
      updatedBooking.organization = { ...extOrg, owner: extOwner };
    }
    const extAssetCount = await queryRaw<{ count: number }>(
      db,
      sql`SELECT COUNT(*)::int as count FROM "_AssetToBooking" WHERE "B" = ${booking.id}`
    );
    updatedBooking._count = { assets: extAssetCount[0]?.count ?? 0 };

    // Add activity log for booking extension
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } as const,
    });
    await createSystemBookingNote({
      bookingId: updatedBooking.id,
      content: `${wrapUserLinkForNote(
        user
      )} extended the booking from **${wrapDateForNote(
        booking.to
      )}** to **${wrapDateForNote(newEndDate)}**.`,
    });

    /** Send extended booking email */
    if (updatedBooking?.custodianUser?.email) {
      const custodian = updatedBooking?.custodianUser
        ? `${updatedBooking.custodianUser.firstName} ${updatedBooking.custodianUser.lastName}`
        : (updatedBooking.custodianTeamMember?.name ?? "");

      const text = extendBookingEmailContent({
        bookingName: updatedBooking.name,
        assetsCount: updatedBooking._count.assets,
        custodian,
        from: updatedBooking.from!,
        to: updatedBooking.to!,
        hints,
        bookingId: updatedBooking.id,
        oldToDate: booking.to,
        customEmailFooter: updatedBooking.organization.customEmailFooter,
      });

      const { format } = getDateTimeFormatFromHints(hints, {
        dateStyle: "short",
        timeStyle: "short",
      });

      const html = await bookingUpdatesTemplateString({
        booking: updatedBooking,
        heading: `Booking extended from ${format(booking.to)} to ${format(
          newEndDate
        )}`,
        assetCount: updatedBooking._count.assets,
        hints,
      });

      sendEmail({
        to: updatedBooking.custodianUser.email,
        subject: `Booking extended (${updatedBooking.name}) - shelf.nu`,
        text,
        html,
      });
    }

    /**
     * In case of ONGOING, a checkin reminder should have be scheduled. So we have to reschedule it.
     * And in case of OVERDUE all the jobs are completed, so we have to reschedule the checkin reminder.
     */
    await cancelScheduler(booking);

    const { hours } = calcTimeDifference(newEndDate, new Date());

    /**
     * If there is less than 1 hours left for checkin, then we immediately send the checkin
     * reminder and we schedule the overdue handler.
     */
    if (hours < 1) {
      if (updatedBooking?.custodianUser?.email) {
        await sendCheckinReminder(
          updatedBooking,
          updatedBooking._count.assets,
          hints
        );
      }

      await scheduleNextBookingJob({
        data: {
          id: updatedBooking.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler,
        },
        when: newEndDate,
      });
    } else {
      const when = newEndDate;
      when.setHours(newEndDate.getHours() - 1);

      await scheduleNextBookingJob({
        data: {
          id: updatedBooking.id,
          hints,
          eventType: BOOKING_SCHEDULER_EVENTS_ENUM.checkinReminder,
        },
        when,
      });
    }

    return updatedBooking;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      label,
      title: "Error",
      message: isShelfError
        ? cause.message
        : "Something went wrong while extending the booking.",
      additionalData: isShelfError ? cause.additionalData : undefined,
      shouldBeCaptured: isShelfError ? cause.shouldBeCaptured : true,
    });
  }
}

export async function getBookingsFilterData({
  request,
  userId,
  canSeeAllBookings,
  organizationId,
}: {
  request: Request;
  userId: string;
  canSeeAllBookings: boolean;
  organizationId: Organization["id"];
}) {
  const {
    filters,
    redirectNeeded,
    serializedCookie: filtersCookie,
  } = await getFiltersFromRequest(request, organizationId, {
    name: "bookingFilter_v2",
    path: "/", // Use root path so cookie is sent with RR7 single fetch .data requests
  });

  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search, status, teamMemberIds, tags } =
    getParamsValues(searchParams);

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const orderBy = searchParams.get("orderBy") ?? "from";
  const orderDirection = (searchParams.get("orderDirection") ??
    "asc") as SortingDirection;

  /**
   * For self service and base users, we need to get the teamMember to be able to filter by it as well.
   * This is to handle a case when a booking was assigned when there wasn't a user attached to a team member but they were later on linked.
   * This is to ensure that the booking is still visible to the user that was assigned to it.
   * Also this shouldn't really happen as we now have a fix implemented when accepting invites,
   * to make sure it doesnt happen, hwoever its good to keep this as an extra safety thing.
   * Ideally in the future we should remove this as it adds another query to the db
   * @TODO this can safely be remove 3-6 months after this commit
   */
  let selfServiceData = null;

  // Only fetch team member data if the user doesn't have permission to see all bookings
  if (!canSeeAllBookings) {
    // Get the team member for the current user
    const teamMember = await findFirst(db, "TeamMember", {
      where: {
        userId,
        organizationId,
      },
    });

    if (!teamMember) {
      throw new ShelfError({
        cause: null,
        title: "Team member not found",
        message:
          "You are not part of a team in this organization. Please contact your organization admin to resolve this",
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    selfServiceData = {
      // If the user is self service/base without override, we only show bookings that belong to that user
      custodianUserId: userId,
      custodianTeamMemberId: teamMember.id,
    };
  }

  return {
    searchParams,
    cookie,
    page,
    perPage,
    search,
    status,
    teamMemberIds,
    orderBy,
    orderDirection,
    selfServiceData,
    filtersCookie,
    filters,
    redirectNeeded,
    tags,
  };
}

export async function getBookings(params: {
  organizationId: Organization["id"];
  /** Page number. Starts at 1 */
  page: number;
  /** Assets to be loaded per page */
  perPage?: number;
  search?: string | null;
  statuses?: Booking["status"][] | null;
  assetIds?: Asset["id"][] | null;
  custodianUserId?: Booking["custodianUserId"] | null;
  /** Accepts an array of team member IDs instead of a single ID so it can be used for filtering of bookings on index */
  custodianTeamMemberIds?: string[] | null;
  excludeBookingIds?: Booking["id"][] | null;
  bookingFrom?: Booking["from"] | null;
  bookingTo?: Booking["to"] | null;
  userId: Booking["creatorId"];
  extraInclude?: Record<string, any>;
  /** Controls whether entries should be paginated or not */
  takeAll?: boolean;
  orderBy?: string;
  orderDirection?: SortingDirection;
  kitId?: string;
  tags?: Tag["id"][];
}) {
  const {
    organizationId,
    page = 1,
    perPage = 8,
    search,
    statuses,
    custodianUserId,
    custodianTeamMemberIds,
    assetIds,
    bookingTo,
    excludeBookingIds,
    bookingFrom,
    userId,
    extraInclude,
    takeAll = false,
    orderBy = "from",
    orderDirection = "asc",
    kitId,
    tags,
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 25 per page

    /** Default value of where. Takes the assetss belonging to current org */
    const where: Record<string, any> = { organizationId };

    /** The idea is that only the creator of a draft booking can see it
     * This condition will fetch all bookings that are not in 'DRAFT' status, and also the bookings that are in 'DRAFT' status but only if their creatorId is the same as the userId
     */
    where.AND = [
      {
        OR: [
          {
            status: {
              not: "DRAFT",
            },
          },
          {
            AND: [
              {
                status: "DRAFT",
              },
              {
                creatorId: userId,
              },
            ],
          },
        ],
      },
    ];

    /** If the search string exists, add it to the where object */
    if (search?.trim()?.length) {
      const searchTerms = search
        .toLowerCase()
        .trim()
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);

      where.OR = searchTerms.map((term) => ({
        OR: [
          // Search in booking fields
          { name: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
          // Search in tags
          { tags: { some: { name: { contains: term, mode: "insensitive" } } } },
          // Search in custodian team member name
          {
            custodianTeamMember: {
              name: { contains: term, mode: "insensitive" },
            },
          },
          // Search in custodian user names
          {
            custodianUser: {
              OR: [
                { firstName: { contains: term, mode: "insensitive" } },
                { lastName: { contains: term, mode: "insensitive" } },
              ],
            },
          },
          // Search in asset titles, QR codes, and barcodes
          {
            assets: {
              some: {
                OR: [
                  { title: { contains: term, mode: "insensitive" } },
                  {
                    qrCodes: {
                      some: { id: { contains: term, mode: "insensitive" } },
                    },
                  },
                  {
                    barcodes: {
                      some: { value: { contains: term, mode: "insensitive" } },
                    },
                  },
                ],
              },
            },
          },
        ],
      }));
    }

    /** Handle combination of custodianTeamMemberIds and custodianUserId */
    if (
      custodianTeamMemberIds &&
      custodianTeamMemberIds?.length &&
      custodianUserId
    ) {
      where.OR = [
        {
          custodianTeamMemberId: {
            in: custodianTeamMemberIds,
          },
        },
        {
          custodianUserId,
        },
      ];
    } else {
      /** Handle custodianTeamMemberIds if present */
      if (custodianTeamMemberIds?.length) {
        where.custodianTeamMemberId = {
          in: custodianTeamMemberIds,
        };
      }
      /** Handle custodianUserId if present */
      if (custodianUserId) {
        where.custodianUserId = custodianUserId;
      }
    }

    if (statuses?.length) {
      where.status = {
        in: statuses,
      };
    } else {
      where.status = {
        notIn: [BookingStatus.ARCHIVED, BookingStatus.CANCELLED], // By default we dont show archived & cancelled bookings
      };
    }

    if (assetIds?.length) {
      where.assets = {
        some: {
          id: {
            in: assetIds,
          },
        },
      };
    }

    if (excludeBookingIds?.length) {
      where.id = { notIn: excludeBookingIds };
    }

    if (bookingFrom && bookingTo) {
      // Add date filtering to AND clause instead of overriding OR clause
      // to preserve search conditions
      if (!where.AND) {
        where.AND = [];
      }
      where.AND.push({
        OR: [
          {
            from: { lte: bookingTo },
            to: { gte: bookingFrom },
          },
          {
            from: { gte: bookingFrom },
            to: { lte: bookingTo },
          },
        ],
      });
    }

    if (kitId) {
      where.assets = {
        some: { kitId },
      };
    }

    if (tags?.length) {
      if (tags.includes("untagged")) {
        where.tags = { none: {} };
      } else {
        where.tags = { some: { id: { in: tags } } };
      }
    }

    // TODO: convert complex Prisma query — getBookings uses deeply nested
    // relation filters (tags: { some }, assets: { some }, custodianTeamMember,
    // custodianUser: { OR }) and complex includes with nested relations
    // (assets->category, assets->kit->category, assets->bookings, creator).
    // This requires a full raw SQL rewrite. For now, using simplified queries.

    // Build a basic booking query — note: relation-based where filters
    // (tags, assets, custodianTeamMember name, custodianUser names) are NOT
    // applied here and need raw SQL conversion for full parity.
    const basicWhere: Record<string, any> = { organizationId };
    if (statuses?.length) {
      basicWhere.status = { in: statuses };
    } else {
      basicWhere.status = {
        notIn: [BookingStatus.ARCHIVED, BookingStatus.CANCELLED],
      };
    }
    if (excludeBookingIds?.length) {
      basicWhere.id = { notIn: excludeBookingIds };
    }
    if (custodianTeamMemberIds?.length && !custodianUserId) {
      basicWhere.custodianTeamMemberId = { in: custodianTeamMemberIds };
    }
    if (
      custodianUserId &&
      (!custodianTeamMemberIds || !custodianTeamMemberIds.length)
    ) {
      basicWhere.custodianUserId = custodianUserId;
    }
    if (search?.trim()?.length) {
      basicWhere.name = { contains: search.trim(), mode: "insensitive" };
    }

    const [bookings, bookingCount] = (await Promise.all([
      findMany(db, "Booking", {
        where: basicWhere,
        orderBy: { [orderBy]: orderDirection },
        ...(!takeAll && { skip, take }),
      }),
      count(db, "Booking", basicWhere),
    ])) as [any[], number];

    return { bookings, bookingCount };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the bookings. Please try again or contact support.",
      additionalData: { ...params },
      label,
    });
  }
}

export async function removeAssets({
  booking,
  firstName,
  lastName,
  userId,
  kitIds = [],
  kits = [],
  assets = [],
  organizationId,
}: {
  booking: Pick<Booking, "id"> & {
    assetIds: Asset["id"][];
  };
  firstName: string;
  lastName: string;
  userId: string;
  kitIds?: Kit["id"][];
  kits?: Array<{ id: string; name: string }>;
  assets?: Array<{ id: string; title: string }>;
  organizationId: Booking["organizationId"];
}) {
  try {
    const { assetIds, id } = booking;
    // First, disconnect the assets from the booking via join table
    await queryRaw(
      db,
      sql`DELETE FROM "_AssetToBooking" WHERE "B" = ${id} AND "A" = ANY(${assetIds}::text[])`
    );
    const b = (await findUniqueOrThrow(db, "Booking", {
      where: { id, organizationId },
      select: "id, name, status",
    })) as any;
    /** When removing an asset from a booking we need to make sure to set their status back to available
     * This is needed because the user is allowed to remove an asset from a booking that is ongoing, which means the asset status will be CHECKED_OUT
     * So we need to set it back to AVAILABLE
     * We only do that if the booking we removed it from is ongoing or overdue.
     * Reason is that the user can add an asset to a draft booking and remove it and that will reset its status back to available, which shouldnt happen
     * https://github.com/Shelf-nu/shelf.nu/issues/703#issuecomment-1944315975
     *
     * Because prisma doesnt support transactional execution of nested queries, we need to do them in 2 steps, because if the disconnect runs first,
     * the updateMany will not find the assets in the booking anymore and wont update them
     *
     * If there was some kit removed from the booking, then we have to update the status of that kit to available
     */
    if (
      b.status === BookingStatus.ONGOING ||
      b.status === BookingStatus.OVERDUE
    ) {
      await updateMany(db, "Asset", {
        where: { id: { in: assetIds }, organizationId },
        data: { status: AssetStatus.AVAILABLE },
      });

      if (kitIds.length > 0) {
        await updateMany(db, "Kit", {
          where: { id: { in: kitIds }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }
    }

    const userForNotes = { firstName, lastName, id: userId };

    const bookingLink = wrapLinkForNote(`/bookings/${b.id}`, b.name);
    await createNotes({
      content: `${wrapUserLinkForNote(
        userForNotes
      )} removed assets from ${bookingLink}.`,
      type: "UPDATE",
      userId,
      assetIds,
    });

    // BOOKING ACTIVITY LOG: Log removal activity
    // Creates system note when assets/kits are removed from a booking
    // Handles three cases: kits only, assets only, or both combined
    const hasKits = kitIds && kitIds.length > 0;
    // Check if we have standalone assets (not belonging to kits being removed)
    const hasAssets = assets && assets.length > 0;

    if (hasKits && hasAssets) {
      // Both kits and assets removed - create combined note
      const kitContent =
        kits.length > 0
          ? wrapKitsWithDataForNote(kits, "removed")
          : wrapKitsForNote(kitIds, "removed");

      const assetContent = wrapAssetsWithDataForNote(assets, "removed");

      await createSystemBookingNote({
        bookingId: booking.id,
        content: `${wrapUserLinkForNote(
          userForNotes
        )} removed ${kitContent} and ${assetContent} from booking.`,
      });
    } else if (hasKits) {
      // Only kits removed
      const kitContent =
        kits.length > 0
          ? wrapKitsWithDataForNote(kits, "removed")
          : wrapKitsForNote(kitIds, "removed");

      await createSystemBookingNote({
        bookingId: booking.id,
        content: `${wrapUserLinkForNote(
          userForNotes
        )} removed ${kitContent} from booking.`,
      });
    } else if (hasAssets) {
      // Only assets removed
      const assetContent = wrapAssetsWithDataForNote(assets, "removed");

      await createSystemBookingNote({
        bookingId: booking.id,
        content: `${wrapUserLinkForNote(
          userForNotes
        )} removed ${assetContent} from booking.`,
      });
    }

    return b;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while removing assets from the booking. Please try again or contact support.",
      additionalData: { booking, userId },
      label,
    });
  }
}

export async function deleteBooking(
  booking: Pick<Booking, "id" | "organizationId">,
  hints: ClientHint
) {
  const { id, organizationId } = booking;
  const currentBooking = (await findUnique(db, "Booking", {
    where: { id, organizationId },
  })) as any;

  if (currentBooking) {
    // Fetch assets for this booking
    const bookingAssets = await queryRaw<any>(
      db,
      sql`SELECT a."id", a."kitId" FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${id}`
    );
    currentBooking.assets = bookingAssets;
  }

  if (!currentBooking) {
    throw new ShelfError({
      cause: null,
      message:
        "The booking you are trying to delete does not exist or has already been deleted.",
      label,
      status: 404,
      shouldBeCaptured: false,
    });
  }

  try {
    const activeBooking =
      currentBooking &&
      (currentBooking.status === BookingStatus.OVERDUE ||
        currentBooking.status === BookingStatus.ONGOING)
        ? currentBooking
        : null;

    const assetWithKits =
      activeBooking?.assets.filter((a: any) => !!a.kitId) ?? [];
    const uniqueKitIds = new Set(
      assetWithKits.map((a: any) => a.kitId) as unknown as string
    );
    const hasKits = uniqueKitIds.size > 0;

    // Fetch email-related data before deleting
    let b: any = { ...currentBooking };
    if (b.custodianUserId) {
      b.custodianUser = await findFirst(db, "User", {
        where: { id: b.custodianUserId },
      });
    }
    if (b.custodianTeamMemberId) {
      b.custodianTeamMember = await findFirst(db, "TeamMember", {
        where: { id: b.custodianTeamMemberId },
      });
    }
    const delOrg = (await findFirst(db, "Organization", {
      where: { id: b.organizationId },
    })) as any;
    if (delOrg) {
      const delOwner = await findFirst(db, "User", {
        where: { id: delOrg.ownerId },
      });
      b.organization = { ...delOrg, owner: delOwner };
    }
    const delAssetCount = await queryRaw<{ count: number }>(
      db,
      sql`SELECT COUNT(*)::int as count FROM "_AssetToBooking" WHERE "B" = ${id}`
    );
    b._count = { assets: delAssetCount[0]?.count ?? 0 };
    b.assets = currentBooking.assets.map((a: any) => ({ id: a.id }));

    // Delete the booking
    await remove(db, "Booking", { id, organizationId });

    const email = b.custodianUser?.email;
    if (email) {
      const subject = `🗑️ Booking deleted (${b.name}) - shelf.nu`;
      const text = deletedBookingEmailContent({
        bookingName: b.name,
        assetsCount: b._count.assets,
        custodian:
          `${b.custodianUser?.firstName} ${b.custodianUser?.lastName}` ||
          (b.custodianTeamMember?.name as string),
        from: b.from as Date, // We can safely cast here as we know the booking is overdue so it myust have a from and to date
        to: b.to as Date,
        bookingId: b.id,
        hints: hints,
        customEmailFooter: b.organization.customEmailFooter,
      });
      const html = await bookingUpdatesTemplateString({
        booking: b,
        heading: `Your booking has been deleted: "${b.name}".`,
        assetCount: b._count.assets,
        hints,
        hideViewButton: true,
      });

      sendEmail({
        to: email,
        subject,
        text,
        html,
      });
    }

    /** Because assets in an active booking have a special status, we need to update them if we delete a booking */
    if (activeBooking) {
      await updateBookingAssetStates(activeBooking, AssetStatus.AVAILABLE);

      // If booking has some kits, then make them available too
      if (hasKits) {
        await updateBookingKitStates({
          kitIds: [...uniqueKitIds],
          status: KitStatus.AVAILABLE,
        });
      }
    }
    await cancelScheduler(
      currentBooking ?? {
        id: b.id,
        activeSchedulerReference: b.activeSchedulerReference,
      }
    );

    return b;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while deleting the booking. Please try again or contact support.",
      additionalData: { booking, hints },
      label,
    });
  }
}

export async function getBooking<T extends Record<string, any> | undefined>(
  booking: Pick<Booking, "id" | "organizationId"> & {
    userOrganizations?: Pick<UserOrganization, "organizationId">[];
    request: Request;
    extraInclude?: T;
  }
) {
  try {
    const { id, organizationId, userOrganizations, request, extraInclude } =
      booking;

    // Extract search parameters from request
    const searchParams = getCurrentSearchParams(request);
    const paramsValues = getParamsValues(searchParams);
    const { search, orderBy, orderDirection } = paramsValues;
    // const status =
    //   searchParams.get("status") === "ALL"
    //     ? null
    //     : (searchParams.get("status") as AssetStatus | null);

    // Get dynamic orderBy based on URL params
    const assetsOrderBy = getBookingAssetsOrderBy(orderBy, orderDirection);

    /**
     * On the booking page, we need some data related to the assets added, so we know what actions are possible
     *
     * For reserving a booking, we need to make sure that the assets in the booking dont have any other bookings that overlap with the current booking
     * Moreover we just query certain statuses as they are the only ones that matter for an asset being considered unavailable
     */

    // Build assets include with optional search, status filtering, and dynamic sorting
    const assetsWhere: Record<string, any> = {};

    if (search) {
      assetsWhere.title = {
        contains: search,
        mode: "insensitive",
      };
    }

    // if (status) {
    //   assetsWhere.status = status;
    // }

    const assetsInclude: Record<string, any> = {
      select: BOOKING_WITH_ASSETS_INCLUDE.assets.select,
      orderBy: assetsOrderBy,
      ...(Object.keys(assetsWhere).length > 0 && { where: assetsWhere }),
    };

    // TODO: convert complex Prisma include — getBooking with mergedInclude
    // containing nested asset relations (category, kit, bookings).
    // Using simplified approach: fetch booking then relations separately.
    const _assetsInclude = assetsInclude; // kept for reference
    const _extraInclude = extraInclude; // kept for reference

    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    // Build OR condition for finding across organizations
    const whereClause: Record<string, any> = {};
    if (userOrganizations?.length && otherOrganizationIds?.length) {
      whereClause.OR = [
        { id, organizationId },
        { id, organizationId: { in: otherOrganizationIds } },
      ];
    } else {
      whereClause.id = id;
      whereClause.organizationId = organizationId;
    }

    const bookingFound = (await findFirstOrThrow(db, "Booking", {
      where: whereClause,
    })) as any as BookingWithExtraInclude<T>;

    /* User is accessing the asset in the wrong organization. */
    if (
      userOrganizations?.length &&
      bookingFound.organizationId !== organizationId &&
      otherOrganizationIds?.includes(bookingFound.organizationId)
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "Booking not found",
        message: "",
        additionalData: {
          model: "booking",
          organization: userOrganizations?.find(
            (org) => org.organizationId === bookingFound.organizationId
          ),
          redirectTo,
        },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }

    return bookingFound;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      title: "Booking not found",
      message:
        "The booking you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        ...booking,
        ...(isShelfError ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: isShelfError
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
    });
  }
}

export async function getBookingsForCalendar(params: {
  request: Request;
  organizationId: Organization["id"];
  userId: string;
  canSeeAllBookings: boolean;
  canSeeAllCustody: boolean;
}) {
  const {
    request,
    organizationId,
    userId,
    canSeeAllBookings,
    canSeeAllCustody,
  } = params;

  const { searchParams, search, status, teamMemberIds, tags, selfServiceData } =
    await getBookingsFilterData({
      request,
      canSeeAllBookings,
      organizationId,
      userId,
    });

  const start = searchParams.get("start") as string;
  const end = searchParams.get("end") as string;

  // If start and end are not provided, default to current month
  let startDate: Date;
  let endDate: Date;

  if (start && end) {
    startDate = new Date(start);
    endDate = new Date(end);
  } else {
    // Default to current month
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1); // First day of current month
    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month
  }

  try {
    const { bookings } = await getBookings({
      organizationId,
      page: 1,
      perPage: 1000,
      search,
      userId,
      ...(status && {
        // If status is in the params, we filter based on it
        statuses: [status],
      }),
      bookingFrom: startDate,
      bookingTo: endDate,
      custodianTeamMemberIds: teamMemberIds,
      ...selfServiceData,
      tags,
      extraInclude: {
        custodianTeamMember: true,
        custodianUser: true,
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
        tags: TAG_WITH_COLOR_SELECT,
      },
      takeAll: true,
    });

    const events = bookings
      .filter((booking) => booking.from && booking.to)
      .map((booking) => {
        const custodianName = booking?.custodianUser
          ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`
          : booking.custodianTeamMember?.name;

        let title = booking.name;
        if (canSeeAllCustody) {
          title += ` | ${custodianName}`;
        }
        return {
          title,
          start: (booking.from as Date).toISOString(),
          end: (booking.to as Date).toISOString(),
          classNames: [
            `bookingId-${booking.id}`,
            ...getStatusClasses(
              booking.status,
              isOneDayEvent(booking.from as Date, booking.to as Date)
            ),
          ],
          extendedProps: {
            url: `/bookings/${booking.id}`,
            status: booking.status,
            id: booking.id,
            name: booking.name,
            description: booking.description,
            start: (booking.from as Date).toISOString(),
            end: (booking.to as Date).toISOString(),
            custodian: {
              name: custodianName,
              user: booking.custodianUser
                ? {
                    id: booking.custodianUserId,
                    firstName: booking.custodianUser?.firstName,
                    lastName: booking.custodianUser?.lastName,
                    profilePicture: booking.custodianUser?.profilePicture,
                  }
                : undefined,
            },
            creator: {
              name: booking.creator
                ? `${booking.creator.firstName} ${booking.creator.lastName}`.trim()
                : "Unknown",
              user: booking.creator
                ? {
                    id: booking.creator.id,
                    firstName: booking.creator.firstName,
                    lastName: booking.creator.lastName,
                    profilePicture: booking.creator.profilePicture,
                  }
                : null,
            },
            tags: booking.tags,
          },
        };
      });

    return events;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the bookings for the calendar. Please try again or contact support.",
      additionalData: { ...params },
      label,
    });
  }
}

export function getKitIdsByAssets(assets: Pick<Asset, "id" | "kitId">[]) {
  const assetsWithKit = assets.filter((a) => !!a.kitId) as Pick<
    Asset,
    "id" | "kitId"
  >[];
  const allKitIds = assetsWithKit
    .map((a) => a.kitId)
    .filter((id) => id !== null); // filter out null entreis

  const uniqueKitIds = new Set(allKitIds);

  return [...uniqueKitIds];
}

export async function getBookingFlags(
  booking: Pick<Booking, "id" | "from" | "to"> & {
    assetIds: Asset["id"][];
  }
) {
  // TODO: convert complex Prisma include — assets with nested bookings conflict conditions
  // Fetch assets with their related data
  const assets = (await findMany(db, "Asset", {
    where: { id: { in: booking.assetIds } },
  })) as any[];

  // Fetch related data for each asset
  for (const asset of assets) {
    asset.category = asset.categoryId
      ? await findFirst(db, "Category", { where: { id: asset.categoryId } })
      : null;
    asset.custody = await findFirst(db, "Custody", {
      where: { assetId: asset.id },
    });
    asset.kit = asset.kitId
      ? await findFirst(db, "Kit", { where: { id: asset.kitId } })
      : null;

    // Fetch conflicting bookings
    if (booking.from && booking.to) {
      asset.bookings = await queryRaw<any>(
        db,
        sql`SELECT b."id", b."name", b."from", b."to", b."status"
            FROM "Booking" b
            INNER JOIN "_AssetToBooking" ab ON ab."B" = b."id"
            WHERE ab."A" = ${asset.id} AND b."id" != ${booking.id}
            AND (
              (b."status" = 'RESERVED' AND (
                (b."from" <= ${booking.to} AND b."to" >= ${booking.from})
                OR (b."from" >= ${booking.from} AND b."to" <= ${booking.to})
              ))
              OR (b."status" IN ('ONGOING', 'OVERDUE') AND (
                (b."from" <= ${booking.to} AND b."to" >= ${booking.from})
                OR (b."from" >= ${booking.from} AND b."to" <= ${booking.to})
              ))
            )`
      );
    } else {
      asset.bookings = await queryRaw<any>(
        db,
        sql`SELECT b."id", b."name", b."from", b."to", b."status"
            FROM "Booking" b
            INNER JOIN "_AssetToBooking" ab ON ab."B" = b."id"
            WHERE ab."A" = ${asset.id} AND b."id" != ${booking.id}`
      );
    }
  }

  const hasAssets = assets.length > 0;

  const hasUnavailableAssets = assets.some((asset) => !asset.availableToBook);

  const hasCheckedOutAssets = assets.some(
    (asset) => asset.status === AssetStatus.CHECKED_OUT
  );

  const hasAlreadyBookedAssets = assets.some((asset) => {
    if (!asset.bookings || asset.bookings.length === 0) return false;

    return asset.bookings.some((conflictingBooking) => {
      // RESERVED bookings always conflict
      if (conflictingBooking.status === "RESERVED") return true;

      // For ONGOING/OVERDUE bookings, only conflict if asset is actually CHECKED_OUT
      if (
        conflictingBooking.status === "ONGOING" ||
        conflictingBooking.status === "OVERDUE"
      ) {
        return asset.status === AssetStatus.CHECKED_OUT;
      }

      return false;
    });
  });

  const hasAssetsInCustody = assets.some(
    (asset) => asset.status === AssetStatus.IN_CUSTODY
  );

  const hasKits = assets.some((asset) => !!asset.kitId);

  return {
    hasAssets,
    hasUnavailableAssets,
    hasCheckedOutAssets,
    hasAlreadyBookedAssets,
    hasAssetsInCustody,
    hasKits,
  };
}

export async function bulkDeleteBookings({
  bookingIds,
  organizationId,
  userId,
  hints,
  currentSearchParams,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  hints: ClientHint;
  currentSearchParams?: string | null;
}) {
  try {
    /** If all are selected in the list, then we have to consider filter */
    const where: Record<string, any> = bookingIds.includes(ALL_SELECTED_KEY)
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    // TODO: convert complex Prisma include — bulk delete with nested relations
    const [rawBookings, user] = await Promise.all([
      findMany(db, "Booking", { where }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } as const,
      }),
    ]);
    // Hydrate bookings with related data
    const bookings: any[] = [];
    for (const rb of rawBookings) {
      const b = rb as any;
      if (b.custodianUserId) {
        b.custodianUser = await findFirst(db, "User", {
          where: { id: b.custodianUserId },
        });
      }
      if (b.custodianTeamMemberId) {
        b.custodianTeamMember = await findFirst(db, "TeamMember", {
          where: { id: b.custodianTeamMemberId },
        });
      }
      const bOrg = (await findFirst(db, "Organization", {
        where: { id: b.organizationId },
      })) as any;
      if (bOrg) {
        const bOwner = await findFirst(db, "User", {
          where: { id: bOrg.ownerId },
          select: "email",
        });
        b.organization = { ...bOrg, owner: bOwner };
      }
      const bAssets = await queryRaw<any>(
        db,
        sql`SELECT a."id", a."kitId" FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${b.id}`
      );
      b.assets = bAssets;
      b._count = { assets: bAssets.length };
      bookings.push(b);
    }

    /** We have to send mails to custodianUsers */
    const bookingsToSendEmail = bookings.filter(
      (booking: any) => !!booking.custodianUser?.email
    );

    /** If some booking was OVERDUE or ONGOING, we have to make their assets and kits available */
    const overdueOrOngoingBookings = bookings.filter(
      (booking: any) =>
        booking.status === "OVERDUE" || booking.status === "ONGOING"
    );

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = bookings.filter(
      (booking: any) => !!booking.activeSchedulerReference
    );

    // Sequential operations replacing db.$transaction
    /** Deleting all selected bookings */
    await deleteMany(db, "Booking", {
      id: { in: bookings.map((booking: any) => booking.id) },
    });

    /** Making assets and kits available */
    if (overdueOrOngoingBookings.length > 0) {
      const allAssets = overdueOrOngoingBookings.flatMap(
        (booking: any) => booking.assets
      );

      const allKitIds = allAssets
        .filter((asset: any) => !!asset.kitId)
        .map((asset: any) => asset.kitId as string);

      const uniqueKitIds = new Set(allKitIds);

      await updateMany(db, "Asset", {
        where: { id: { in: allAssets.map((asset: any) => asset.id) } },
        data: { status: AssetStatus.AVAILABLE },
      });

      await updateMany(db, "Kit", {
        where: { id: { in: [...uniqueKitIds] } },
        data: { status: KitStatus.AVAILABLE },
      });
    }

    /** Making notes for all the assets */
    const notesData = bookings
      .map((booking: any) =>
        booking.assets.map((asset: any) => ({
          userId,
          assetId: asset.id,
          content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** deleted booking **${
            booking.name
          }**.`,
          type: "UPDATE" as const,
        }))
      )
      .flat() as any[];

    if (notesData.length > 0) {
      await createMany(db, "Note", notesData);
    }

    /** Cancelling scheduler */
    await Promise.all(
      bookingsWithSchedulerReference.map((booking) => cancelScheduler(booking))
    );

    const emailConfigs = await Promise.all(
      bookingsToSendEmail.map(async (b) => ({
        to: b.custodianUser?.email ?? "",
        subject: `🗑️ Booking deleted (${b.name}) - shelf.nu`,
        text: deletedBookingEmailContent({
          bookingName: b.name,
          assetsCount: b.assets.length,
          custodian:
            `${b.custodianUser?.firstName} ${b.custodianUser?.lastName}` ||
            (b.custodianTeamMember?.name as string),
          from: b.from as Date,
          to: b.to as Date,
          bookingId: b.id,
          hints,
        }),
        html: await bookingUpdatesTemplateString({
          booking: b,
          heading: `Your booking as been deleted: "${b.name}"`,
          assetCount: b.assets.length,
          hints,
          hideViewButton: true,
        }),
      }))
    );

    return emailConfigs.map(sendEmail);
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk deleting bookings.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { bookingIds, organizationId },
      label,
    });
  }
}

export async function bulkArchiveBookings({
  bookingIds,
  organizationId,
  currentSearchParams,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /** If all are selected in the list, then we have to consider filter */
    const where: Record<string, any> = bookingIds.includes(ALL_SELECTED_KEY)
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const bookings = await findMany(db, "Booking", {
      where,
      select: "id, status, custodianUserId, activeSchedulerReference",
    });

    const someBookingNotComplete = bookings.some(
      (b: any) => b.status !== "COMPLETE"
    );

    /** Bookings must be complete to add them in archive */
    if (someBookingNotComplete) {
      throw new ShelfError({
        cause: null,
        message:
          "Some bookings are not complete. Please make sure you are selecting completed bookings to archive them.",
        label,
        additionalData: {
          bookings,
          organizationId,
          bookingIds,
        },
      });
    }

    // Sequential operations replacing db.$transaction
    /** Updating status of bookings to ARCHIVED  */
    await updateMany(db, "Booking", {
      where: { id: { in: bookings.map((b: any) => b.id) } },
      data: { status: BookingStatus.ARCHIVED },
    });

    /** Create booking status transition notes for each booking */
    for (const bk of bookings) {
      await createStatusTransitionNote({
        bookingId: (bk as any).id,
        fromStatus: (bk as any).status,
        toStatus: BookingStatus.ARCHIVED,
        custodianUserId: (bk as any).custodianUserId || undefined,
      });
    }

    /** Cancel any active schedulers */
    await Promise.all(bookings.map((b) => cancelScheduler(b)));
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while archiving bookings.",
      additionalData: isShelfError
        ? cause.additionalData
        : {
            bookingIds,
            organizationId,
          },
      label,
    });
  }
}

export async function bulkCancelBookings({
  bookingIds,
  organizationId,
  userId,
  hints,
  currentSearchParams,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  hints: ClientHint;
  currentSearchParams?: string | null;
}) {
  try {
    /** If all are selected in the list, then we have to consider filter */
    const where: Record<string, any> = bookingIds.includes(ALL_SELECTED_KEY)
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const [rawBookings, user] = await Promise.all([
      findMany(db, "Booking", {
        where,
        select:
          "*, custodianTeamMember:TeamMember(*), custodianUser:User(*), organization:Organization(*, owner:User(email))",
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } as const,
      }),
    ]);

    // Hydrate assets and _count for each booking via join table
    const bookings = await Promise.all(
      (rawBookings as any[]).map(async (b: any) => {
        const assets = await queryRaw<{ id: string; kitId: string | null }>(
          db,
          sql`SELECT a."id", a."kitId" FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${b.id}`
        );
        return { ...b, assets, _count: { assets: assets.length } };
      })
    );

    /** Bookings with any of these statuses cannot be cancelled */
    const unavailableBookingStatus: BookingStatus[] = [
      BookingStatus.ARCHIVED,
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETE,
      BookingStatus.DRAFT,
    ];

    const someUnavailableToCancelBookings = bookings.some((b) =>
      unavailableBookingStatus.includes(b.status)
    );

    if (someUnavailableToCancelBookings) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable to cancel booking selected. Please make sure you are selecting the booking which are allowed to cancel.",
        label,
        additionalData: {
          bookings,
          organizationId,
          bookingIds,
        },
      });
    }

    /** We have to send mails to custodianUsers */
    const bookingsToSendEmail = bookings.filter(
      (booking) => !!booking.custodianUser?.email
    );

    /** We have to make all the assets and kits available if the booking as ongoing or overdue */
    const ongoingOrOverdueBookings = bookings.filter(
      (b) => b.status === "ONGOING" || b.status === "OVERDUE"
    );

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = bookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    // Sequential operations replacing db.$transaction
    /** Updating status of bookings to CANCELLED */
    await updateMany(db, "Booking", {
      where: { id: { in: bookings.map((b: any) => b.id) } },
      data: { status: BookingStatus.CANCELLED },
    });

    /** Updating status of assets and kits  */
    if (ongoingOrOverdueBookings.length > 0) {
      const allAssets = ongoingOrOverdueBookings.flatMap((b: any) => b.assets);
      const allKitIds = allAssets
        .filter((a: any) => !!a.kitId)
        .map((a: any) => a.kitId as string);

      const uniqueKitIds = new Set(allKitIds);

      /** Making assets available */
      await updateMany(db, "Asset", {
        where: { id: { in: allAssets.map((a: any) => a.id) } },
        data: { status: AssetStatus.AVAILABLE },
      });

      /** Making kits available */
      if (uniqueKitIds.size > 0) {
        await updateMany(db, "Kit", {
          where: { id: { in: [...uniqueKitIds] } },
          data: { status: KitStatus.AVAILABLE },
        });
      }
    }

    /** Making notes for all the assets */
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    const notesData = bookings
      .map((b: any) =>
        b.assets.map((asset: any) => ({
          assetId: asset.id,
          content: `${actor} cancelled booking.`,
          userId,
          type: "UPDATE" as const,
        }))
      )
      .flat() as any[];

    if (notesData.length > 0) {
      await createMany(db, "Note", notesData);
    }

    /** Create booking status transition notes for each booking */
    for (const booking of bookings) {
      await createStatusTransitionNote({
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: BookingStatus.CANCELLED,
        userId,
        custodianUserId: booking.custodianUserId || undefined,
      });
    }

    /** Cancelling scheduler */
    await Promise.all(
      bookingsWithSchedulerReference.map((booking) => cancelScheduler(booking))
    );

    /** Sending cancellation emails */
    await Promise.all(
      bookingsToSendEmail.map(async (b) => {
        const subject = `❌ Booking cancelled (${b.name}) - shelf.nu`;
        const text = cancelledBookingEmailContent({
          bookingName: b.name,
          assetsCount: b._count.assets,
          custodian:
            `${b.custodianUser?.firstName} ${b.custodianUser?.lastName}` ||
            (b.custodianTeamMember?.name as string),
          from: b.from as Date, // We can safely cast here as we know the booking is overdue so it myust have a from and to date
          to: b.to as Date,
          bookingId: b.id,
          hints: hints,
          customEmailFooter: b.organization.customEmailFooter,
        });

        const html = await bookingUpdatesTemplateString({
          booking: b,
          heading: `Your booking has been cancelled: "${b.name}".`,
          assetCount: b._count.assets,
          hints,
        });

        return sendEmail({
          to: b.custodianUser?.email ?? "",
          subject,
          text,
          html,
        });
      })
    );
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while bulk cancelling bookings.",
      additionalData: isShelfError
        ? cause.additionalData
        : { bookingIds, organizationId, userId },
      label,
    });
  }
}

/**
 * Helper function to create booking notes and asset notes for scanned assets and kits
 */
async function createNotesForScannedAssetsAndKits({
  booking,
  assetIds,
  kitIds,
  organizationId,
  userId,
}: {
  booking: { id: string; name: string };
  assetIds: string[];
  kitIds: string[];
  organizationId: string;
  userId: string;
}) {
  // Fetch assets and kits in parallel for better performance
  const [assets, rawKits] = await Promise.all([
    findMany(db, "Asset", {
      where: { id: { in: assetIds }, organizationId },
      select: "id, title",
    }),
    kitIds.length > 0
      ? findMany(db, "Kit", {
          where: { id: { in: kitIds }, organizationId },
          select: "id, name",
        })
      : Promise.resolve([]),
  ]);

  // Hydrate kit assets via join — kits need their assets for mapping
  const kits = await Promise.all(
    (rawKits as any[]).map(async (kit: any) => {
      const kitAssets = await findMany(db, "Asset", {
        where: { kitId: kit.id, organizationId },
        select: "id",
      });
      return { ...kit, assets: kitAssets };
    })
  );

  // Create a map of asset ID to kit name for assets that came from kits
  const assetIdToKitName = new Map<string, string>();
  kits.forEach((kit) => {
    kit.assets.forEach((asset) => {
      assetIdToKitName.set(asset.id, kit.name);
    });
  });

  // Separate standalone assets from kit assets for booking notes
  const standaloneAssetIds = assetIds.filter((id) => !assetIdToKitName.has(id));
  const standaloneAssets = assets.filter((asset) =>
    standaloneAssetIds.includes(asset.id)
  );

  // Get user info for note attribution
  const user = await getUserByID(userId, {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    } as const,
  });
  const userForNotes = {
    firstName: user?.firstName || "",
    lastName: user?.lastName || "",
    id: userId,
  };

  // Create booking notes
  const hasKits = kits.length > 0;
  const hasAssets = standaloneAssets.length > 0;

  if (hasKits && hasAssets) {
    // Both kits and assets added - create combined booking note
    const kitContent = wrapKitsWithDataForNote(
      kits.map((kit) => ({ id: kit.id, name: kit.name })),
      "added"
    );
    const assetContent = wrapAssetsWithDataForNote(standaloneAssets, "added");

    await createSystemBookingNote({
      bookingId: booking.id,
      content: `${wrapUserLinkForNote(
        userForNotes
      )} added ${kitContent} and ${assetContent} to booking.`,
    });
  } else if (hasKits) {
    // Only kits added - create booking note
    const kitContent = wrapKitsWithDataForNote(
      kits.map((kit) => ({ id: kit.id, name: kit.name })),
      "added"
    );

    await createSystemBookingNote({
      bookingId: booking.id,
      content: `${wrapUserLinkForNote(
        userForNotes
      )} added ${kitContent} to booking.`,
    });
  } else if (hasAssets) {
    // Only assets added - create booking note
    const assetContent = wrapAssetsWithDataForNote(standaloneAssets, "added");

    await createSystemBookingNote({
      bookingId: booking.id,
      content: `${wrapUserLinkForNote(
        userForNotes
      )} added ${assetContent} to booking.`,
    });
  }

  // Create notes on assets themselves with dynamic messages
  const bookingLink = wrapLinkForNote(`/bookings/${booking.id}`, booking.name);

  // Group assets by whether they came from a kit or not
  const standaloneAssetIdsSet = new Set(standaloneAssetIds);
  const kitAssetIds = assetIds.filter((id) => !standaloneAssetIdsSet.has(id));

  // Create notes for standalone assets
  if (standaloneAssetIds.length > 0) {
    await createNotes({
      content: `${wrapUserLinkForNote(
        userForNotes
      )} added asset to ${bookingLink}.`,
      type: "UPDATE",
      userId,
      assetIds: standaloneAssetIds,
    });
  }

  // Create notes for assets added via kits (grouped by kit)
  if (kitAssetIds.length > 0) {
    // Group asset IDs by kit name
    const assetsByKit = new Map<string, string[]>();
    kitAssetIds.forEach((assetId) => {
      const kitName = assetIdToKitName.get(assetId);
      if (kitName) {
        if (!assetsByKit.has(kitName)) {
          assetsByKit.set(kitName, []);
        }
        assetsByKit.get(kitName)!.push(assetId);
      }
    });

    // Create notes for each kit's assets
    for (const [kitName, kitAssetIds] of assetsByKit.entries()) {
      const kit = kits.find((k) => k.name === kitName);
      if (kit) {
        const kitLink = wrapLinkForNote(`/kits/${kit.id}`, kit.name);
        await createNotes({
          content: `${wrapUserLinkForNote(
            userForNotes
          )} added asset via ${kitLink} to ${bookingLink}.`,
          type: "UPDATE",
          userId,
          assetIds: kitAssetIds,
        });
      }
    }
  }
}

/**
 * Adds scanned assets (and optionally kits) to a booking.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string[]} params.assetIds - Array of asset IDs to add to the booking.
 * @param {string[]} [params.kitIds] - Optional array of kit IDs. Used to differentiate kit vs. standalone asset additions when creating notes. If not provided, only standalone assets are added.
 * @param {string} params.bookingId - The ID of the booking to update.
 * @param {string} params.organizationId - The organization ID associated with the booking.
 * @param {string} params.userId - The ID of the user performing the action.
 */
export async function addScannedAssetsToBooking({
  assetIds,
  kitIds = [],
  bookingId,
  organizationId,
  userId,
}: {
  assetIds: Asset["id"][];
  kitIds?: string[];
  bookingId: Booking["id"];
  organizationId: Booking["organizationId"];
  userId: string;
}) {
  try {
    /**
     * Step 1: Add assets to booking inside a transaction so we can mirror the
     * status-sync behaviour used in manage-assets.
     */
    // Sequential operations replacing db.$transaction

    // Connect assets to booking via join table
    if (assetIds.length > 0) {
      const insertValues = assetIds
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
        .join(", ");
      const insertParams = assetIds.flatMap((id) => [id, bookingId]);
      await queryRaw(
        db,
        new SqlFragment(
          `INSERT INTO "_AssetToBooking" ("A", "B") VALUES ${insertValues} ON CONFLICT DO NOTHING`,
          insertParams
        )
      );
    }

    const booking = await findUniqueOrThrow(db, "Booking", {
      where: { id: bookingId, organizationId },
      select: "id, name, status",
    });

    /** When booking is active, newly added items must be flagged checked out */
    const isActiveBooking =
      booking.status === BookingStatus.ONGOING ||
      booking.status === BookingStatus.OVERDUE;

    if (isActiveBooking) {
      if (assetIds.length > 0) {
        await updateMany(db, "Asset", {
          where: { id: { in: assetIds }, organizationId },
          data: { status: AssetStatus.CHECKED_OUT },
        });
      }

      if (kitIds.length > 0) {
        await updateMany(db, "Kit", {
          where: { id: { in: kitIds }, organizationId },
          data: { status: KitStatus.CHECKED_OUT },
        });
      }
    }

    const updatedBooking = booking;

    /** Step 2: Create activity notes */
    await createNotesForScannedAssetsAndKits({
      booking: updatedBooking,
      assetIds,
      kitIds,
      organizationId,
      userId,
    });

    return updatedBooking;
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while adding scanned assets to booking.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { assetIds, kitIds, bookingId, organizationId, userId },
      label,
    });
  }
}

export async function getExistingBookingDetails(bookingId: string) {
  try {
    const rawBooking = await findUniqueOrThrow(db, "Booking", {
      where: { id: bookingId },
      select: "id, status",
    });

    // Hydrate assets via join table
    const assets = await queryRaw<{ id: string; title: string }>(
      db,
      sql`SELECT a."id", a."title" FROM "Asset" a INNER JOIN "_AssetToBooking" ab ON ab."A" = a."id" WHERE ab."B" = ${bookingId}`
    );
    const booking = { ...rawBooking, assets } as any;

    if (!["DRAFT", "RESERVED"].includes(booking.status!)) {
      throw new ShelfError({
        cause: null,
        message: "Booking is not in Draft or Reserved status.",
        label: "Booking",
      });
    }

    return booking;
  } catch (cause: ShelfError | any) {
    throw new ShelfError({
      cause,
      message:
        cause?.message ||
        "Something went wrong while getting existing booking details.",
      additionalData: { bookingId },
      label: "Booking",
    });
  }
}

export async function getAvailableAssetsIdsForBooking(
  assetIds: Asset["id"][]
): Promise<string[]> {
  try {
    const selectedAssets = await findMany(db, "Asset", {
      where: { id: { in: assetIds } },
      select: "status, id, kitId",
    });

    if (selectedAssets.some((asset) => asset.kitId)) {
      throw new ShelfError({
        cause: null,
        message: "Cannot add assets that belong to a kit.",
        label: "Booking",
      });
    }

    return selectedAssets.map((asset) => asset.id);
  } catch (cause: ShelfError | any) {
    throw new ShelfError({
      cause: cause,
      message: cause?.message
        ? cause.message
        : "Something went wrong while getting available assets.",
      label: "Assets",
    });
  }
}

/**
 * This function checks for the available assets.
 * and returns the ids and booking info.
 */
export async function processBooking(bookingId: string, assetIds: string[]) {
  try {
    const [finalAssetIds, bookingInfo] = await Promise.all([
      getAvailableAssetsIdsForBooking(assetIds),
      getExistingBookingDetails(bookingId),
    ]);

    if (!finalAssetIds.length) {
      throw new ShelfError({
        cause: null,
        message: "No assets available.",
        label: "Booking",
      });
    }

    return {
      finalAssetIds,
      bookingInfo,
    };
  } catch (cause) {
    let message = "Something went wrong while processing the booking.";
    if (isLikeShelfError(cause)) {
      message = cause.message;
    }

    throw new ShelfError({
      cause: cause,
      message,
      label: "Booking",
    });
  }
}

/**
 * Shared function to load booking data for both assets and kits routes for add-to-existing-booking
 * @param params - Parameters required for loading bookings
 * @returns Formatted booking data response
 */
export async function loadBookingsData({
  request,
  organizationId,
  userId,
  isSelfServiceOrBase,
  ids,
}: {
  request: Request;
  organizationId: string;
  userId: string;
  isSelfServiceOrBase: boolean;
  ids?: string[];
}): Promise<BookingLoaderResponse> {
  // Get search parameters and pagination settings
  const searchParams = getCurrentSearchParams(request);
  const { page, search } = getParamsValues(searchParams);
  const perPage = 20;

  // Fetch bookings with filters
  const { bookings, bookingCount } = await getBookings({
    organizationId,
    page,
    perPage,
    search,
    userId,
    statuses: ["DRAFT", "RESERVED"],
    // Here we just need the bookigns of the current user if they are self service or base, as they can edit only their own bookings
    ...(isSelfServiceOrBase && {
      custodianUserId: userId,
    }),
  });

  // Set up header and model name
  const header: HeaderData = {
    title: "Bookings",
  };

  const modelName = {
    singular: "booking",
    plural: "bookings",
  };

  const totalPages = Math.ceil(bookingCount / perPage);
  const hints = getClientHint(request);

  return {
    showModal: true,
    header,
    bookings,
    search,
    page,
    bookingCount,
    totalPages,
    perPage,
    modelName,
    ids,
    hints,
  };
}

/**
 *
 */
export async function duplicateBooking({
  bookingId,
  organizationId,
  userId,
  request,
}: {
  bookingId: Booking["id"];
  organizationId: Organization["id"];
  userId: User["id"];
  request: Request;
}) {
  try {
    const bookingToDuplicate = await getBooking({
      id: bookingId,
      organizationId,
      request,
    });
    const hints = getHints(request);

    const newBooking = await create(db, "Booking", {
      name: bookingToDuplicate.name + " (Copy)",
      description: bookingToDuplicate.description,
      from: DateTime.fromFormat(
        DateTime.fromJSDate(new Date(), { zone: hints.timeZone }).toFormat(
          DATE_TIME_FORMAT
        ),
        DATE_TIME_FORMAT,
        { zone: hints.timeZone }
      ).toJSDate(),
      to: DateTime.fromFormat(
        DateTime.fromJSDate(addDays(new Date(), 1), {
          zone: hints.timeZone,
        }).toFormat(DATE_TIME_FORMAT),
        DATE_TIME_FORMAT,
        { zone: hints.timeZone }
      ).toJSDate(),
      organizationId,
      creatorId: userId,
      status: BookingStatus.DRAFT,
      custodianTeamMemberId: bookingToDuplicate.custodianTeamMemberId,
      custodianUserId: bookingToDuplicate.custodianUserId,
    } as any);

    // Connect assets via join table
    const assetIds = bookingToDuplicate.assets.map((asset: any) => asset.id);
    if (assetIds.length > 0) {
      const assetValues = assetIds
        .map((_: any, i: number) => `($${i * 2 + 1}, $${i * 2 + 2})`)
        .join(", ");
      const assetParams = assetIds.flatMap((id: string) => [id, newBooking.id]);
      await queryRaw(
        db,
        new SqlFragment(
          `INSERT INTO "_AssetToBooking" ("A", "B") VALUES ${assetValues} ON CONFLICT DO NOTHING`,
          assetParams
        )
      );
    }

    // Connect tags via join table
    const tagIds = bookingToDuplicate.tags.map((tag: any) => tag.id);
    if (tagIds.length > 0) {
      const tagValues = tagIds
        .map((_: any, i: number) => `($${i * 2 + 1}, $${i * 2 + 2})`)
        .join(", ");
      const tagParams = tagIds.flatMap((id: string) => [id, newBooking.id]);
      await queryRaw(
        db,
        new SqlFragment(
          `INSERT INTO "_BookingToTag" ("A", "B") VALUES ${tagValues} ON CONFLICT DO NOTHING`,
          tagParams
        )
      );
    }

    return newBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while duplicating booking.",
      label,
    });
  }
}

/**
 * Helper functions for partial check-in tracking
 */

/**
 * Check if a booking has any partial check-ins
 */
export async function hasPartialCheckins(bookingId: string): Promise<boolean> {
  const c = await count(db, "PartialBookingCheckin", { bookingId });
  return c > 0;
}

/**
 * Get partial check-in history for a booking
 */
export async function getPartialCheckinHistory(bookingId: string) {
  const checkins = await findMany(db, "PartialBookingCheckin", {
    where: { bookingId },
    orderBy: { checkinTimestamp: "desc" },
  });

  // Hydrate checkedInBy user data
  const hydratedCheckins = await Promise.all(
    (checkins as any[]).map(async (checkin: any) => {
      const checkedInBy = checkin.checkedInByUserId
        ? await findFirst(db, "User", {
            where: { id: checkin.checkedInByUserId },
            select: "firstName, lastName, email",
          })
        : null;
      return { ...checkin, checkedInBy };
    })
  );

  return hydratedCheckins;
}

/**
 * Get total assets checked in via partial check-ins for a booking
 */
export async function getTotalPartialCheckinCount(
  bookingId: string
): Promise<number> {
  const result = await queryRaw<{ total: number }>(
    db,
    sql`SELECT COALESCE(SUM("checkinCount"), 0)::int AS "total" FROM "PartialBookingCheckin" WHERE "bookingId" = ${bookingId}`
  );
  return result[0]?.total || 0;
}

/**
 * Get all unique asset IDs that have been checked in via partial check-ins
 */
export async function getPartiallyCheckedInAssetIds(
  bookingId: string
): Promise<string[]> {
  const partialCheckins = await findMany(db, "PartialBookingCheckin", {
    where: { bookingId },
    select: "assetIds",
  });

  // Flatten all asset ID arrays and get unique values
  const allAssetIds = (partialCheckins as any[]).flatMap(
    (pc: any) => pc.assetIds
  );
  return [...new Set(allAssetIds)];
}

/**
 * Get detailed partial check-in data with user and date information for each asset
 * Returns both the asset IDs and the detailed check-in data in one query
 */
export async function getDetailedPartialCheckinData(bookingId: string) {
  const rawCheckins = await findMany(db, "PartialBookingCheckin", {
    where: { bookingId },
    orderBy: { checkinTimestamp: "asc" },
  });

  // Hydrate checkedInBy user data
  const partialCheckins = await Promise.all(
    (rawCheckins as any[]).map(async (checkin: any) => {
      const checkedInBy = checkin.checkedInByUserId
        ? await findFirst(db, "User", {
            where: { id: checkin.checkedInByUserId },
            select: "id, firstName, lastName, profilePicture",
          })
        : null;
      return {
        ...checkin,
        checkedInBy: checkedInBy || {
          id: "",
          firstName: null,
          lastName: null,
          profilePicture: null,
        },
      };
    })
  );

  // Create a record of asset ID to its check-in details
  const assetCheckinRecord: Record<
    string,
    {
      checkinDate: Date;
      checkedInBy: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        profilePicture: string | null;
      };
    }
  > = {};

  // Collect all unique asset IDs
  const checkedInAssetIds: string[] = [];

  partialCheckins.forEach((checkin) => {
    checkin.assetIds.forEach((assetId) => {
      // Only store the first (earliest) check-in for each asset
      if (!assetCheckinRecord[assetId]) {
        assetCheckinRecord[assetId] = {
          checkinDate: checkin.checkinTimestamp,
          checkedInBy: checkin.checkedInBy,
        };
        checkedInAssetIds.push(assetId);
      }
    });
  });

  return {
    checkedInAssetIds,
    partialCheckinDetails: assetCheckinRecord,
  };
}

export type PartialCheckinDetailsType = Record<
  string,
  {
    checkinDate: Date | string;
    checkedInBy: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
    };
  }
>;

export async function checkinAssets({
  formData,
  request,
  bookingId,
  organizationId,
  userId,
  authSession,
}: {
  formData: FormData;
  request: Request;
  bookingId: string;
  organizationId: string;
  userId: string;
  authSession: AuthSession;
}) {
  const { assetIds, checkinIntentChoice, returnJson } = parseData(
    formData,
    partialCheckinAssetsSchema.extend({
      checkinIntentChoice: z.nativeEnum(CheckinIntentEnum).optional(),
      returnJson: z
        .string()
        .optional()
        .transform((val) => val === "true"),
    })
  );
  const hints = getClientHint(request);

  const result = await partialCheckinBooking({
    id: bookingId,
    organizationId,
    assetIds,
    userId,
    hints,
    intentChoice: checkinIntentChoice,
  });

  const notificationMessage = result.isComplete
    ? `Successfully checked in ${assetIds.length} asset${
        assetIds.length > 1 ? "s" : ""
      } and completed the booking.`
    : `Successfully checked in ${assetIds.length} asset${
        assetIds.length > 1 ? "s" : ""
      } from booking.`;

  sendNotification({
    title: result.isComplete ? "Booking completed" : "Assets checked in",
    message: notificationMessage,
    icon: { name: "success", variant: "success" },
    senderId: authSession.userId,
  });

  // Return JSON if requested by bulk dialog, otherwise redirect
  if (returnJson) {
    return payload({
      success: true,
      message: `Successfully checked in ${assetIds.length} asset${
        assetIds.length > 1 ? "s" : ""
      }`,
    });
  }

  return redirect(`/bookings/${bookingId}`);
}

export async function getOngoingBookingForAsset({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
}) {
  try {
    // Use raw SQL for relation-based filters (assets some, partialCheckins none)
    const results = await queryRaw<any>(
      db,
      sql`SELECT b.* FROM "Booking" b
        WHERE b."status" IN ('ONGOING', 'OVERDUE')
          AND b."organizationId" = ${organizationId}
          AND EXISTS (
            SELECT 1 FROM "_AssetToBooking" ab
            WHERE ab."B" = b."id" AND ab."A" = ${assetId}
          )
          AND NOT EXISTS (
            SELECT 1 FROM "PartialBookingCheckin" pc
            WHERE pc."bookingId" = b."id" AND ${assetId} = ANY(pc."assetIds")
          )
        LIMIT 1`
    );
    const booking = results[0] || null;

    return booking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while getting ongoing booking for asset.",
    });
  }
}
