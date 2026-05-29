import {
  BookingStatus,
  AssetStatus,
  KitStatus,
  AssetType,
} from "@prisma/client";
import type {
  Booking,
  Prisma,
  Organization,
  Asset,
  Kit,
  User,
  UserOrganization,
  Tag,
  OrganizationRoles,
} from "@prisma/client";
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
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { BookingForEmail } from "~/emails/types";
import { isQuantityTracked } from "~/modules/asset/utils";
import { materializeModelRequestForAsset } from "~/modules/booking-model-request/service.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import {
  computeBookingAvailableQuantity,
  createConsumptionLog,
} from "~/modules/consumption-log/service.server";
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
import {
  assertAssetsBelongToOrg,
  assertAssetKitsBelongToOrg,
  assertTagsBelongToOrg,
  assertTeamMemberBelongsToOrg,
  assertUserBelongsToOrg,
} from "~/utils/org-validation.server";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { resolveUserDisplayName } from "~/utils/user";
import type { MergeInclude } from "~/utils/utils";
import {
  BOOKING_COMMON_INCLUDE,
  BOOKING_INCLUDE_FOR_EMAIL,
  BOOKING_INCLUDE_FOR_RESERVATION_EMAIL,
  BOOKING_SCHEDULER_EVENTS_ENUM,
  BOOKING_WITH_ASSETS_INCLUDE,
} from "./constants";
import type {
  ReservationEmailAsset,
  ReservationEmailModelRequest,
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
import { getBookingNotificationRecipients } from "./notification-recipients.server";
import type { NotificationRecipient } from "./notification-recipients.server";
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
import { recordEvent, recordEvents } from "../activity-event/service.server";
import { createSystemBookingNote } from "../booking-note/service.server";
import { createNotes } from "../note/service.server";

import { TAG_WITH_COLOR_SELECT } from "../tag/constants";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Booking";

/**
 * Sends a booking email to all resolved notification recipients.
 * Each recipient gets an individual email with personalized footer.
 */
/**
 * Sends an individual personalized email to each resolved notification
 * recipient. Each email includes a per-recipient footer that explains
 * why the person received the notification (e.g., "you are the custodian",
 * "you are an admin"), driven by `recipient.reason`.
 *
 * Emails are fired concurrently (non-awaited `sendEmail` calls) to avoid
 * blocking the booking flow on slow SMTP delivery.
 *
 * @param recipients - Pre-resolved list from `getBookingNotificationRecipients()`
 * @param booking - The booking data used to render the email template
 * @param subject - Email subject line
 * @param textContent - Plain-text fallback content
 * @param heading - Primary heading rendered in the HTML template
 * @param hints - Client hints for date/time formatting
 * @param templateProps - Additional props forwarded to the email template
 */
async function sendBookingEmailToAllRecipients({
  recipients,
  booking,
  subject,
  textContent,
  heading,
  hints,
  templateProps,
}: {
  recipients: NotificationRecipient[];
  booking: BookingForEmail;
  subject: string;
  textContent: string;
  heading: string;
  hints: ClientHint;
  templateProps?: {
    hideViewButton?: boolean;
    cancellationReason?: string;
    changes?: string[];
    assets?: ReservationEmailAsset[];
    modelRequests?: ReservationEmailModelRequest[];
  };
}) {
  for (const recipient of recipients) {
    const html = await bookingUpdatesTemplateString({
      booking,
      heading,
      assetCount: booking._count.bookingAssets,
      hints,
      recipientReason: recipient.reason,
      recipientEmail: recipient.email,
      ...templateProps,
    });

    sendEmail({
      to: recipient.email,
      subject,
      text: textContent,
      html,
    });
  }
}

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
 * @param organizationId - Organization the booking belongs to (enforced at note-service layer)
 * @param fromStatus - The previous booking status
 * @param toStatus - The new booking status
 * @param userId - ID of the user who performed the action (if manual)
 * @param action - Optional custom action description (e.g., "checked-out", "checked-in")
 * @param custodianUserId - Optional custodian user ID for status badge extra info
 */
export async function createStatusTransitionNote({
  bookingId,
  organizationId,
  fromStatus,
  toStatus,
  userId,
  action,
  custodianUserId,
}: {
  bookingId: string;
  organizationId: string;
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
        displayName: true,
      } satisfies Prisma.UserSelect,
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
    organizationId,
    content,
  });

  // Activity event — records the canonical status transition for reports.
  // Best-effort: don't fail the note creation if event recording fails.
  try {
    await recordEvent({
      organizationId,
      actorUserId: userId ?? null,
      action: "BOOKING_STATUS_CHANGED",
      entityType: "BOOKING",
      entityId: bookingId,
      bookingId,
      field: "status",
      fromValue: fromStatus,
      toValue: toStatus,
    });
  } catch (err) {
    Logger.error(
      new ShelfError({
        cause: err,
        message: "Failed to record BOOKING_STATUS_CHANGED event",
        additionalData: { bookingId, fromStatus, toStatus },
        label,
      })
    );
  }
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
    await db.booking.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: internal scheduler bookkeeping; data.id always comes from a booking already org-validated by every caller (e.g. checkoutBooking L1265, reserveBooking L1020) and SchedulerData carries no organizationId; this only writes activeSchedulerReference, not a data read
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
  booking: Booking & {
    bookingAssets: { asset: Pick<Asset, "id"> }[];
  },
  status: AssetStatus
) {
  try {
    return await db.asset.updateMany({
      where: {
        status: { not: status },
        id: {
          in: [...new Set(booking.bookingAssets.map((ba) => ba.asset.id))],
        },
        // Scope to the booking's org so we never mutate assets in another org
        organizationId: booking.organizationId,
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
  organizationId,
}: {
  kitIds: string[];
  status: KitStatus;
  /** Org that owns the booking — scopes the update so we never touch another org's kits */
  organizationId: string;
}) {
  try {
    return await db.kit.updateMany({
      where: { id: { in: kitIds }, organizationId },
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
    const dataToCreate: Prisma.BookingCreateInput = {
      name: booking.name,
      from: booking.from,
      to: booking.to,
      description: booking.description,
      status: BookingStatus.DRAFT,
      creator: { connect: { id: booking.creatorId } },
      organization: { connect: { id: booking.organizationId } },
      /**
       * Updated original dates to user entered `from` and `to`
       * so that we can track of it later
       */
      originalFrom: booking.from,
      originalTo: booking.to,
      /**
       * Custodian team member will always be passed,
       * even if assigning to a user, so we directly connect it to the booking */
      custodianTeamMember: {
        connect: { id: booking.custodianTeamMemberId },
      },
    };

    /**
     * If assetsIds are passed, we directly connect them.
     * This can happen when:
     * - Booking is created from assets bulk actions
     * - Booking is created from asset page
     * */
    if (assetIds.length > 0) {
      dataToCreate.bookingAssets = {
        create: assetIds.map((id) => ({ assetId: id })),
      };
    }

    if (booking.custodianUserId) {
      dataToCreate.custodianUser = {
        connect: { id: booking.custodianUserId },
      };
    }

    if (booking.tags.length > 0) {
      dataToCreate.tags = {
        connect: booking.tags,
      };
    }

    // Use transaction to ensure booking creation and activity events are atomic
    const createdBooking = await db.$transaction(async (tx) => {
      // SECURITY (cross-org IDOR): the asset IDs, tag IDs and custodian team
      // member ID all originate from request/form input. Before connecting
      // them to the new booking we must prove they belong to the booking's
      // organization — otherwise an attacker in Org A could supply Org B's
      // IDs and link foreign-org entities into their own booking. Validation
      // runs with the active `tx` so it commits atomically with the create.
      if (assetIds.length > 0) {
        await assertAssetsBelongToOrg(
          { assetIds, organizationId: booking.organizationId },
          tx
        );
      }

      if (booking.tags.length > 0) {
        await assertTagsBelongToOrg(
          {
            tagIds: booking.tags.map((t) => t.id),
            organizationId: booking.organizationId,
          },
          tx
        );
      }

      await assertTeamMemberBelongsToOrg(
        {
          teamMemberId: booking.custodianTeamMemberId,
          organizationId: booking.organizationId,
        },
        tx
      );

      // SECURITY (cross-org IDOR): custodianUserId is also request input and a
      // valid team member does not prove the paired user belongs to the org.
      if (booking.custodianUserId) {
        await assertUserBelongsToOrg(
          {
            userId: booking.custodianUserId,
            organizationId: booking.organizationId,
          },
          tx
        );
      }

      const created = await tx.booking.create({
        data: dataToCreate,
        include: { ...BOOKING_COMMON_INCLUDE, organization: true },
      });

      // Activity event for booking creation - must be inside transaction
      await recordEvent(
        {
          organizationId: booking.organizationId,
          actorUserId: booking.creatorId,
          action: "BOOKING_CREATED",
          entityType: "BOOKING",
          entityId: created.id,
          bookingId: created.id,
          meta: { assetCount: assetIds.length },
        },
        tx
      );

      // One BOOKING_ASSETS_ADDED event per asset attached at creation.
      if (assetIds.length > 0) {
        await recordEvents(
          assetIds.map((assetId) => ({
            organizationId: booking.organizationId,
            actorUserId: booking.creatorId,
            action: "BOOKING_ASSETS_ADDED",
            entityType: "BOOKING",
            entityId: created.id,
            bookingId: created.id,
            assetId,
          })),
          tx
        );
      }

      return created;
    });

    return createdBooking;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while trying to create or update the booking. Please try again or contact support.",
      additionalData: { booking, hints },
      label,
      shouldBeCaptured: isLikeShelfError(cause)
        ? cause.shouldBeCaptured
        : undefined,
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
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          custodianUserId: true,
          custodianTeamMemberId: true,
          name: true,
          description: true,
          from: true,
          to: true,
          custodianTeamMember: {
            select: {
              id: true,
              name: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  displayName: true,
                },
              },
            },
          },
          custodianUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
          tags: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          status: 404,
          message:
            "Could not find booking or the booking exists in another workspace.",
          label,
        });
      });

    // Capture old custodian email before the update
    // (for custodian change scenarios)
    const oldCustodianEmail = booking.custodianUser?.email;

    // SECURITY (cross-org IDOR): tags come from form input and are connected
    // unconditionally below. Prove they belong to this organization before
    // connecting, mirroring the guard in createBooking.
    const tagIds = tags?.map((t) => t.id) ?? [];
    if (tagIds.length > 0) {
      await assertTagsBelongToOrg({ tagIds, organizationId });
    }

    const dataToUpdate: Prisma.BookingUpdateInput = {
      name,
      description,
      tags: {
        set: [],
        connect: tags,
      },
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
        // SECURITY (cross-org IDOR): custodianTeamMemberId comes from form
        // input. Prove the team member belongs to this booking's
        // organization before connecting it, so an attacker cannot assign a
        // foreign-org team member as the custodian.
        await assertTeamMemberBelongsToOrg({
          teamMemberId: custodianTeamMemberId,
          organizationId,
        });

        dataToUpdate.custodianTeamMember = {
          connect: { id: custodianTeamMemberId },
        };

        /**
         * If a userId is passed, meaning the team member is connected to a user, we connct to it.
         * This will override the value if there were any previous custodians`
         */
        if (custodianUserId) {
          // SECURITY (cross-org IDOR): custodianUserId is request input; a
          // valid team member does not prove the paired user is in this org.
          await assertUserBelongsToOrg({
            userId: custodianUserId,
            organizationId,
          });
          dataToUpdate.custodianUser = {
            connect: { id: custodianUserId },
          };
        } else if (booking.custodianUserId) {
          /**
           * If previous booking custodian had a user, we need to remove it
           * because we are now connecting to an NRM. If we dont do this the teamMemberID and the userId will be connected to different entities
           */
          dataToUpdate.custodianUser = {
            disconnect: true,
          };
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

    const updatedBooking = await db.booking.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L619; this is the write on that same proven id
      where: { id: booking.id },
      data: dataToUpdate,
    });

    // BOOKING ACTIVITY LOG: Create separate notes for each change
    // This approach creates individual notes for each field change with proper user attribution

    // Get user data for attribution if userId is provided
    const user = userId
      ? await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
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
        organizationId,
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
        organizationId,
        content: `${userLink} changed booking description from ${descriptionChange}.`,
      });
      changes.push("Booking description was updated");
    }

    // Check and log start date changes
    const fromDateChanged =
      !!from && !!booking.from && from.getTime() !== booking.from.getTime();
    if (fromDateChanged) {
      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${userLink} changed booking start date from ${wrapDateForNote(
          booking.from!
        )} to ${wrapDateForNote(from!)}.`,
      });
      changes.push(
        `Start date changed from ${formatDateForEmail(
          booking.from!
        )} to ${formatDateForEmail(from!)}`
      );
    }

    // Check and log end date changes
    const toDateChanged =
      !!to && !!booking.to && to.getTime() !== booking.to.getTime();
    if (toDateChanged) {
      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
        content: `${userLink} changed booking end date from ${wrapDateForNote(
          booking.to!
        )} to ${wrapDateForNote(to!)}.`,
      });
      changes.push(
        `End date changed from ${formatDateForEmail(
          booking.to!
        )} to ${formatDateForEmail(to!)}`
      );
    }

    /**
     * Activity events for date changes — one event per field that
     * actually changed (per `record-event-payload-shapes.md`). Best-effort
     * post-tx: matches the surrounding note-write location and avoids
     * blocking the user's update on event persistence. The notes above
     * still ship even if the event write fails.
     */
    try {
      if (fromDateChanged) {
        await recordEvent({
          organizationId,
          actorUserId: userId ?? null,
          action: "BOOKING_DATES_CHANGED",
          entityType: "BOOKING",
          entityId: booking.id,
          bookingId: booking.id,
          field: "from",
          fromValue: booking.from!.toISOString(),
          toValue: from!.toISOString(),
        });
      }
      if (toDateChanged) {
        await recordEvent({
          organizationId,
          actorUserId: userId ?? null,
          action: "BOOKING_DATES_CHANGED",
          entityType: "BOOKING",
          entityId: booking.id,
          bookingId: booking.id,
          field: "to",
          fromValue: booking.to!.toISOString(),
          toValue: to!.toISOString(),
        });
      }
    } catch (err) {
      Logger.error(
        new ShelfError({
          cause: err,
          message: "Failed to record updateBasicBooking date events",
          additionalData: { bookingId: booking.id },
          label,
        })
      );
    }

    // Check and log custodian changes
    if (
      custodianTeamMemberId &&
      custodianTeamMemberId !== booking.custodianTeamMemberId
    ) {
      // Build custodian name helpers for the email change description
      const oldCustodianName = booking.custodianUser
        ? resolveUserDisplayName(booking.custodianUser)
        : booking.custodianTeamMember?.name ?? "Unknown";

      try {
        // Fetch new custodian details.
        // SECURITY (cross-org IDOR): scope the lookup to this booking's
        // organization so a foreign-org team member cannot be resolved and
        // surfaced in the activity note.
        const newCustodian = await db.teamMember.findFirst({
          where: { id: custodianTeamMemberId, organizationId },
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        });

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
            organizationId,
            content: custodianChangeMessage,
          });

          const newCustodianName = newCustodian.user
            ? resolveUserDisplayName(newCustodian.user)
            : newCustodian.name;
          changes.push(
            `Custodian changed from ${oldCustodianName} to ${newCustodianName}`
          );
        }
      } catch (_error) {
        // If we can't fetch custodian details (e.g., in tests), fall back to generic message
        await createSystemBookingNote({
          bookingId: booking.id,
          organizationId,
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
      const newTags = await db.tag.findMany({
        where: { id: { in: newTagIds }, organizationId },
        select: { name: true },
      });
      const newTagNames = newTags.map((tag) => tag.name).join(", ") || "(none)";

      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
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
          ? oldCustodianEmail ?? undefined
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
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          ...BOOKING_INCLUDE_FOR_RESERVATION_EMAIL,
          bookingAssets: {
            include: {
              asset: {
                select: {
                  ...BOOKING_INCLUDE_FOR_RESERVATION_EMAIL.bookingAssets.include
                    .asset.select,
                  status: true,
                  bookingAssets: {
                    ...createBookingConflictConditions({
                      currentBookingId: id,
                      fromDate: from,
                      toDate: to,
                    }),
                    select: {
                      id: true,
                      quantity: true,
                      booking: {
                        select: { id: true, status: true, name: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /**
     * Guard: reserveBooking is `DRAFT → RESERVED` only. Without this
     * check, clicking Reserve on an already-RESERVED booking (e.g.
     * from a stale tab) re-runs the entire action and writes a
     * spurious `"Reserved → Reserved"` status-transition note into
     * the activity log — plus sends another reservation email and
     * re-schedules jobs. Refuse the no-op up front.
     */
    if (bookingFound.status !== BookingStatus.DRAFT) {
      throw new ShelfError({
        cause: null,
        label,
        status: 400,
        shouldBeCaptured: false,
        message: `This booking is already ${bookingFound.status.toLowerCase()}. Only DRAFT bookings can be reserved.`,
      });
    }

    /** Server-side conflict validation to prevent race conditions */
    if (from && to && bookingFound.bookingAssets) {
      const conflictedAssets = bookingFound.bookingAssets
        .map((ba) => ba.asset)
        .filter((asset) => hasAssetBookingConflicts(asset, id));

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

    // SECURITY (cross-org IDOR): tags come from form input and are connected
    // below. Prove they belong to this organization before connecting,
    // mirroring createBooking / updateBasicBooking.
    const tagIds = tags?.map((t) => t.id) ?? [];
    if (tagIds.length > 0) {
      await assertTagsBelongToOrg({ tagIds, organizationId });
    }

    const dataToUpdate: Prisma.BookingUpdateInput = {
      status: BookingStatus.RESERVED,
      name,
      description,
      tags: {
        set: [],
        connect: tags,
      },
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
      // SECURITY (cross-org IDOR): custodianTeamMemberId comes from form input.
      // Prove the team member belongs to this booking's organization before
      // connecting it, mirroring updateBasicBooking / createBooking.
      await assertTeamMemberBelongsToOrg({
        teamMemberId: custodianTeamMemberId,
        organizationId,
      });

      dataToUpdate.custodianTeamMember = {
        connect: { id: custodianTeamMemberId },
      };

      /**
       * If a userId is passed, meaning the team member is connected to a user, we connct to it.
       * This will override the value if there were any previous custodians`
       */
      if (custodianUserId) {
        // SECURITY (cross-org IDOR): custodianUserId is request input; a valid
        // team member does not prove the paired user is in this org.
        await assertUserBelongsToOrg({
          userId: custodianUserId,
          organizationId,
        });
        dataToUpdate.custodianUser = {
          connect: { id: custodianUserId },
        };
      } else if (bookingFound.custodianUserId) {
        /**
         * If previous booking custodian had a user, we need to remove it
         * because we are now connecting to an NRM. If we dont do this the teamMemberID and the userId will be connected to different entities
         */
        dataToUpdate.custodianUser = {
          disconnect: true,
        };
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

    const updatedBooking = await db.booking.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingFound id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L1020; this is the write on that same proven id
      where: { id: bookingFound.id },
      data: dataToUpdate,
    });

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

    // Resolve notification recipients and send emails.
    // Pass isSelfServiceOrBase so admin broadcast only fires for
    // reservations made by base/self-service users (pickup requests).
    const recipients = await getBookingNotificationRecipients({
      booking: bookingFound,
      eventType: "RESERVATION",
      organizationId,
      editorUserId: userId,
      isSelfServiceOrBase,
    });

    if (recipients.length > 0) {
      const custodian = bookingFound?.custodianUser
        ? resolveUserDisplayName(bookingFound.custodianUser)
        : bookingFound.custodianTeamMember?.name ?? "";

      // Only forward outstanding requests so the email doesn't render
      // fulfilled historical rows. `fulfilledAt
      // IS NULL` is the canonical outstanding filter in the new schema;
      // each row shows the STILL-PENDING unit count
      // (`quantity - fulfilledQuantity`).
      const outstandingModelRequests = bookingFound.modelRequests
        .filter((req) => req.fulfilledAt === null)
        .map((req) => ({
          quantity: req.quantity - req.fulfilledQuantity,
          modelName: req.assetModel.name,
        }));

      const text = assetReservedEmailContent({
        bookingName: bookingFound.name,
        assetsCount: bookingFound._count.bookingAssets,
        custodian,
        from,
        to,
        hints,
        bookingId: bookingFound.id,
        customEmailFooter: bookingFound.organization.customEmailFooter,
        modelRequests: outstandingModelRequests,
      });

      await sendBookingEmailToAllRecipients({
        recipients,
        booking: bookingFound,
        subject: `✅ Booking reserved (${bookingFound.name}) - shelf.nu`,
        textContent: text,
        heading: `Booking reservation for ${custodian}`,
        hints,
        templateProps: {
          assets: bookingFound.bookingAssets,
          // Forward any outstanding `BookingModelRequest` rows so the
          // reservation email can render a "Requested models" section.
          // The include widening on
          // `BOOKING_INCLUDE_FOR_RESERVATION_EMAIL` guarantees
          // `modelRequests` is present on the loaded booking.
          modelRequests: bookingFound.modelRequests,
        },
      });
    }

    // Add activity log for status change to RESERVED
    await createStatusTransitionNote({
      bookingId: updatedBooking.id,
      organizationId,
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

/**
 * Transaction-body helper shared by {@link checkoutBooking} and
 * {@link fulfilModelRequestsAndCheckout}.
 *
 * Runs the write-side of the RESERVED → ONGOING transition under the
 * caller's transaction:
 *   1. Re-reads `BookingModelRequest` rows with `quantity > 0` and throws
 *      a 400 `ShelfError` if any remain (hard block — model requests must
 *      all be fulfilled before checkout).
 *   2. For every QUANTITY_TRACKED booking asset, acquires a row lock and
 *      validates available pool capacity inside the tx — closes the TOCTOU
 *      window against sibling writers (other checkouts, custody
 *      assignments, quantity adjustments).
 *   3. Flips the checked-out assets + kits to `CHECKED_OUT` and updates
 *      the booking row with `dataToUpdate` (status + optional adjusted
 *      dates).
 *
 * Extracted so `fulfilModelRequestsAndCheckout` can compose
 * `addScannedAssetsToBookingWithinTx` and this body into a single atomic
 * unit — a failure here (availability, outstanding request, etc.) rolls
 * back BookingAsset creation AND the model-request materialisation in one
 * shot.
 *
 * @param tx - Prisma transaction client
 * @param args.bookingId - Booking being transitioned
 * @param args.bookingAssetIds - All asset IDs currently on the booking (used to fan the CHECKED_OUT status update)
 * @param args.qtyTrackedBookingAssets - Booking-asset pairs whose asset is QUANTITY_TRACKED (used for the availability guard)
 * @param args.uniqueQtyTrackedAssetIds - Deduplicated IDs from the above list
 * @param args.dataToUpdate - Pre-computed update payload for the booking row (status, optional from/originalFrom)
 * @param args.kitIds - Kits to flip to `CHECKED_OUT`
 * @param args.hasKits - Whether the kit update should fire
 * @throws {ShelfError} 400 when any model request is unfulfilled
 * @throws {ShelfError} 400 when any QUANTITY_TRACKED asset lacks sufficient pool availability
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkoutBookingWritesWithinTx(
  tx: any,
  {
    bookingId,
    organizationId,
    bookingAssetIds,
    qtyTrackedBookingAssets,
    uniqueQtyTrackedAssetIds,
    dataToUpdate,
    kitIds,
    hasKits,
  }: {
    bookingId: Booking["id"];
    organizationId: Booking["organizationId"];
    bookingAssetIds: Asset["id"][];
    qtyTrackedBookingAssets: Array<{
      quantity: number;
      asset: Pick<Asset, "id" | "title">;
    }>;
    uniqueQtyTrackedAssetIds: Asset["id"][];
    dataToUpdate: Prisma.BookingUpdateInput;
    kitIds: string[];
    hasKits: boolean;
  }
) {
  /**
   * Checkout guard for unfulfilled `BookingModelRequest` rows. Model
   * requests (Book-by-Model) represent units that
   * were reserved at the model level but haven't been assigned to
   * a concrete asset yet (the usual recovery path is to scan
   * matching assets, which decrements the request). If any remain
   * at checkout we refuse the RESERVED → ONGOING transition and
   * surface the outstanding counts so the operator can either:
   *   1. scan matching assets to drain the request, or
   *   2. edit the requests from manage-assets (allowed while the
   *      booking is still RESERVED — see the model-request service).
   * This is a hard block — there is no force-partial escape hatch
   * because ONGOING implies "assets are physically out", which
   * unfulfilled requests directly contradict.
   *
   * Also enforced independently by `fulfilModelRequestsAndCheckout`
   * as defence in depth: the drawer disables submit while
   * `remaining > 0`, but a tampered payload would still hit this
   * guard inside the shared transaction and roll everything back.
   */
  const outstandingRequests = await tx.bookingModelRequest.findMany({
    // `fulfilledAt IS NULL` is the canonical "outstanding" filter —
    // replaces the pre-audit-trail `quantity > 0` check. Rows where
    // every unit has been materialised into a `BookingAsset` carry a
    // timestamp and must not block checkout.
    where: { bookingId, fulfilledAt: null },
    include: { assetModel: { select: { name: true } } },
  });

  if (outstandingRequests.length > 0) {
    // `tx` is typed `any` so the result shape is lost; annotate the callback.
    //
    // Report `req.quantity` (the original reservation intent), NOT
    // `quantity - fulfilledQuantity`. This throw rolls the whole tx
    // back — including the in-tx `fulfilledQuantity` increments from
    // `addScannedAssetsToBookingWithinTx`. So the number the operator
    // sees post-failure is the pre-tx outstanding count, which equals
    // `quantity` for rows whose `fulfilledAt` is still null. Showing
    // `quantity - fulfilledQuantity` here would report a mid-tx view
    // that doesn't match post-rollback reality.
    const outstanding: Array<{ assetModelName: string; remaining: number }> =
      outstandingRequests.map(
        (req: { assetModel: { name: string }; quantity: number }) => ({
          assetModelName: req.assetModel.name,
          remaining: req.quantity,
        })
      );

    const summary = outstanding
      .map((row) => `${row.remaining} × ${row.assetModelName}`)
      .join(", ");

    throw new ShelfError({
      cause: null,
      label,
      status: 400,
      shouldBeCaptured: false,
      message: `Cannot check out — ${summary} still unassigned. Scan matching assets to fulfil the reservation.`,
      additionalData: { outstanding },
    });
  }

  /**
   * Validate quantity availability for QUANTITY_TRACKED assets.
   * Between when a booking was created and checkout, other
   * operations (custody assignments, other booking checkouts) may
   * have consumed some units. We check here — under the row lock —
   * so the user gets a clear error listing which assets need
   * their quantities adjusted before proceeding, and no two
   * concurrent writers can both pass this guard against the same
   * snapshot.
   *
   * `computeBookingAvailableQuantity` doesn't take a `tx`, but
   * read-committed isolation combined with the row lock acquired
   * above guarantees that once any competing writer has committed
   * its change it is visible here; any still-open writer is
   * blocked on the same row lock until we commit or roll back.
   */
  if (uniqueQtyTrackedAssetIds.length > 0) {
    const insufficientQtyWarnings: string[] = [];

    for (const assetId of uniqueQtyTrackedAssetIds) {
      await lockAssetForQuantityUpdate(tx, assetId);

      const { available } = await computeBookingAvailableQuantity(
        assetId,
        bookingId
      );

      // Sum the requested units for this asset on this booking.
      // (Typically there's one BookingAsset per asset, but we sum
      // defensively in case the invariant ever changes.)
      const requested = qtyTrackedBookingAssets
        .filter((ba) => ba.asset.id === assetId)
        .reduce((sum, ba) => sum + ba.quantity, 0);

      if (requested > available) {
        const title =
          qtyTrackedBookingAssets.find((ba) => ba.asset.id === assetId)?.asset
            .title ?? "";
        insufficientQtyWarnings.push(
          `"${title}": requested ${requested}, only ${available} available`
        );
      }
    }

    if (insufficientQtyWarnings.length > 0) {
      throw new ShelfError({
        cause: null,
        label,
        message: `Some quantity-tracked assets have insufficient availability:\n${insufficientQtyWarnings.join(
          "\n"
        )}\nPlease adjust quantities in the booking before checkout.`,
        shouldBeCaptured: false,
        status: 400,
      });
    }
  }

  // SECURITY (cross-org IDOR): scope the status mutation to the caller's
  // organization so it can never flip the status of an asset that lives in
  // another workspace, even if a foreign asset ID slipped into the list.
  await tx.asset.updateMany({
    where: {
      id: { in: bookingAssetIds },
      organizationId,
    },
    data: { status: AssetStatus.CHECKED_OUT },
  });

  await tx.booking.update({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingId already org-checked by the caller via findUniqueOrThrow({where:{id,organizationId}}); this is the write on that same proven id
    where: { id: bookingId },
    data: dataToUpdate,
    select: { id: true },
  });

  if (hasKits) {
    await tx.kit.updateMany({
      where: { id: { in: kitIds }, organizationId },
      data: { status: KitStatus.CHECKED_OUT },
    });
  }
}

/**
 * Post-commit side-effects shared by {@link checkoutBooking} and
 * {@link fulfilModelRequestsAndCheckout}.
 *
 * These operations MUST run after the checkout transaction has committed
 * — they touch external systems (scheduler) and write notes that should
 * reflect the post-commit truth.
 *
 *   1. Writes the RESERVED → ONGOING/OVERDUE status transition note.
 *   2. Cancels any outstanding scheduler job for the booking.
 *   3. Either sends the check-in reminder now (if under an hour to
 *      booking.to) + schedules the overdue handler, or schedules the
 *      check-in reminder for ~1h before booking.to.
 *   4. Hydrates and returns the full booking payload.
 *
 * @returns The hydrated booking row with reservation-email includes.
 */
async function runCheckoutSideEffects({
  bookingFound,
  userId,
  effectiveStatus,
  effectiveBooking,
  effectiveTo,
  hints,
  organizationId,
  isExpired,
}: {
  bookingFound: BookingForEmail;
  userId?: string;
  effectiveStatus: BookingStatus;
  effectiveBooking: BookingForEmail;
  effectiveTo: Date | null | undefined;
  hints: ClientHint;
  organizationId: Booking["organizationId"];
  isExpired: boolean;
}) {
  // Create status transition note. `organizationId` is required by
  // the hardened signature merged from `main` (cross-org safety
  // — every booking-note write must be scoped).
  if (userId) {
    await createStatusTransitionNote({
      bookingId: bookingFound.id,
      organizationId,
      fromStatus: bookingFound.status,
      toStatus: effectiveStatus,
      userId,
      custodianUserId: bookingFound.custodianUserId || undefined,
    });
  }

  /** Calculate the time difference between the booking.to and the current time */
  const { hours } = calcTimeDifference(effectiveTo!, new Date());
  const lessThanOneHourToCheckin = hours < 1;

  /** We cancel just in case there is something pending */
  await cancelScheduler(bookingFound);

  /**
   * If its expired that means its status will directly go to OVERDUE,
   * so we can cancel everything and don't schedule any more events
   */
  if (isExpired) {
    return db.booking.findUniqueOrThrow({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `bookingFound.id` already org-checked via findUniqueOrThrow({where:{id,organizationId}}); this re-fetches the same proven id for the return payload
      where: { id: bookingFound.id },
      include: { ...BOOKING_INCLUDE_FOR_EMAIL, bookingAssets: true },
    });
  }

  // For any checkout (early or not), what matters is time until check-in
  /**
   * If less than 1 hour until check-in time, then
   * send checkin reminder immediately.
   * We also schedule the overdue handler for the booking
   */
  if (lessThanOneHourToCheckin) {
    await sendCheckinReminder(
      effectiveBooking,
      bookingFound._count.bookingAssets,
      hints,
      organizationId
    );

    if (effectiveTo) {
      const when = new Date(effectiveTo);
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
    const when = new Date(effectiveTo!);
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

  /** Hydrate the full booking with relations for the return payload only. */
  return db.booking.findUniqueOrThrow({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `bookingFound.id` already org-checked via findUniqueOrThrow({where:{id,organizationId}}); this re-fetches the same proven id for the return payload
    where: { id: bookingFound.id },
    include: { ...BOOKING_INCLUDE_FOR_EMAIL, bookingAssets: true },
  });
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
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          bookingAssets: {
            include: {
              asset: {
                include: {
                  bookingAssets: {
                    ...createBookingConflictConditions({
                      currentBookingId: id,
                      fromDate: from,
                      toDate: to,
                    }),
                    select: {
                      id: true,
                      quantity: true,
                      booking: {
                        select: { id: true, status: true, name: true },
                      },
                    },
                  },
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
          ...BOOKING_INCLUDE_FOR_EMAIL,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    // SECURITY (defense-in-depth): reject checkout if any attached asset is
    // not in this org BEFORE any asset-derived logic runs. A legacy
    // pre-remediation cross-org link would otherwise (a) leak the foreign
    // asset's title through the conflict/custody error messages below, and
    // (b) let the booking transition while the org-scoped updateMany skips it.
    // Legitimately-created bookings (assets validated at create/add) pass.
    const bookingFoundAssetIds = [
      ...new Set(bookingFound.bookingAssets.map((ba) => ba.asset.id)),
    ];
    if (bookingFoundAssetIds.length > 0) {
      await assertAssetsBelongToOrg({
        assetIds: bookingFoundAssetIds,
        organizationId,
      });
    }

    /** Server-side conflict validation to prevent race conditions */
    if (from && to && bookingFound.bookingAssets) {
      const conflictedAssets = bookingFound.bookingAssets
        .map((ba) => ba.asset)
        .filter((asset) => hasAssetBookingConflicts(asset, id));

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

    /**
     * Server-side validation: Block checkout if any INDIVIDUAL asset is
     * in custody. QUANTITY_TRACKED assets can have row-level status
     * IN_CUSTODY because *some* units are operator-allocated; the
     * remaining pool is still bookable and the in-tx availability
     * check below validates the math against current custody +
     * outstanding bookings under a row lock.
     */
    const assetsInCustody = bookingFound.bookingAssets
      .map((ba) => ba.asset)
      .filter(
        (asset) =>
          !isQuantityTracked(asset) && asset.status === AssetStatus.IN_CUSTODY
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
     * Identify QUANTITY_TRACKED bookingAssets upfront. Availability
     * validation happens INSIDE the transaction below, guarded by a
     * per-asset row lock, to avoid TOCTOU races with sibling writers
     * (other booking checkouts, direct custody assignments, quantity
     * adjustments) that could oversubscribe the same physical pool.
     */
    const qtyTrackedBookingAssets = bookingFound.bookingAssets.filter((ba) =>
      isQuantityTracked(ba.asset)
    );

    /**
     * This checks if the booking end date is in the past
     * We need this because sometimes the user can checkout a booking
     * that is already overdue for check in
     */
    const isExpired = isBookingExpired({ to: bookingFound.to! });

    const dataToUpdate: Prisma.BookingUpdateInput = {
      status: isExpired ? BookingStatus.OVERDUE : BookingStatus.ONGOING,
    };

    /**
     * Get the kitIds because we need them to update their status later on
     */
    const kitIds = getKitIdsByAssets(
      bookingFound.bookingAssets.map((ba) => ba.asset)
    );
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

    /** Keep the transaction lean (writes only + per-asset row locks for
     * qty-tracked availability guard) to stay within the timeout. The
     * heavy read for the return payload is done after commit. This
     * prevents P2028 timeouts on bookings with many assets (262 assets in
     * Sentry SHELF-WEBAPP-1KN), so we bump the interactive-tx timeout from
     * the 5s default to 15s.
     *
     * We use the interactive (callback) form of `$transaction` so we can
     * acquire `SELECT … FOR UPDATE` row locks via
     * `lockAssetForQuantityUpdate` on each unique qty-tracked asset
     * BEFORE validating availability. This serializes concurrent writers
     * (other booking checkouts, direct custody assignments, quantity
     * adjustments) on the same asset, closing a TOCTOU window where two
     * checkouts could otherwise pass the guard against the same stale
     * snapshot and both commit. The same callback also records activity
     * events from main's audit-trail integration — atomic with the
     * checkout writes so a partial failure doesn't leave orphaned events. */
    const uniqueQtyTrackedAssetIds = Array.from(
      new Set(qtyTrackedBookingAssets.map((ba) => ba.asset.id))
    );

    // Dedupe asset ids before recording one BOOKING_CHECKED_OUT per asset —
    // a booking can carry multiple BookingAsset rows per asset.
    const uniqueCheckedOutAssetIds = Array.from(
      new Set(bookingFound.bookingAssets.map((ba) => ba.asset.id))
    );

    await db.$transaction(
      async (tx) => {
        await checkoutBookingWritesWithinTx(tx, {
          bookingId: bookingFound.id,
          // SECURITY (cross-org IDOR): the helper scopes the asset/kit
          // status mutations to this org so a foreign asset id that slipped
          // into the booking's list can never be flipped.
          organizationId,
          bookingAssetIds: bookingFound.bookingAssets.map((ba) => ba.asset.id),
          qtyTrackedBookingAssets,
          uniqueQtyTrackedAssetIds,
          dataToUpdate,
          kitIds,
          hasKits,
        });

        // Activity events — one BOOKING_CHECKED_OUT per asset on the
        // booking. Map through the deduped asset ids so a multi-row asset
        // doesn't produce duplicate events.
        if (uniqueCheckedOutAssetIds.length > 0) {
          await recordEvents(
            uniqueCheckedOutAssetIds.map((assetId) => ({
              organizationId,
              actorUserId: userId ?? null,
              action: "BOOKING_CHECKED_OUT",
              entityType: "BOOKING",
              entityId: bookingFound.id,
              bookingId: bookingFound.id,
              assetId,
            })),
            tx
          );
        }
      },
      { timeout: 15000 }
    );

    /** Build an effective snapshot by merging bookingFound with any fields
     * modified by dataToUpdate (adjusted dates, status). This avoids
     * re-reading from the DB and ensures downstream logic (notes, emails,
     * scheduling) uses the correct post-checkout values. */
    const effectiveFrom =
      (dataToUpdate.from as Date | undefined) ?? bookingFound.from;
    const effectiveTo =
      (dataToUpdate.to as Date | undefined) ?? bookingFound.to;
    const effectiveStatus =
      (dataToUpdate.status as BookingStatus) ?? bookingFound.status;
    const effectiveBooking = {
      ...bookingFound,
      from: effectiveFrom,
      to: effectiveTo,
      status: effectiveStatus,
    };

    // Extracted to a shared helper so `fulfilModelRequestsAndCheckout`
    // can run the same post-commit work (status transition note,
    // scheduler, reminders, hydrate) without duplicating the body.
    // `organizationId` is required for `createStatusTransitionNote` and
    // `createSystemBookingNote` — forwarded inside the helper, see
    // {@link runCheckoutSideEffects}.
    return await runCheckoutSideEffects({
      bookingFound,
      userId,
      effectiveStatus,
      effectiveBooking,
      effectiveTo,
      hints,
      organizationId,
      isExpired,
    });
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

/**
 * Combined service that fulfils outstanding `BookingModelRequest` rows via
 * scanned assets AND transitions the booking from RESERVED to
 * ONGOING/OVERDUE in a single atomic transaction.
 *
 * Used by the fulfil-and-checkout drawer — the operator
 * scans the assets that satisfy their model-level reservations, optionally
 * adds off-model scans that get checked out along with everything else,
 * and clicks Check Out. The route action then delegates here instead of
 * calling `addScannedAssetsToBooking` + `checkoutBooking` sequentially,
 * because a sequential call pattern would leak half-materialised state if
 * availability validation failed AFTER requests had already been drained.
 *
 * Atomicity guarantees (all-or-nothing):
 *   - `BookingModelRequest` decrements (via `materializeModelRequestForAsset`)
 *   - `BookingAsset` row creation for the scanned assets
 *   - Booking `from`/`originalFrom` adjustment for early checkout
 *   - Booking status transition + kit/asset CHECKED_OUT flags
 *   - Outstanding-request guard (defence in depth — the drawer also
 *     blocks submit while any `remaining > 0`, but the server enforces
 *     independently in case the payload is tampered with)
 *   - QUANTITY_TRACKED availability guard (with row locks against
 *     concurrent checkouts)
 *
 * Post-commit side-effects (fired only after the tx succeeds) mirror
 * `checkoutBooking` + `addScannedAssetsToBooking`:
 *   - Activity notes for each scanned asset/kit
 *   - Status transition note
 *   - Scheduler cancellation + rescheduling (checkin-reminder / overdue)
 *   - Hydrated booking payload returned
 *
 * NOTE: this function reuses the same tx-body helpers that
 * {@link addScannedAssetsToBooking} and {@link checkoutBooking} use
 * (`addScannedAssetsToBookingWithinTx` and `checkoutBookingWritesWithinTx`)
 * so behaviour never drifts between the two code paths.
 *
 * @param args.bookingId - Booking to fulfil + check out
 * @param args.organizationId - Organisation scope for all reads/writes
 * @param args.userId - User performing the scan + checkout (attribution for notes + materialised logs)
 * @param args.assetIds - Scanned asset IDs (QRs resolved to assets). May include off-model scans; those bypass the model-request drain and land as direct BookingAssets.
 * @param args.kitIds - Optional scanned kit IDs. Kits don't participate in model requests (out of scope for Book-by-Model), so this is forwarded purely for note attribution + kit status sync.
 * @param args.checkoutIntentChoice - If `"with-adjusted-date"` and the booking is an early checkout, `booking.from` is rewritten to "now" and the original value preserved on `booking.originalFrom`. Same semantics as `checkoutBooking`'s `intentChoice`.
 * @param args.hints - Client hints used for scheduler timestamps + check-in reminder emails post-commit.
 * @param args.from - Optional booking.from for conflict detection (mirrors `checkoutBooking`'s pre-tx conflict guard).
 * @param args.to - Optional booking.to for conflict detection.
 * @returns The hydrated booking with reservation-email includes (same shape as `checkoutBooking`).
 * @throws {ShelfError} 400 if any model request remains unfulfilled after scanning (drawer also guards, server enforces).
 * @throws {ShelfError} 400 if any QUANTITY_TRACKED asset lacks pool availability.
 * @throws {ShelfError} If any asset is in custody / conflicted with another booking window.
 */
export async function fulfilModelRequestsAndCheckout({
  bookingId,
  organizationId,
  userId,
  assetIds,
  kitIds = [],
  checkoutIntentChoice,
  hints,
  from,
  to,
}: {
  bookingId: Booking["id"];
  organizationId: Booking["organizationId"];
  userId: string;
  assetIds: Asset["id"][];
  kitIds?: string[];
  checkoutIntentChoice?: CheckoutIntentEnum;
  hints: ClientHint;
  from?: Date | null;
  to?: Date | null;
}) {
  try {
    /**
     * Pre-tx: hydrate the booking with the same include shape
     * `checkoutBooking` uses so we can run the conflict + custody guards
     * against the pre-existing asset set. The newly scanned assets are
     * validated inside the tx via the availability + outstanding-request
     * guards (TOCTOU-safe).
     */
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id: bookingId, organizationId },
        include: {
          bookingAssets: {
            include: {
              asset: {
                include: {
                  bookingAssets: {
                    ...createBookingConflictConditions({
                      currentBookingId: bookingId,
                      fromDate: from,
                      toDate: to,
                    }),
                    select: {
                      id: true,
                      quantity: true,
                      booking: {
                        select: { id: true, status: true, name: true },
                      },
                    },
                  },
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
          ...BOOKING_INCLUDE_FOR_EMAIL,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
        });
      });

    /** Server-side conflict validation on pre-existing assets */
    if (from && to && bookingFound.bookingAssets) {
      const conflictedAssets = bookingFound.bookingAssets
        .map((ba) => ba.asset)
        .filter((asset) => hasAssetBookingConflicts(asset, bookingId));

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

    /**
     * Server-side validation: Block checkout if any INDIVIDUAL asset is
     * in custody. QUANTITY_TRACKED is exempt — see the parallel guard in
     * the other checkoutBooking path above for the full reasoning.
     */
    const assetsInCustody = bookingFound.bookingAssets
      .map((ba) => ba.asset)
      .filter(
        (asset) =>
          !isQuantityTracked(asset) && asset.status === AssetStatus.IN_CUSTODY
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

    const isExpired = isBookingExpired({ to: bookingFound.to! });
    const isEarlyCheckout = isBookingEarlyCheckout(bookingFound.from!);

    /**
     * Build the booking update payload (status + optional early-date
     * adjustment). We intentionally match `checkoutBooking`'s existing
     * timezone-aware date rewrite so the two code paths produce
     * byte-identical `from`/`originalFrom` values when the operator
     * chooses `"with-adjusted-date"`.
     */
    const dataToUpdate: Prisma.BookingUpdateInput = {
      status: isExpired ? BookingStatus.OVERDUE : BookingStatus.ONGOING,
    };

    if (
      isEarlyCheckout &&
      checkoutIntentChoice === CheckoutIntentEnum["with-adjusted-date"]
    ) {
      // Update originalFrom to old `from` date of booking
      dataToUpdate.originalFrom = bookingFound.from;

      // Update `from` date to current date (timezone-aware, matching
      // `checkoutBooking`)
      const fromDateStr = DateTime.fromJSDate(new Date(), {
        zone: hints.timeZone,
      }).toFormat(DATE_TIME_FORMAT);

      dataToUpdate.from = DateTime.fromFormat(fromDateStr, DATE_TIME_FORMAT, {
        zone: hints.timeZone,
      }).toJSDate();
    }

    /**
     * Pre-compute the kit IDs that the scanned kits belong to so we can
     * flip their status inside the tx. We also union the pre-existing
     * kits on the booking so kit status reflects reality after commit
     * (matches `checkoutBooking`'s behaviour).
     */
    const preExistingKitIds = getKitIdsByAssets(
      bookingFound.bookingAssets.map((ba) => ba.asset)
    );

    /**
     * Single atomic transaction:
     *   1. Materialise scanned assets against outstanding model requests
     *      + create `BookingAsset` rows (shared helper).
     *   2. Re-read bookingAssets inside the tx so the checkout writes
     *      operate on the post-scan snapshot (includes the scanned rows).
     *   3. Run the checkout writes (outstanding guard, qty availability,
     *      status flips) via the shared helper.
     *
     * If any guard throws — unfulfilled requests, insufficient pool,
     * unique constraint on an already-added asset — the whole tx rolls
     * back: the scanned materialisations, the BookingAsset rows, the
     * early-date adjustment, and the status transition are all reverted
     * together.
     */
    await db.$transaction(
      async (tx) => {
        await addScannedAssetsToBookingWithinTx(tx, {
          assetIds,
          kitIds,
          bookingId,
          organizationId,
          userId,
        });

        /**
         * Post-scan snapshot of every booking asset that needs
         * CHECKED_OUT status + quantity validation. Read inside tx so
         * newly created rows are visible.
         */
        const postScanBookingAssets = await tx.bookingAsset.findMany({
          where: { bookingId },
          select: {
            quantity: true,
            asset: {
              select: { id: true, title: true, type: true },
            },
          },
        });

        const qtyTrackedBookingAssets = postScanBookingAssets.filter((ba) =>
          isQuantityTracked(ba.asset)
        );
        const uniqueQtyTrackedAssetIds = Array.from(
          new Set(qtyTrackedBookingAssets.map((ba) => ba.asset.id))
        );
        const allBookingAssetIds = postScanBookingAssets.map(
          (ba) => ba.asset.id
        );

        // Union pre-existing kit ids with scanned kit ids so the
        // CHECKED_OUT flip covers both. (Dedup via Set.)
        const unionKitIds = Array.from(
          new Set([...preExistingKitIds, ...kitIds])
        );
        const hasKits = unionKitIds.length > 0;

        await checkoutBookingWritesWithinTx(tx, {
          bookingId,
          organizationId,
          bookingAssetIds: allBookingAssetIds,
          qtyTrackedBookingAssets,
          uniqueQtyTrackedAssetIds,
          dataToUpdate,
          kitIds: unionKitIds,
          hasKits,
        });

        /**
         * Activity events — mirrors `checkoutBooking`'s emission so the
         * combined fulfil-and-checkout flow produces the same per-asset
         * `BOOKING_CHECKED_OUT` rows as the standalone checkout path.
         * `allBookingAssetIds` is the post-scan snapshot: it covers both
         * pre-existing booking assets and the newly scanned ones, which
         * is the correct set for "assets that just transitioned to
         * CHECKED_OUT".
         */
        if (allBookingAssetIds.length > 0) {
          await recordEvents(
            allBookingAssetIds.map((assetId) => ({
              organizationId,
              actorUserId: userId,
              action: "BOOKING_CHECKED_OUT" as const,
              entityType: "BOOKING" as const,
              entityId: bookingId,
              bookingId,
              assetId,
            })),
            tx
          );
        }
      },
      { timeout: 15000 }
    );

    /** Post-commit: activity notes for the scanned assets + kits */
    await createNotesForScannedAssetsAndKits({
      booking: { id: bookingFound.id, name: bookingFound.name },
      assetIds,
      kitIds,
      organizationId,
      userId,
    });

    /** Build an effective snapshot so the status-transition note + email
     * scheduler see the post-checkout truth without re-reading the row. */
    const effectiveFrom =
      (dataToUpdate.from as Date | undefined) ?? bookingFound.from;
    const effectiveTo =
      (dataToUpdate.to as Date | undefined) ?? bookingFound.to;
    const effectiveStatus =
      (dataToUpdate.status as BookingStatus) ?? bookingFound.status;
    const effectiveBooking = {
      ...bookingFound,
      from: effectiveFrom,
      to: effectiveTo,
      status: effectiveStatus,
    };

    /** Post-commit checkout side-effects shared with `checkoutBooking` */
    return await runCheckoutSideEffects({
      bookingFound,
      userId,
      effectiveStatus,
      effectiveBooking,
      effectiveTo,
      hints,
      organizationId,
      isExpired,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while fulfilling reservations and checking out.",
      additionalData: {
        bookingId,
        organizationId,
        userId,
        assetIds,
        kitIds,
      },
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                       Quantity-aware check-in helpers                       */
/* -------------------------------------------------------------------------- */

/**
 * Category values from `ConsumptionLog` that count toward a booking's
 * per-asset "dispositioned so far" total. Any log with one of these
 * categories + the booking's id + an asset id consumes one slice of that
 * asset's booked quantity.
 *
 * - RETURN: unit came back to the pool (no `Asset.quantity` change)
 * - CONSUME: unit used as intended (ONE_WAY; pool decrement)
 * - LOSS / DAMAGE: unit gone (pool decrement, distinct for reporting)
 *
 * "Pending" units are *absence* of logs — tracked implicitly via
 * `remaining = BookingAsset.quantity − Σ(these categories)`.
 */
const CHECKIN_DISPOSITION_CATEGORIES = [
  "RETURN",
  "CONSUME",
  "LOSS",
  "DAMAGE",
] as const;

/**
 * Returns how many units of a QUANTITY_TRACKED asset still need to be
 * accounted for in a booking.
 *
 * `remaining = BookingAsset.quantity − Σ(RETURN+CONSUME+LOSS+DAMAGE logs
 * for this (bookingId, assetId) pair)`.
 *
 * The result is clamped to 0 as a defence-in-depth — if `BookingAsset
 * .quantity` is reduced below what's already been logged (which the
 * manage-assets guardrail should prevent), `remaining` would otherwise go
 * negative and confuse downstream callers.
 *
 * Safe to call inside a transaction — accepts a Prisma tx client.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param bookingId - Booking to measure against
 * @param assetId - Asset whose remaining quantity we want
 */
/**
 * Distributes a (booking, asset) pair's ConsumptionLog dispositions
 * across its BookingAsset rows for per-row "logged" reads.
 *
 * Logs with a non-null `bookingAssetId` are attributed exactly to
 * that row (the Polish-6+ contract). Logs with `bookingAssetId IS NULL`
 * (legacy rows + back-compat callers) are greedy-filled: kit-driven
 * rows first by `createdAt`, then standalone rows by `createdAt`, each
 * taking up to its booked quantity until the legacy pool is exhausted.
 *
 * Kit-driven slices fill first because they were created via an
 * automated path (kit add) that the user is unlikely to be returning
 * units against ad-hoc; attribute their fixed allocation as "done"
 * before opening the more flexible standalone pool.
 *
 * Returns a Map<bookingAssetId, dispositionedQuantity>. Rows with no
 * attribution are present in the map with `0`.
 *
 * Pure derivation — no DB calls. Caller pre-fetches the rows and logs.
 */
export function attributeDispositionsByBookingAsset(args: {
  bookingAssetRows: Array<{
    id: string;
    quantity: number;
    assetKitId: string | null;
  }>;
  consumptionLogs: Array<{
    bookingAssetId: string | null;
    quantity: number;
  }>;
}): Map<string, number> {
  const { bookingAssetRows, consumptionLogs } = args;
  const out = new Map<string, number>();
  for (const row of bookingAssetRows) out.set(row.id, 0);

  let legacyPool = 0;
  for (const log of consumptionLogs) {
    if (log.bookingAssetId) {
      out.set(
        log.bookingAssetId,
        (out.get(log.bookingAssetId) ?? 0) + (log.quantity ?? 0)
      );
    } else {
      legacyPool += log.quantity ?? 0;
    }
  }

  if (legacyPool === 0) return out;

  // Greedy fill: kit-driven first, then standalone. Within each bucket,
  // sort by `id` ascending — BookingAsset.id is a cuid, which is
  // chronologically sortable (creation-time prefix), so this stands in
  // for "by createdAt" without needing the column on the model.
  const ordered = [...bookingAssetRows].sort((a, b) => {
    const aIsKit = a.assetKitId != null;
    const bIsKit = b.assetKitId != null;
    if (aIsKit !== bIsKit) return aIsKit ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const row of ordered) {
    if (legacyPool === 0) break;
    const already = out.get(row.id) ?? 0;
    const capacity = Math.max(0, row.quantity - already);
    if (capacity === 0) continue;
    const take = Math.min(capacity, legacyPool);
    out.set(row.id, already + take);
    legacyPool -= take;
  }
  return out;
}

/** Per-category disposition split for a single BookingAsset row. */
export type DispositionCategoryBreakdown = {
  returned: number;
  consumed: number;
  lost: number;
  damaged: number;
};

/**
 * Like {@link attributeDispositionsByBookingAsset} but produces a
 * per-category breakdown (returned / consumed / lost / damaged) per
 * BookingAsset row, with capacity **shared across categories**.
 *
 * This is the correct primitive when you need both the per-row total
 * AND the category split. Naïvely running the simple attributor once
 * per category over-counts: each pass would refill a kit-driven row to
 * its full quantity, so RETURN + CONSUME + LOSS could each independently
 * fill the same 33-unit row to 33 (= 99 attributed against 33 booked).
 *
 * Here a single running total per row is shared: categories are
 * processed in a fixed order (RETURN → CONSUME → LOSS → DAMAGE) and each
 * row only accepts units up to its remaining capacity
 * (`quantity − runningTotal`). The per-category split of legacy
 * (`bookingAssetId IS NULL`) logs is therefore deterministic but
 * somewhat arbitrary — that's inherent to legacy data that never
 * recorded which slice each disposition hit. Logs WITH a
 * `bookingAssetId` are always attributed exactly.
 *
 * Pure derivation — no DB calls.
 */
export function attributeCategorizedDispositionsByBookingAsset(args: {
  bookingAssetRows: Array<{
    id: string;
    quantity: number;
    assetKitId: string | null;
  }>;
  consumptionLogs: Array<{
    bookingAssetId: string | null;
    category: "RETURN" | "CONSUME" | "LOSS" | "DAMAGE";
    quantity: number;
  }>;
}): Map<string, DispositionCategoryBreakdown> {
  const { bookingAssetRows, consumptionLogs } = args;

  const breakdown = new Map<string, DispositionCategoryBreakdown>();
  const runningTotal = new Map<string, number>();
  for (const row of bookingAssetRows) {
    breakdown.set(row.id, { returned: 0, consumed: 0, lost: 0, damaged: 0 });
    runningTotal.set(row.id, 0);
  }

  const CATEGORY_FIELD = {
    RETURN: "returned",
    CONSUME: "consumed",
    LOSS: "lost",
    DAMAGE: "damaged",
  } as const;

  // Exact pass: logs that already know their slice land precisely.
  const legacyByCategory = new Map<string, number>();
  for (const log of consumptionLogs) {
    if (log.bookingAssetId && breakdown.has(log.bookingAssetId)) {
      const b = breakdown.get(log.bookingAssetId)!;
      b[CATEGORY_FIELD[log.category]] += log.quantity ?? 0;
      runningTotal.set(
        log.bookingAssetId,
        (runningTotal.get(log.bookingAssetId) ?? 0) + (log.quantity ?? 0)
      );
    } else {
      legacyByCategory.set(
        log.category,
        (legacyByCategory.get(log.category) ?? 0) + (log.quantity ?? 0)
      );
    }
  }

  // Greedy pass: fill legacy pool category-by-category, kit-driven rows
  // first, respecting the SHARED running total so a row never exceeds
  // its booked quantity across all categories combined.
  const ordered = [...bookingAssetRows].sort((a, b) => {
    const aIsKit = a.assetKitId != null;
    const bIsKit = b.assetKitId != null;
    if (aIsKit !== bIsKit) return aIsKit ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (const category of ["RETURN", "CONSUME", "LOSS", "DAMAGE"] as const) {
    let pool = legacyByCategory.get(category) ?? 0;
    if (pool === 0) continue;
    for (const row of ordered) {
      if (pool === 0) break;
      const used = runningTotal.get(row.id) ?? 0;
      const capacity = Math.max(0, row.quantity - used);
      if (capacity === 0) continue;
      const take = Math.min(capacity, pool);
      breakdown.get(row.id)![CATEGORY_FIELD[category]] += take;
      runningTotal.set(row.id, used + take);
      pool -= take;
    }
  }

  return breakdown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeBookingAssetRemaining(
  tx: any,
  bookingId: Booking["id"],
  assetId: Asset["id"]
): Promise<number> {
  // The old `bookingId_assetId` composite unique was replaced by two
  // partial uniques (manual + kit-driven) so the same asset can have
  // multiple BookingAsset rows in one booking — sum the per-row
  // quantities to get the total booked for this (booking, asset)
  // pair. `ConsumptionLog` is still keyed by (bookingId, assetId)
  // alone (no per-row attribution), so its aggregate already covers
  // the booking-asset combination regardless of which slice the
  // check-in happened against.
  const [pivots, loggedSum] = await Promise.all([
    tx.bookingAsset.findMany({
      where: { bookingId, assetId },
      select: { quantity: true },
    }),
    tx.consumptionLog.aggregate({
      where: {
        assetId,
        bookingId,
        category: { in: CHECKIN_DISPOSITION_CATEGORIES },
      },
      _sum: { quantity: true },
    }),
  ]);

  const booked = (pivots as Array<{ quantity: number }>).reduce(
    (sum, p) => sum + (p.quantity ?? 0),
    0
  );
  const logged = loggedSum._sum?.quantity ?? 0;
  return Math.max(0, booked - logged);
}

/**
 * Remaining units for a SINGLE BookingAsset slice (Polish-7b per-row
 * check-in cap). Unlike {@link computeBookingAssetRemaining} (which sums
 * every slice of the asset), this bounds one slice:
 *
 *   `slice.quantity − Σ(ConsumptionLog tagged with this bookingAssetId)`
 *
 * Only logs explicitly attributed to this slice count — legacy
 * `bookingAssetId IS NULL` logs are intentionally excluded here. The
 * caller (`partialCheckinBooking`) takes `min(asset-level remaining,
 * slice remaining)` as the cap, so the asset-level guard still accounts
 * for those NULL logs and the total can never be over-checked-in.
 *
 * @param tx - Prisma transaction client (or the default `db` client)
 * @param bookingId - Booking the slice belongs to
 * @param bookingAssetId - The BookingAsset row id to measure
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function computeBookingAssetSliceRemaining(
  tx: any,
  bookingId: Booking["id"],
  bookingAssetId: string
): Promise<number> {
  const [slice, loggedSum] = await Promise.all([
    tx.bookingAsset.findUnique({
      where: { id: bookingAssetId },
      select: { quantity: true },
    }),
    tx.consumptionLog.aggregate({
      where: {
        bookingId,
        bookingAssetId,
        category: { in: CHECKIN_DISPOSITION_CATEGORIES },
      },
      _sum: { quantity: true },
    }),
  ]);

  const booked = (slice as { quantity: number } | null)?.quantity ?? 0;
  const logged = loggedSum._sum?.quantity ?? 0;
  return Math.max(0, booked - logged);
}

/**
 * Determines whether a booking has been fully checked in across all of
 * its assets.
 *
 * For `INDIVIDUAL` assets: each must appear in at least one
 * `PartialBookingCheckin.assetIds` row for this booking (existing
 * mechanism, unchanged).
 *
 * For `QUANTITY_TRACKED` assets: each must have
 * `computeBookingAssetRemaining` equal to 0 — i.e. every booked unit has
 * been dispositioned (returned, consumed, lost, or damaged).
 *
 * Called by both `partialCheckinBooking` and `checkinBooking` to decide
 * the ONGOING/OVERDUE → COMPLETE transition. Keeping this in one place
 * prevents the two code paths from drifting.
 *
 * @param tx - Prisma transaction client
 * @param bookingId - Booking to evaluate
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function isBookingFullyCheckedIn(
  tx: any,
  bookingId: Booking["id"]
): Promise<boolean> {
  const [bookingAssets, partialCheckins] = await Promise.all([
    tx.bookingAsset.findMany({
      where: { bookingId },
      select: {
        assetId: true,
        quantity: true,
        asset: { select: { id: true, type: true } },
      },
    }),
    tx.partialBookingCheckin.findMany({
      where: { bookingId },
      select: { assetIds: true },
    }),
  ]);

  if (bookingAssets.length === 0) {
    // An empty booking has nothing to check in — treat as complete.
    return true;
  }

  const individuallyCheckedInIds = new Set<string>();
  for (const row of partialCheckins) {
    for (const id of row.assetIds as string[]) {
      individuallyCheckedInIds.add(id);
    }
  }

  for (const ba of bookingAssets) {
    const isQtyTrackedAsset = ba.asset?.type === AssetType.QUANTITY_TRACKED;

    if (!isQtyTrackedAsset) {
      // INDIVIDUAL: must be in a partial-checkin session.
      if (!individuallyCheckedInIds.has(ba.assetId)) return false;
      continue;
    }

    // QUANTITY_TRACKED: must have zero remaining.
    const remaining = await computeBookingAssetRemaining(
      tx,
      bookingId,
      ba.assetId
    );
    if (remaining > 0) return false;
  }

  return true;
}

/* -------------------------------------------------------------------------- */

export async function checkinBooking({
  id,
  organizationId,
  hints,
  intentChoice,
  userId,
  specificAssetIds,
  checkins,
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  intentChoice?: CheckinIntentEnum;
  userId?: string;
  specificAssetIds?: string[];
  /**
   * Optional per-asset dispositions. When omitted, qty-tracked assets
   * on the booking default to "return all remaining" (TWO_WAY) or
   * "consume all remaining" (ONE_WAY) — the happy-path when the user hits
   * the big Check-in button without opening the scanner drawer.
   */
  checkins?: CheckinDispositionInput[];
}) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          bookingAssets: {
            include: {
              asset: {
                select: {
                  id: true,
                  type: true,
                  consumptionType: true,
                  title: true,
                  assetKits: { select: { kitId: true } },
                  status: true,
                  bookingAssets: {
                    select: {
                      booking: {
                        select: { id: true, status: true },
                      },
                    },
                    where: {
                      booking: {
                        status: {
                          in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          status: 404,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    const dataToUpdate: Prisma.BookingUpdateInput = {
      status: BookingStatus.COMPLETE,
    };

    /** Map bookingAssets to flat asset array for downstream logic */
    const bookingFoundAssets = bookingFound.bookingAssets.map((ba) => ba.asset);

    const kitIds = getKitIdsByAssets(bookingFoundAssets);
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
    bookingFoundAssets.forEach((asset) => {
      (asset.bookingAssets ?? []).forEach((ba) => {
        const linkedBooking = ba.booking;
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
        ? await db.partialBookingCheckin.findMany({
            where: {
              bookingId: { in: Array.from(linkedActiveBookingIds) },
            },
            select: { bookingId: true, assetIds: true },
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
    const assetsToCheckin = bookingFoundAssets
      .filter((asset) => {
        if (asset.status !== AssetStatus.CHECKED_OUT) {
          return false;
        }

        const hasActiveBookingConflict = (asset.bookingAssets ?? []).some(
          (ba) => {
            const linkedBooking = ba.booking;
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
          const kitAssetsInBooking = bookingFoundAssets.filter(
            (asset) => asset.assetKits?.[0]?.kitId === kitId
          );
          return kitAssetsInBooking.every(
            (asset) =>
              assetsToCheckinSet.has(asset.id) ||
              asset.status === AssetStatus.AVAILABLE
          );
        })
      : [];

    /**
     * Build the lookups of explicit dispositions. Qty-tracked slices
     * without an explicit entry will auto-fill their remaining quantity
     * inside the transaction (default: RETURN all for TWO_WAY, CONSUME
     * all for ONE_WAY). This is the "big Check-in button" happy path —
     * everything's back.
     *
     * Two maps because a caller can target a disposition either:
     *   - at a specific slice (`bookingAssetId` set) — exact attribution,
     *     consumed once for that slice; OR
     *   - at the asset as a whole (`bookingAssetId` omitted) — legacy /
     *     drawer-less callers. An asset-level explicit disposition is
     *     applied to exactly ONE slice (see `consumedAssetLevelExplicit`
     *     below) so it isn't double-counted across every slice.
     */
    const explicitByBookingAssetId = new Map<string, CheckinDispositionInput>(
      checkins
        ?.filter((d) => d.bookingAssetId)
        .map((d) => [d.bookingAssetId!, d]) ?? []
    );
    const explicitByAssetId = new Map<string, CheckinDispositionInput>(
      checkins?.filter((d) => !d.bookingAssetId).map((d) => [d.assetId, d]) ??
        []
    );

    /**
     * Per-BookingAsset SLICE rows for qty-tracked assets. The same asset
     * can have multiple slices in one booking (one standalone +
     * N kit-driven), and each slice's ConsumptionLog rows must be tagged
     * with its own `bookingAssetId`. We carry the slice `id`, `assetId`
     * and `quantity` from the org-scoped `bookingFound.bookingAssets`
     * load at the top of this function.
     */
    const qtyTrackedSlices = bookingFound.bookingAssets
      .filter((ba) => ba.asset.type === AssetType.QUANTITY_TRACKED)
      .map((ba) => ({
        id: ba.id,
        assetId: ba.assetId,
        consumptionType: ba.asset.consumptionType,
        title: ba.asset.title,
      }));

    /** Distinct qty-tracked asset ids touched by the slices above. */
    const qtyTrackedAssetIds = [
      ...new Set(qtyTrackedSlices.map((s) => s.assetId)),
    ];

    /**
     * Per-asset disposition summary populated inside the transaction
     * (used AFTER the transaction for the quantity-aware activity note).
     */
    type CheckinQtySummary = {
      assetId: string;
      title: string;
      returned: number;
      consumed: number;
      lost: number;
      damaged: number;
    };

    const qtySummariesRef: { value: CheckinQtySummary[] } = { value: [] };

    const updatedBooking = await db.$transaction(
      async (tx) => {
        /**
         * Per-qty-tracked-asset disposition work. Runs FIRST so the
         * pool-drain guard can read the current `Asset.quantity` before
         * downstream status flips. Uses the Phase 2 row-lock pattern.
         */
        /**
         * ConsumptionLog rows require an attributed user. `checkinBooking`
         * permits `userId === undefined` (legacy signature), but we can't
         * write logs without one. If the booking has qty-tracked assets
         * with remaining units, userId must be provided.
         */
        if (qtyTrackedAssetIds.length > 0 && !userId) {
          // Check if any qty-tracked asset actually has work to do.
          for (const assetId of qtyTrackedAssetIds) {
            const remaining = await computeBookingAssetRemaining(
              tx,
              id,
              assetId
            );
            if (remaining > 0) {
              throw new ShelfError({
                cause: null,
                status: 400,
                label,
                message:
                  "Internal error: userId is required to check in a booking with quantity-tracked assets.",
              });
            }
          }
        }

        /**
         * Per-asset running pool of remaining units, seeded once from the
         * asset-level `computeBookingAssetRemaining`. As each slice claims
         * units we decrement this so the SUM across all slices of one asset
         * can never exceed the asset-level remaining — the backstop that
         * accounts for legacy `bookingAssetId IS NULL` logs which the
         * per-slice helper deliberately excludes.
         */
        const assetRemainingSoFar = new Map<string, number>();
        for (const assetId of qtyTrackedAssetIds) {
          assetRemainingSoFar.set(
            assetId,
            await computeBookingAssetRemaining(tx, id, assetId)
          );
        }

        /**
         * Asset-level explicit dispositions (no `bookingAssetId`) apply to
         * exactly ONE slice. Track which asset ids have already consumed
         * their asset-level explicit so later slices fall back to the
         * auto-default rather than re-applying it.
         */
        const consumedAssetLevelExplicit = new Set<string>();

        /**
         * Accumulate per-slice work into ONE summary per assetId so the
         * post-tx activity note (which renders per asset) isn't duplicated
         * when an asset has multiple slices.
         */
        const summaryByAssetId = new Map<string, CheckinQtySummary>();

        for (const slice of qtyTrackedSlices) {
          const sliceRemaining = await computeBookingAssetSliceRemaining(
            tx,
            id,
            slice.id
          );
          if (sliceRemaining <= 0) continue; // Already reconciled.

          // Cap by BOTH the slice's own remaining AND the asset-level
          // remaining still unclaimed in this pass. The asset-level cap is
          // the safety net for legacy NULL-tagged logs (excluded by the
          // per-slice helper) — without it, an asset with both tagged and
          // NULL logs could over-decrement the shared pool.
          const assetCap = assetRemainingSoFar.get(slice.assetId) ?? 0;
          const cap = Math.min(sliceRemaining, assetCap);
          if (cap <= 0) continue;

          // Resolve the effective disposition: explicit-by-slice wins;
          // else an asset-level explicit applied to ONE slice only; else
          // the auto-default based on consumptionType (capped to `cap`).
          let explicit = explicitByBookingAssetId.get(slice.id);
          if (!explicit) {
            const assetExplicit = explicitByAssetId.get(slice.assetId);
            if (
              assetExplicit &&
              !consumedAssetLevelExplicit.has(slice.assetId)
            ) {
              explicit = assetExplicit;
              consumedAssetLevelExplicit.add(slice.assetId);
            }
          }

          const disposition: CheckinDispositionInput = explicit ?? {
            assetId: slice.assetId,
            // Auto-default claims exactly `cap` units — never more than the
            // pool can cover, so it can't throw on legacy-NULL-reduced pools.
            ...(slice.consumptionType === "ONE_WAY"
              ? { consumed: cap }
              : { returned: cap }),
          };

          const claimed = sumDisposition(disposition);
          if (claimed === 0) {
            // Explicit disposition with no quantities — "leave pending".
            continue;
          }

          // Explicit dispositions that over-claim are a hard error (the
          // caller asked for more than is available). The auto-default
          // path is pre-clamped to `cap` above, so it never trips this.
          if (claimed > cap) {
            throw new ShelfError({
              cause: null,
              status: 400,
              label,
              message: `Cannot check in ${claimed} units for "${slice.title}". Only ${cap} remaining on this booking.`,
              shouldBeCaptured: false,
            });
          }

          const locked = await lockAssetForQuantityUpdate(tx, slice.assetId);

          const poolDecrement =
            (disposition.consumed ?? 0) +
            (disposition.lost ?? 0) +
            (disposition.damaged ?? 0);

          if (poolDecrement > 0) {
            const custodyAgg = await tx.custody.aggregate({
              where: { assetId: slice.assetId },
              _sum: { quantity: true },
            });
            const inCustody = custodyAgg._sum?.quantity ?? 0;
            const projected = (locked.quantity ?? 0) - poolDecrement;
            if (projected < inCustody) {
              throw new ShelfError({
                cause: null,
                status: 400,
                label,
                message: `Cannot remove ${poolDecrement} units from "${locked.title}" — ${inCustody} are currently in custody and would be left uncovered.`,
                shouldBeCaptured: false,
              });
            }
          }

          // Always tag the slice id. An explicit disposition may already
          // carry its own `bookingAssetId` (drawer flow that picked a
          // specific slice) — honour that; otherwise tag with this slice's
          // id so the auto-default path no longer writes NULL.
          const dispBookingAssetId = disposition.bookingAssetId ?? slice.id;
          if ((disposition.returned ?? 0) > 0) {
            await createConsumptionLog({
              assetId: slice.assetId,
              category: "RETURN",
              quantity: disposition.returned!,
              userId: userId!,
              bookingId: id,
              bookingAssetId: dispBookingAssetId,
              tx,
            });
          }
          if ((disposition.consumed ?? 0) > 0) {
            await createConsumptionLog({
              assetId: slice.assetId,
              category: "CONSUME",
              quantity: disposition.consumed!,
              userId: userId!,
              bookingId: id,
              bookingAssetId: dispBookingAssetId,
              tx,
            });
          }
          if ((disposition.lost ?? 0) > 0) {
            await createConsumptionLog({
              assetId: slice.assetId,
              category: "LOSS",
              quantity: disposition.lost!,
              userId: userId!,
              bookingId: id,
              bookingAssetId: dispBookingAssetId,
              tx,
            });
          }
          if ((disposition.damaged ?? 0) > 0) {
            await createConsumptionLog({
              assetId: slice.assetId,
              category: "DAMAGE",
              quantity: disposition.damaged!,
              userId: userId!,
              bookingId: id,
              bookingAssetId: dispBookingAssetId,
              tx,
            });
          }

          if (poolDecrement > 0) {
            await tx.asset.update({
              // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `slice.assetId` comes from `bookingFound.bookingAssets` loaded org-scoped via findUniqueOrThrow({where:{id,organizationId}}) at the top of checkinBooking
              where: { id: slice.assetId },
              data: { quantity: { decrement: poolDecrement } },
            });
          }

          // Decrement the per-asset running pool by the amount claimed so
          // the next slice of the same asset can't re-claim it.
          assetRemainingSoFar.set(slice.assetId, assetCap - claimed);

          // Fold this slice's work into the per-asset summary.
          const existing = summaryByAssetId.get(slice.assetId) ?? {
            assetId: slice.assetId,
            title: locked.title,
            returned: 0,
            consumed: 0,
            lost: 0,
            damaged: 0,
          };
          existing.returned += disposition.returned ?? 0;
          existing.consumed += disposition.consumed ?? 0;
          existing.lost += disposition.lost ?? 0;
          existing.damaged += disposition.damaged ?? 0;
          summaryByAssetId.set(slice.assetId, existing);
        }

        qtySummariesRef.value.push(...summaryByAssetId.values());

        if (assetsToCheckin.length > 0) {
          // INDIVIDUAL assets always get reset to AVAILABLE. Scope to the
          // caller's org (cross-org IDOR defence) on top of the type filter.
          await tx.asset.updateMany({
            where: {
              id: { in: assetsToCheckin },
              type: AssetType.INDIVIDUAL,
              organizationId,
            },
            data: { status: AssetStatus.AVAILABLE },
          });

          // QUANTITY_TRACKED assets: only reset to AVAILABLE if they have
          // no other active bookings (ONGOING/OVERDUE) and no custody records
          const qtyAssetIds = bookingFoundAssets
            .filter(
              (a) =>
                a.type === "QUANTITY_TRACKED" && assetsToCheckin.includes(a.id)
            )
            .map((a) => a.id);

          if (qtyAssetIds.length > 0) {
            for (const assetId of qtyAssetIds) {
              const [otherBookings, custodyCount] = await Promise.all([
                tx.bookingAsset.count({
                  where: {
                    assetId,
                    bookingId: { not: id },
                    booking: {
                      status: {
                        in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                      },
                    },
                  },
                }),
                tx.custody.count({ where: { assetId } }),
              ]);

              if (otherBookings === 0 && custodyCount === 0) {
                await tx.asset.update({
                  // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` comes from `bookingFoundAssets` loaded org-scoped via findUniqueOrThrow({where:{id,organizationId}}) at the top of checkinBooking
                  where: { id: assetId },
                  data: { status: AssetStatus.AVAILABLE },
                });
              }
            }
          }
        }
        /* If there are any kits associated with the booking, then update their status */
        if (hasKits) {
          if (kitsToCheckin.length > 0) {
            await tx.kit.updateMany({
              where: { id: { in: kitsToCheckin }, organizationId },
              data: { status: KitStatus.AVAILABLE },
            });
          }
        }

        // Activity events — one BOOKING_CHECKED_IN per asset, inside the tx.
        // Must be atomic with booking status update for audit trail consistency.
        // Walk the `bookingAssets` pivot to reach each asset.
        if (bookingFound.bookingAssets.length > 0) {
          await recordEvents(
            bookingFound.bookingAssets.map((ba) => ({
              organizationId,
              actorUserId: userId ?? null,
              action: "BOOKING_CHECKED_IN",
              entityType: "BOOKING",
              entityId: bookingFound.id,
              bookingId: bookingFound.id,
              assetId: ba.asset.id,
            })),
            tx
          );
        }

        /** Finally update the booking */
        return tx.booking.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingFound id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L1552; this is the write on that same proven id
          where: { id: bookingFound.id },
          data: dataToUpdate,
          include: {
            ...BOOKING_INCLUDE_FOR_EMAIL,
            bookingAssets: {
              include: {
                asset: {
                  select: {
                    id: true,
                    assetKits: { select: { kitId: true } },
                  },
                },
              },
            },
          },
        });
      },
      { timeout: 15000 }
    );

    // Create status transition note
    if (userId) {
      if (specificAssetIds && specificAssetIds.length > 0) {
        // Create enhanced completion message with asset details
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });

        // Get asset and kit data for consistent formatting
        const assetsWithKitInfo = await db.asset.findMany({
          where: { id: { in: specificAssetIds }, organizationId },
          select: {
            id: true,
            title: true,
            assetKits: {
              select: { kit: { select: { id: true, name: true } } },
            },
          },
        });

        // Separate complete kits from individual assets
        const kitIds = getKitIdsByAssets(
          (updatedBooking.bookingAssets || [])
            .map((ba) => ba.asset)
            .filter((a) => specificAssetIds?.includes(a.id))
        );
        const completeKits: Array<{ id: string; name: string }> = [];
        const standaloneAssets: Array<{ id: string; title: string }> = [];
        const processedKitIds = new Set<string>();

        for (const asset of assetsWithKitInfo) {
          const assetKit = asset.assetKits?.[0]?.kit;
          if (
            assetKit &&
            kitIds.includes(assetKit.id) &&
            !processedKitIds.has(assetKit.id)
          ) {
            completeKits.push({ id: assetKit.id, name: assetKit.name });
            processedKitIds.add(assetKit.id);
          } else if (!assetKit) {
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
          organizationId,
          content: `${wrapUserLinkForNote(
            user!
          )} performed a partial check-in: ${itemsDescription} and completed the booking. Status changed from ${fromStatusBadge} to ${toStatusBadge}`,
        });

        // Record the canonical status transition event for reports.
        // The custom system note above replaces the standard transition note,
        // but downstream consumers (Booking Compliance report) still need the
        // BOOKING_STATUS_CHANGED → COMPLETE ActivityEvent to know when the
        // booking was actually checked in. Best-effort, mirroring the pattern
        // inside createStatusTransitionNote.
        try {
          await recordEvent({
            organizationId,
            // We're inside `if (userId)` — `userId` is a string here.
            actorUserId: userId,
            action: "BOOKING_STATUS_CHANGED",
            entityType: "BOOKING",
            entityId: updatedBooking.id,
            bookingId: updatedBooking.id,
            field: "status",
            fromValue: bookingFound.status,
            toValue: BookingStatus.COMPLETE,
          });
        } catch (err) {
          Logger.error(
            new ShelfError({
              cause: err,
              message:
                "Failed to record BOOKING_STATUS_CHANGED event for partial check-in completion",
              additionalData: {
                bookingId: updatedBooking.id,
                fromStatus: bookingFound.status,
              },
              label,
            })
          );
        }
      } else {
        // Standard status transition note
        await createStatusTransitionNote({
          bookingId: updatedBooking.id,
          organizationId,
          fromStatus: bookingFound.status,
          toStatus: BookingStatus.COMPLETE,
          userId,
          custodianUserId: updatedBooking.custodianUserId || undefined,
        });
      }
    }

    /**
     * Per-asset notes for qty-tracked dispositions applied in this
     * check-in. Wrapped in try/catch — activity logging must never
     * fail a successful check-in. See the matching pattern in
     * `partialCheckinBooking` and `manage-assets`.
     */
    if (userId && qtySummariesRef.value.length > 0) {
      try {
        const actorUser = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: actorUser?.firstName,
          lastName: actorUser?.lastName,
        });

        /**
         * Shared booking link — per-asset notes point back to the booking
         * so the asset's activity feed shows which booking consumed /
         * returned / lost the units.
         */
        const bookingLink = wrapLinkForNote(
          `/bookings/${updatedBooking.id}`,
          updatedBooking.name
        );

        for (const summary of qtySummariesRef.value) {
          const parts: string[] = [];
          if (summary.returned > 0)
            parts.push(`returned **${summary.returned}**`);
          if (summary.consumed > 0)
            parts.push(`consumed **${summary.consumed}**`);
          if (summary.lost > 0) parts.push(`**${summary.lost}** lost`);
          if (summary.damaged > 0) parts.push(`**${summary.damaged}** damaged`);

          if (parts.length > 0) {
            await createNotes({
              content: `${actor} via check-in on ${bookingLink}: ${parts.join(
                ", "
              )}.`,
              type: "UPDATE",
              userId,
              assetIds: [summary.assetId],
              organizationId,
            });
          }
        }

        // Booking-side summary for qty-tracked dispositions — one line
        // per asset with a clickable link + non-zero category parts so
        // the operator can see WHICH assets were touched, not just
        // aggregate totals. Previously this note conflated everything
        // into "10 returned, 2 lost" with no asset names.
        const perAssetFragment = buildQtyPerAssetFragment(
          qtySummariesRef.value
        );
        if (perAssetFragment) {
          await createSystemBookingNote({
            bookingId: updatedBooking.id,
            organizationId,
            content: `${actor} dispositioned quantity-tracked assets: ${perAssetFragment}.`,
          });
        }
      } catch (noteError) {
        Logger.error(
          new ShelfError({
            cause: noteError,
            message: "Failed to write quantity check-in activity notes",
            label,
            additionalData: { userId, bookingId: id },
          })
        );
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
    const bookingSettings = await db.bookingSettings.findUnique({
      where: { organizationId: updatedBooking.organizationId },
      select: {
        autoArchiveBookings: true,
        autoArchiveDays: true,
      },
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

    // Resolve notification recipients and send personalized emails
    const recipients = await getBookingNotificationRecipients({
      booking: updatedBooking,
      eventType: "CHECKIN",
      organizationId: updatedBooking.organizationId,
      editorUserId: userId,
    });

    if (recipients.length > 0) {
      const custodian =
        resolveUserDisplayName(updatedBooking.custodianUser) ||
        updatedBooking.custodianTeamMember?.name ||
        "";

      const text = completedBookingEmailContent({
        bookingName: updatedBooking.name,
        assetsCount: updatedBooking._count.bookingAssets,
        custodian,
        from: updatedBooking.from!,
        to: updatedBooking.to!,
        bookingId: updatedBooking.id,
        hints,
        customEmailFooter: updatedBooking.organization.customEmailFooter,
      });

      await sendBookingEmailToAllRecipients({
        recipients,
        booking: updatedBooking,
        subject: `🎉 Booking complete (${updatedBooking.name}) - shelf.nu`,
        textContent: text,
        heading: `Your booking has been completed: "${updatedBooking.name}"`,
        hints,
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

/**
 * Per-asset disposition entry accepted by the check-in service functions.
 *
 * See `checkinDispositionSchema` in
 * `components/scanner/drawer/uses/partial-checkin-drawer.tsx` for the
 * corresponding Zod schema / payload documentation.
 */
export type CheckinDispositionInput = {
  assetId: string;
  /**
   * Per-row attribution for QUANTITY_TRACKED assets with multiple
   * BookingAsset slices (kit-driven + standalone). When set the
   * ConsumptionLog rows get this `bookingAssetId` so future reads
   * can attribute the disposition to the right slice. Optional for
   * back-compat with callers that pre-date Polish-6 per-row support
   * (mobile API, simple `assetIds`-only check-ins) — those write
   * `bookingAssetId: null` and rely on the greedy-fill fallback in
   * the loaders.
   */
  bookingAssetId?: string | null;
  returned?: number;
  consumed?: number;
  lost?: number;
  damaged?: number;
};

/**
 * Sum of all "claimed" units in a single check-in disposition — i.e. the
 * ones that reduce `remaining` for the (booking, asset) pair. Pending
 * units are never submitted explicitly; they emerge from the gap between
 * remaining and this sum.
 */
function sumDisposition(d: CheckinDispositionInput): number {
  return (
    (d.returned ?? 0) + (d.consumed ?? 0) + (d.lost ?? 0) + (d.damaged ?? 0)
  );
}

/**
 * Build a markdoc fragment naming each qty-tracked asset touched in
 * this session along with its per-category disposition. Used by the
 * booking-side activity note for both `partialCheckinBooking` and
 * `checkinBooking` so the operator can see WHICH assets were
 * dispositioned — not just aggregate totals.
 *
 * Produces something like:
 *   `{% link to="/assets/<id>" text="Pens" /%} (10 returned), {% link
 *    to="/assets/<id>" text="AA Batteries" /%} (5 consumed, 2 damaged)`
 *
 * Returns an empty string when no row has any non-zero disposition,
 * so callers can safely concatenate without extra guards.
 */
function buildQtyPerAssetFragment(
  summaries: Array<{
    assetId: string;
    title: string;
    returned: number;
    consumed: number;
    lost: number;
    damaged: number;
    pendingAfter?: number;
  }>
): string {
  const fragments: string[] = [];
  for (const s of summaries) {
    const parts: string[] = [];
    if (s.returned > 0) parts.push(`${s.returned} returned`);
    if (s.consumed > 0) parts.push(`${s.consumed} consumed`);
    if (s.lost > 0) parts.push(`${s.lost} lost`);
    if (s.damaged > 0) parts.push(`${s.damaged} damaged`);
    if (s.pendingAfter && s.pendingAfter > 0) {
      parts.push(`${s.pendingAfter} pending`);
    }
    if (parts.length === 0) continue;
    const link = wrapLinkForNote(`/assets/${s.assetId}`, s.title);
    fragments.push(`${link} (${parts.join(", ")})`);
  }
  return fragments.join(", ");
}

export async function partialCheckinBooking({
  id,
  organizationId,
  assetIds,
  checkins,
  userId,
  hints,
  intentChoice,
}: Pick<Booking, "id" | "organizationId"> & {
  /** Legacy payload — asset IDs only, no per-asset quantities. */
  assetIds?: Asset["id"][];
  /** Per-asset dispositions (takes precedence over `assetIds`). */
  checkins?: CheckinDispositionInput[];
  userId: User["id"];
  hints: ClientHint;
  intentChoice?: CheckinIntentEnum;
}) {
  try {
    /**
     * Resolve the effective per-asset payload. Callers MAY pass either
     * or BOTH of:
     *   - `checkins` — per-asset disposition for QUANTITY_TRACKED assets
     *     (new drawer flow)
     *   - `assetIds` — flat asset-id list (legacy callers + INDIVIDUAL
     *     assets in the new drawer, which don't carry dispositions)
     *
     * When a mixed drawer session scans an INDIVIDUAL asset AND a
     * qty-tracked asset with a disposition, BOTH arrays arrive
     * populated. We merge them: every entry in `checkins` is used
     * verbatim, and any `assetIds` entry not already covered by
     * `checkins` is added as a no-disposition entry (the INDIVIDUAL
     * status-update branch below picks them up).
     *
     * Treating the two as mutually exclusive was a regression —
     * INDIVIDUAL scans would silently drop out whenever a qty-tracked
     * disposition was in the same submit.
     */
    const dispositions: CheckinDispositionInput[] = [];
    /**
     * Dedup key for `checkins`: `(assetId, bookingAssetId)`. Polish-7b
     * allows MULTIPLE dispositions for the same asset in one submit — one
     * per BookingAsset slice (kit-driven + standalone) — so we must NOT
     * collapse by `assetId`. A repeated (assetId, bookingAssetId) pair
     * (double-submit of the same slice) still collapses to one. Legacy
     * callers omit `bookingAssetId`, so they key on `assetId::null` and
     * behave exactly as before (one entry per asset).
     */
    const seenDispositionKeys = new Set<string>();
    const assetIdsWithDisposition = new Set<string>();
    for (const d of checkins ?? []) {
      const key = `${d.assetId}::${d.bookingAssetId ?? "null"}`;
      if (seenDispositionKeys.has(key)) continue;
      seenDispositionKeys.add(key);
      dispositions.push(d);
      assetIdsWithDisposition.add(d.assetId);
    }
    /**
     * INDIVIDUAL scans (and legacy `assetIds`-only callers) arrive via
     * `assetIds`. Add a no-disposition entry for any asset not already
     * covered by a `checkins` entry — the INDIVIDUAL status-update branch
     * below picks them up. Treating the two arrays as mutually exclusive
     * was a regression: INDIVIDUAL scans dropped out whenever a qty
     * disposition shared the submit.
     */
    for (const assetId of assetIds ?? []) {
      if (!assetIdsWithDisposition.has(assetId)) {
        assetIdsWithDisposition.add(assetId);
        dispositions.push({ assetId });
      }
    }

    if (dispositions.length === 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: "No assets provided for check-in.",
        shouldBeCaptured: false,
      });
    }

    /** Derived flat asset-id list used by the existing kit/status logic. */
    const effectiveAssetIds = dispositions.map((d) => d.assetId);

    /**
     * True when any disposition in this payload carries non-zero quantity
     * fields. Used to decide whether to skip the "all remaining scanned →
     * redirect to checkinBooking" early-exit: per-asset qty logic must run
     * in this function's transaction so we don't split the work across
     * two services.
     */
    const hasQuantityDispositions = dispositions.some(
      (d) => sumDisposition(d) > 0
    );

    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    // First, validate the booking exists and get its current assets
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          bookingAssets: {
            include: {
              asset: {
                select: {
                  id: true,
                  type: true,
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          status: 404,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /** Map bookingAssets to flat asset array for downstream logic */
    const bookingFoundAssets = bookingFound.bookingAssets.map((ba) => ba.asset);

    /** Types keyed by assetId — lets per-asset branches pick the right code path. */
    const assetTypeById = new Map<string, AssetType>(
      bookingFoundAssets.map((a) => [a.id, a.type])
    );

    // Validate that every asset in the payload is actually on the booking.
    const bookingAssetIds = new Set(bookingFoundAssets.map((a) => a.id));
    const invalidAssetIds = effectiveAssetIds.filter(
      (id_) => !bookingAssetIds.has(id_)
    );
    if (invalidAssetIds.length > 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        label,
        message: `Some assets are not part of this booking: ${invalidAssetIds.join(
          ", "
        )}`,
        shouldBeCaptured: false,
      });
    }

    // Qty-tracked assets MUST carry at least one non-zero disposition.
    // The drawer surfaces this as a blocker before submission, but we
    // defend server-side too.
    for (const d of dispositions) {
      const isQty = assetTypeById.get(d.assetId) === AssetType.QUANTITY_TRACKED;
      if (isQty && sumDisposition(d) === 0) {
        throw new ShelfError({
          cause: null,
          status: 400,
          label,
          message:
            "Quantity-tracked assets must include at least one non-zero disposition (returned, consumed, lost, or damaged).",
          shouldBeCaptured: false,
        });
      }
    }

    // Early exit: legacy "all remaining CHECKED_OUT assets scanned → redirect
    // to full check-in" path. Only safe when no qty dispositions are in play,
    // because per-asset qty work needs to run in this function's transaction
    // (so we don't split consumption-log writes across two services).
    if (!hasQuantityDispositions) {
      const currentAssetStatuses = await db.asset.findMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `bookingFoundAssets` derive from the booking loaded org-scoped via findUniqueOrThrow({where:{id,organizationId}}) in partialCheckinBooking
        where: { id: { in: bookingFoundAssets.map((a) => a.id) } },
        select: { id: true, status: true },
      });
      const checkedOutAssetIds = new Set(
        currentAssetStatuses
          .filter((a) => a.status === AssetStatus.CHECKED_OUT)
          .map((a) => a.id)
      );
      const providedAssetIds = new Set(effectiveAssetIds);

      if (
        checkedOutAssetIds.size > 0 &&
        checkedOutAssetIds.size === providedAssetIds.size &&
        [...checkedOutAssetIds].every((id_) => providedAssetIds.has(id_))
      ) {
        // Don't create a PartialBookingCheckin row — the redirect to
        // `checkinBooking` handles completion itself.
        const actor = wrapUserLinkForNote({
          id: userId,
          firstName: user?.firstName,
          lastName: user?.lastName,
        });
        await createNotes({
          content: `${actor} checked in via explicit check-in scanner. All assets were scanned, so complete check-in was performed.`,
          type: "UPDATE",
          userId,
          assetIds: effectiveAssetIds,
          organizationId,
        });

        const completedBooking = await checkinBooking({
          id,
          organizationId,
          hints,
          intentChoice,
          userId,
          specificAssetIds: effectiveAssetIds,
        });

        return {
          booking: completedBooking,
          checkedInAssetCount: effectiveAssetIds.length,
          remainingAssetCount: 0,
          isComplete: true,
        };
      }
    }

    // For kits: only flip kit status if ALL of its assets are being checked
    // in this session. Qty-tracked assets aren't kitted, so this logic only
    // applies to individuals.
    const assetsBeingCheckedIn = bookingFoundAssets.filter((a) =>
      effectiveAssetIds.includes(a.id)
    );
    const kitIdsBeingCheckedIn = getKitIdsByAssets(assetsBeingCheckedIn);

    const completeKitIds: string[] = [];
    for (const kitId of kitIdsBeingCheckedIn) {
      const kitAssetsInBooking = bookingFoundAssets.filter(
        (a) => a.assetKits?.[0]?.kitId === kitId
      );
      const kitAssetsBeingCheckedIn = assetsBeingCheckedIn.filter(
        (a) => a.assetKits?.[0]?.kitId === kitId
      );

      if (kitAssetsInBooking.length === kitAssetsBeingCheckedIn.length) {
        completeKitIds.push(kitId);
      }
    }

    /**
     * Per-asset disposition summary — populated inside the transaction as
     * each qty-tracked asset is processed. Used AFTER the transaction for
     * activity notes (kept outside the tx so a markdoc hiccup can't roll
     * back a valid check-in).
     */
    type QtyDispositionSummary = {
      assetId: string;
      title: string;
      returned: number;
      consumed: number;
      lost: number;
      damaged: number;
      /** Units still outstanding after this session (implicit "pending"). */
      pendingAfter: number;
    };

    const txResult = await db.$transaction(async (tx) => {
      /**
       * Per-asset quantity dispositions for QUANTITY_TRACKED assets.
       * Runs before the status updates so the pool-drain guard can
       * read the current `Asset.quantity`. Uses the row-lock pattern
       * to serialize concurrent check-in sessions on the same asset.
       */
      const qtySummaries: QtyDispositionSummary[] = [];
      const fullyReconciledQtyAssetIds: string[] = [];

      for (const disp of dispositions) {
        if (assetTypeById.get(disp.assetId) !== AssetType.QUANTITY_TRACKED) {
          continue;
        }

        const lockedAsset = await lockAssetForQuantityUpdate(tx, disp.assetId);

        /**
         * Re-query remaining inside the transaction, AFTER the lock. This
         * closes the race with another check-in session that committed
         * between our loader read and our tx start.
         */
        const remaining = await computeBookingAssetRemaining(
          tx,
          id,
          disp.assetId
        );
        const claimed = sumDisposition(disp);

        /**
         * Per-slice cap (Polish-7b): when the drawer targets a specific
         * BookingAsset slice, bound the claim by BOTH the slice's own
         * remaining AND the asset-level remaining. The asset-level guard
         * still backstops the total (and counts legacy NULL-tagged logs),
         * while the slice guard stops one slice over-claiming into
         * another. Legacy callers omit `bookingAssetId` → asset-level cap
         * only, unchanged.
         */
        let cap = remaining;
        if (disp.bookingAssetId) {
          const sliceRemaining = await computeBookingAssetSliceRemaining(
            tx,
            id,
            disp.bookingAssetId
          );
          cap = Math.min(cap, sliceRemaining);
        }

        if (claimed > cap) {
          throw new ShelfError({
            cause: null,
            status: 400,
            label,
            message: `Cannot check in ${claimed} units for "${lockedAsset.title}". Only ${cap} remaining on this booking.`,
            shouldBeCaptured: false,
          });
        }

        const poolDecrement =
          (disp.consumed ?? 0) + (disp.lost ?? 0) + (disp.damaged ?? 0);

        /**
         * Pool-drain guard: `Asset.quantity` must stay ≥ current custody
         * sum. Mirrors the invariant from `adjustQuantity` — we never let
         * the physical pool drop below what team members are holding.
         */
        if (poolDecrement > 0) {
          const custodyAgg = await tx.custody.aggregate({
            where: { assetId: disp.assetId },
            _sum: { quantity: true },
          });
          const inCustody = custodyAgg._sum?.quantity ?? 0;
          const projected = (lockedAsset.quantity ?? 0) - poolDecrement;
          if (projected < inCustody) {
            throw new ShelfError({
              cause: null,
              status: 400,
              label,
              message: `Cannot remove ${poolDecrement} units from "${lockedAsset.title}" — ${inCustody} are currently in custody and would be left uncovered.`,
              shouldBeCaptured: false,
            });
          }
        }

        // One ConsumptionLog per non-zero category, all scoped to this booking.
        // `bookingAssetId` carries per-row attribution when the caller knows
        // the slice (drawer post-Polish-6); legacy callers leave it null and
        // the loader's greedy-fill handles them on read.
        const dispBookingAssetId = disp.bookingAssetId ?? null;
        if ((disp.returned ?? 0) > 0) {
          await createConsumptionLog({
            assetId: disp.assetId,
            category: "RETURN",
            quantity: disp.returned!,
            userId,
            bookingId: id,
            bookingAssetId: dispBookingAssetId,
            tx,
          });
        }
        if ((disp.consumed ?? 0) > 0) {
          await createConsumptionLog({
            assetId: disp.assetId,
            category: "CONSUME",
            quantity: disp.consumed!,
            userId,
            bookingId: id,
            bookingAssetId: dispBookingAssetId,
            tx,
          });
        }
        if ((disp.lost ?? 0) > 0) {
          await createConsumptionLog({
            assetId: disp.assetId,
            category: "LOSS",
            quantity: disp.lost!,
            userId,
            bookingId: id,
            bookingAssetId: dispBookingAssetId,
            tx,
          });
        }
        if ((disp.damaged ?? 0) > 0) {
          await createConsumptionLog({
            assetId: disp.assetId,
            category: "DAMAGE",
            quantity: disp.damaged!,
            userId,
            bookingId: id,
            bookingAssetId: dispBookingAssetId,
            tx,
          });
        }

        // Decrement the pool for CONSUME/LOSS/DAMAGE only. RETURN leaves
        // the pool alone — the unit is back where it came from.
        if (poolDecrement > 0) {
          await tx.asset.update({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `disp.assetId` validated against `bookingFoundAssets` (loaded org-scoped) before this loop
            where: { id: disp.assetId },
            data: { quantity: { decrement: poolDecrement } },
          });
        }

        const pendingAfter = remaining - claimed;
        if (pendingAfter === 0) {
          fullyReconciledQtyAssetIds.push(disp.assetId);
        }

        qtySummaries.push({
          assetId: disp.assetId,
          title: lockedAsset.title,
          returned: disp.returned ?? 0,
          consumed: disp.consumed ?? 0,
          lost: disp.lost ?? 0,
          damaged: disp.damaged ?? 0,
          pendingAfter,
        });
      }

      // ---- Individual asset status updates (unchanged) ----
      const individualAssetIds = effectiveAssetIds.filter(
        (id_) => assetTypeById.get(id_) === AssetType.INDIVIDUAL
      );
      if (individualAssetIds.length > 0) {
        // Scope to the caller's org (cross-org IDOR defence).
        await tx.asset.updateMany({
          where: { id: { in: individualAssetIds }, organizationId },
          data: { status: AssetStatus.AVAILABLE },
        });
      }

      // QUANTITY_TRACKED assets: only reset status to AVAILABLE if they
      // have no other active bookings and no custody records — pools
      // shared across bookings must not flicker on a partial check-in.
      // De-dup: with multiple slices of the same asset in one submit
      // (Polish-7b) `effectiveAssetIds` can list an asset twice — the
      // status reset must run once per asset.
      const qtyCheckinIds = [
        ...new Set(
          effectiveAssetIds.filter(
            (id_) => assetTypeById.get(id_) === AssetType.QUANTITY_TRACKED
          )
        ),
      ];
      for (const assetId of qtyCheckinIds) {
        const [otherBookings, custodyCount] = await Promise.all([
          tx.bookingAsset.count({
            where: {
              assetId,
              bookingId: { not: id },
              booking: {
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
          }),
          tx.custody.count({ where: { assetId } }),
        ]);
        if (otherBookings === 0 && custodyCount === 0) {
          await tx.asset.update({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` comes from `effectiveAssetIds` validated against the org-scoped booking assets earlier in partialCheckinBooking
            where: { id: assetId },
            data: { status: AssetStatus.AVAILABLE },
          });
        }
      }

      if (completeKitIds.length > 0) {
        await tx.kit.updateMany({
          where: { id: { in: completeKitIds }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /**
       * PartialBookingCheckin session row. `assetIds` intentionally only
       * lists assets FULLY reconciled in this session:
       *   - INDIVIDUAL: always included (presence = checked in).
       *   - QUANTITY_TRACKED: only when `remaining` hit zero.
       *
       * Partially-reconciled qty-tracked assets are tracked via
       * ConsumptionLog instead — that's the source of truth for
       * "how much has flowed back". The "touched" signal for the drawer
       * (so the scanner can mark an asset as already-handled) should key
       * off consumption-log presence, not just this row.
       */
      const sessionReconciledAssetIds = [
        ...individualAssetIds,
        ...fullyReconciledQtyAssetIds,
      ];
      await tx.partialBookingCheckin.create({
        data: {
          bookingId: id,
          checkedInById: userId,
          assetIds: sessionReconciledAssetIds,
          checkinCount: sessionReconciledAssetIds.length,
        },
      });

      // Activity events — one BOOKING_PARTIAL_CHECKIN per asset that had
      // activity in this session (qty disposition or individual flip).
      // Inside the tx so audit-trail recording is atomic with the writes
      // (matches `checkoutBooking` + the project's `use-record-event` rule).
      // Qty assets with 0/0/0/0 dispositions are filtered out — they
      // haven't actually been touched.
      // De-dup assetIds: multiple slices of one asset (Polish-7b) share
      // a single BOOKING_PARTIAL_CHECKIN event per asset.
      const assetIdsTouchedInTx = [
        ...new Set([
          ...individualAssetIds,
          ...qtySummaries.map((s) => s.assetId),
        ]),
      ];
      if (assetIdsTouchedInTx.length > 0) {
        await recordEvents(
          assetIdsTouchedInTx.map((assetId) => ({
            organizationId,
            actorUserId: userId,
            action: "BOOKING_PARTIAL_CHECKIN",
            entityType: "BOOKING",
            entityId: id,
            bookingId: id,
            assetId,
          })),
          tx
        );
      }

      // Determine completion uniformly via the shared helper — keeps
      // individual + qty-tracked semantics in one place.
      const bookingIsComplete = await isBookingFullyCheckedIn(tx, id);

      const updatedBookingSnapshot = await tx.booking.findUniqueOrThrow({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking `id` already org-checked via findUniqueOrThrow({where:{id,organizationId}}) in partialCheckinBooking
        where: { id },
        include: {
          bookingAssets: true,
          custodianUser: true,
          custodianTeamMember: true,
          _count: { select: { bookingAssets: true } },
        },
      });

      if (bookingIsComplete) {
        const completedBooking = await tx.booking.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking `id` already org-checked via findUniqueOrThrow({where:{id,organizationId}}) in partialCheckinBooking
          where: { id },
          data: { status: BookingStatus.COMPLETE },
          include: {
            bookingAssets: true,
            custodianUser: true,
            custodianTeamMember: true,
            _count: { select: { bookingAssets: true } },
          },
        });

        return {
          booking: completedBooking,
          previousStatus: updatedBookingSnapshot.status,
          isComplete: true as const,
          qtySummaries,
          individualAssetIds,
          completeKitIds,
        };
      }

      return {
        booking: updatedBookingSnapshot,
        previousStatus: updatedBookingSnapshot.status,
        isComplete: false as const,
        qtySummaries,
        individualAssetIds,
        completeKitIds,
      };
    });

    /**
     * Activity notes — best-effort, OUTSIDE the transaction.
     *
     * Wrapped in try/catch matching the pattern from manage-assets:
     * the check-in itself is already persisted, so a note rendering
     * failure must not propagate as a user-facing error. Any failure is
     * captured server-side via `Logger.error`.
     */
    try {
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });

      /**
       * Shared booking link used by every asset-side note below so the
       * activity feed on each asset tells the reader which booking the
       * check-in was for (and jumps straight to it via a markdoc link).
       */
      const bookingLink = wrapLinkForNote(
        `/bookings/${txResult.booking.id}`,
        txResult.booking.name
      );

      /**
       * Polish-7b: a single submit can disposition MULTIPLE slices of one
       * asset (kit-driven + standalone). The per-asset note + booking-note
       * fragment below read per-asset, so fold the per-slice summaries
       * into one entry per asset — sum the category counts; `pendingAfter`
       * is the asset's final outstanding (the last slice processed already
       * carries the running asset-level total).
       */
      const aggregatedQtySummaries: QtyDispositionSummary[] = (() => {
        const byAsset = new Map<string, QtyDispositionSummary>();
        for (const s of txResult.qtySummaries) {
          const prev = byAsset.get(s.assetId);
          if (!prev) {
            byAsset.set(s.assetId, { ...s });
          } else {
            prev.returned += s.returned;
            prev.consumed += s.consumed;
            prev.lost += s.lost;
            prev.damaged += s.damaged;
            prev.pendingAfter = s.pendingAfter;
          }
        }
        return [...byAsset.values()];
      })();

      /**
       * Per-row asset note summarizing this session's disposition.
       * Only generated for qty-tracked assets that actually had activity
       * this session; individual assets get the short "checked in" note
       * to preserve current behavior.
       */
      for (const summary of aggregatedQtySummaries) {
        const parts: string[] = [];
        if (summary.returned > 0)
          parts.push(`returned **${summary.returned}**`);
        if (summary.consumed > 0)
          parts.push(`consumed **${summary.consumed}**`);
        if (summary.lost > 0) parts.push(`**${summary.lost}** lost`);
        if (summary.damaged > 0) parts.push(`**${summary.damaged}** damaged`);
        if (summary.pendingAfter > 0) {
          parts.push(`**${summary.pendingAfter}** still pending`);
        }

        await createNotes({
          content: `${actor} via partial check-in on ${bookingLink}: ${parts.join(
            ", "
          )}.`,
          type: "UPDATE",
          userId,
          assetIds: [summary.assetId],
          // why: createNotes now requires organizationId (it internally runs
          // the cross-org asset guard); forward the booking's org.
          organizationId,
        });
      }

      if (txResult.individualAssetIds.length > 0) {
        await createNotes({
          content: `${actor} checked in via partial check-in on ${bookingLink}.`,
          type: "UPDATE",
          userId,
          assetIds: txResult.individualAssetIds,
          // why: createNotes now requires organizationId (it internally runs
          // the cross-org asset guard); forward the booking's org.
          organizationId,
        });
      }

      // Booking-side summary note (one per session).
      // (Activity events were already recorded INSIDE the tx — see
      //  `assetIdsTouchedInTx` block.)
      const assetIdsTouched = [
        ...txResult.individualAssetIds,
        ...txResult.qtySummaries.map((s) => s.assetId),
      ];
      const assetsWithKitInfo =
        assetIdsTouched.length > 0
          ? await db.asset.findMany({
              // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetIdsTouched` derive from the org-scoped booking assets/qty summaries in partialCheckinBooking
              where: { id: { in: assetIdsTouched } },
              select: {
                id: true,
                title: true,
                assetKits: {
                  select: { kit: { select: { id: true, name: true } } },
                },
              },
            })
          : [];

      const completeKits: Array<{ id: string; name: string }> = [];
      const standaloneAssets: Array<{ id: string; title: string }> = [];
      const processedKitIds = new Set<string>();
      for (const asset of assetsWithKitInfo) {
        const assetKit = asset.assetKits?.[0]?.kit;
        if (
          assetKit &&
          txResult.completeKitIds.includes(assetKit.id) &&
          !processedKitIds.has(assetKit.id)
        ) {
          completeKits.push({ id: assetKit.id, name: assetKit.name });
          processedKitIds.add(assetKit.id);
        } else if (!assetKit) {
          standaloneAssets.push({ id: asset.id, title: asset.title });
        }
      }

      const hasKits = completeKits.length > 0;
      const hasAssets = standaloneAssets.length > 0;
      let itemsDescription = "";
      if (hasKits && hasAssets) {
        itemsDescription = `${wrapAssetsWithDataForNote(
          standaloneAssets,
          "checked in"
        )} and ${wrapKitsWithDataForNote(completeKits, "checked in")}`;
      } else if (hasKits) {
        itemsDescription = wrapKitsWithDataForNote(completeKits, "checked in");
      } else if (hasAssets) {
        itemsDescription = wrapAssetsWithDataForNote(
          standaloneAssets,
          "checked in"
        );
      }

      // Per-asset qty disposition fragment for the booking note —
      // names each qty-tracked asset touched in this session (linked)
      // with its non-zero categories. Replaces the old aggregate-only
      // tail that just said "(10 returned, 2 lost)" with no asset
      // names.
      const qtyPerAsset = buildQtyPerAssetFragment(aggregatedQtySummaries);
      const qtyTail = qtyPerAsset ? ` — qty: ${qtyPerAsset}` : "";

      if (txResult.isComplete) {
        const fromStatusBadge = wrapBookingStatusForNote(
          txResult.previousStatus,
          txResult.booking.custodianUserId || undefined
        );
        const toStatusBadge = wrapBookingStatusForNote(
          BookingStatus.COMPLETE,
          txResult.booking.custodianUserId || undefined
        );
        await createSystemBookingNote({
          bookingId: id,
          // `createSystemBookingNote` requires `organizationId` for
          // workspace scoping. The pre-computed `actor` matches the
          // ledger-style notes the qty-tracked check-in flow writes and
          // the `qtyTail` suffix surfaces per-disposition counts
          // (returned / consumed / lost / damaged) when present.
          organizationId,
          content: `${actor} performed a partial check-in: ${itemsDescription}${qtyTail} and completed the booking. Status changed from ${fromStatusBadge} to ${toStatusBadge}`,
        });
      } else {
        await createSystemBookingNote({
          bookingId: id,
          organizationId,
          content: `${actor} performed a partial check-in: ${itemsDescription}${qtyTail}.`,
        });
      }
    } catch (noteError) {
      Logger.error(
        new ShelfError({
          cause: noteError,
          message: "Failed to write check-in activity notes",
          label,
          additionalData: { userId, bookingId: id },
        })
      );
    }

    // Compute a coarse "remaining" count for the toast: bookingAssets not
    // yet fully reconciled. Individuals count as remaining if not in any
    // PartialBookingCheckin session; qty-tracked count as remaining if
    // `computeBookingAssetRemaining > 0`.
    const outstandingBookingAssets = await db.bookingAsset.findMany({
      where: { bookingId: id },
      select: {
        assetId: true,
        asset: { select: { type: true } },
      },
    });
    const allSessions = await db.partialBookingCheckin.findMany({
      where: { bookingId: id },
      select: { assetIds: true },
    });
    const reconciledIndividualIds = new Set<string>(
      allSessions.flatMap((s) => s.assetIds as string[])
    );
    let remainingAssetCount = 0;
    for (const ba of outstandingBookingAssets) {
      if (ba.asset?.type === AssetType.QUANTITY_TRACKED) {
        const rem = await computeBookingAssetRemaining(db, id, ba.assetId);
        if (rem > 0) remainingAssetCount += 1;
      } else if (!reconciledIndividualIds.has(ba.assetId)) {
        remainingAssetCount += 1;
      }
    }

    return {
      booking: txResult.booking,
      checkedInAssetCount: effectiveAssetIds.length,
      remainingAssetCount,
      isComplete: txResult.isComplete,
    };
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
  quantities,
  kitSlices,
}: Pick<Booking, "id" | "organizationId"> & {
  /**
   * Standalone assets to add (no kit attribution). Kit-driven rows are
   * supplied separately via `kitSlices` so the same asset can be both
   * standalone AND a member of one-or-more kits in the same booking.
   */
  assetIds: Asset["id"][];
  kitIds?: Kit["id"][];
  userId?: User["id"];
  /** Optional map of assetId → quantity for standalone QUANTITY_TRACKED assets. Defaults to 1 for any asset not in the map. */
  quantities?: Record<string, number>;
  /**
   * Optional list of kit-driven slice specs — one element per
   * `AssetKit` membership being added. Each spec records the source
   * asset, the originating `AssetKit.id`, and that slice's quantity.
   *
   * Carrying a list (rather than a 1:1 assetId → assetKitId map) is
   * what lets a single quantity-tracked asset belonging to MULTIPLE
   * kits produce MULTIPLE kit-driven `BookingAsset` rows: the kit
   * partial unique is on `(bookingId, assetKitId)`, so each kit's
   * slice is a distinct, legal row. Non-kit callers (manage-assets
   * picker, asset bulk actions) omit this and only add standalone rows.
   */
  kitSlices?: Array<{ assetId: string; assetKitId: string; quantity: number }>;
}) {
  try {
    const { booking, addedAssetIds } = await db.$transaction(async (tx) => {
      // Verify booking exists before inserting into the join table,
      // so a stale/deleted booking returns a proper 404 (P2025)
      // instead of a FK violation (P2003)
      const b = await tx.booking.findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          name: true,
          status: true,
        },
      });

      const slices = kitSlices ?? [];

      // Validate the UNION of standalone asset ids and the asset ids
      // referenced by kit slices. An asset can legitimately appear in
      // both buckets (standalone + kit-driven), so we validate the
      // distinct set once.
      const uniqueAssetIds = [
        ...new Set([...assetIds, ...slices.map((s) => s.assetId)]),
      ];

      // Validate that all asset IDs exist before inserting into the join table
      // to prevent FK violations when assets are deleted between UI load and submission
      const validAssets = await tx.asset.findMany({
        where: { id: { in: uniqueAssetIds }, organizationId },
        select: { id: true },
      });
      const validAssetIds = validAssets.map((a) => a.id);

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

      // Org-scope the kit-source discriminators. `kitSlices[].assetKitId`
      // is request-supplied and written straight onto BookingAsset, so we
      // must prove each AssetKit belongs to the caller's org (the asset
      // ids were already validated above; this closes the cross-org gap
      // for the kit ids).
      await assertAssetKitsBelongToOrg(
        { assetKitIds: slices.map((s) => s.assetKitId), organizationId },
        tx
      );

      // Standalone rows go through an upsert keyed on the
      // (bookingId, assetId) partial unique. Dedupe the standalone ids
      // since the upsert can't accept duplicate keys in one statement.
      const standaloneAssetIds = [...new Set(assetIds)];
      const standaloneQuantities = standaloneAssetIds.map(
        (assetId) => quantities?.[assetId] ?? 1
      );

      // Kit-driven rows go through a separate insert keyed on the
      // (bookingId, assetKitId) partial unique — they use ON CONFLICT
      // DO NOTHING because adding the same kit twice should be a no-op,
      // not an upsert (the picker filters already-added kits out
      // client-side anyway). One row per kit slice, so an asset in two
      // kits yields two rows with distinct assetKitId.
      const kitAssetIds = slices.map((s) => s.assetId);
      const kitQuantities = slices.map((s) => s.quantity);
      const kitAssetKitIds = slices.map((s) => s.assetKitId);

      // The complete set of assets touched by this call — standalone +
      // kit-driven, deduped. Everything after the insert (status flip,
      // events, notes) operates on this set so a kit-only add still
      // flips statuses and records events for its member assets.
      const addedAssetIds = [
        ...new Set([...standaloneAssetIds, ...kitAssetIds]),
      ];

      await Promise.all([
        // Standalone branch: upsert against the manual partial unique
        // `(bookingId, assetId) WHERE assetKitId IS NULL`. Re-submitting
        // an existing standalone row updates its quantity.
        standaloneAssetIds.length > 0
          ? tx.$executeRaw`
              INSERT INTO "BookingAsset" ("id", "assetId", "bookingId", "quantity", "assetKitId")
              SELECT gen_random_uuid()::text, unnest(${standaloneAssetIds}::text[]), ${id}, unnest(${standaloneQuantities}::int[]), NULL
              ON CONFLICT ("bookingId", "assetId") WHERE "assetKitId" IS NULL DO UPDATE SET quantity = EXCLUDED.quantity
            `
          : Promise.resolve(),
        // Kit-driven branch: insert against the kit partial unique
        // `(bookingId, assetKitId) WHERE assetKitId IS NOT NULL`. DO
        // NOTHING on conflict so adding the same kit twice is harmless
        // (kit qty edits cascade from `updateKitAssets`, not from here).
        kitAssetIds.length > 0
          ? tx.$executeRaw`
              INSERT INTO "BookingAsset" ("id", "assetId", "bookingId", "quantity", "assetKitId")
              SELECT gen_random_uuid()::text, unnest(${kitAssetIds}::text[]), ${id}, unnest(${kitQuantities}::int[]), unnest(${kitAssetKitIds}::text[])
              ON CONFLICT ("bookingId", "assetKitId") WHERE "assetKitId" IS NOT NULL DO NOTHING
            `
          : Promise.resolve(),
        // Touch updatedAt since the raw INSERTs don't update the booking row
        tx.booking.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2328; this is the write on that same proven id
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
        await tx.asset.updateMany({
          where: { id: { in: addedAssetIds }, organizationId },
          data: { status: AssetStatus.CHECKED_OUT },
        });

        /**
         * Also update kit status to CHECKED_OUT for any kits that contain these assets
         */
        if (kitIds && kitIds.length > 0) {
          await tx.kit.updateMany({
            where: { id: { in: kitIds }, organizationId },
            data: { status: KitStatus.CHECKED_OUT },
          });
        }
      }

      // Activity events — one BOOKING_ASSETS_ADDED per asset added, inside the tx.
      // Must be atomic with asset addition for audit trail consistency.
      // Use the deduped union of standalone + kit-driven assets so a
      // kit-only add still records events for its member assets.
      if (addedAssetIds.length > 0) {
        await recordEvents(
          addedAssetIds.map((assetId) => ({
            organizationId,
            actorUserId: userId ?? null,
            action: "BOOKING_ASSETS_ADDED",
            entityType: "BOOKING",
            entityId: b.id,
            bookingId: b.id,
            assetId,
          })),
          tx
        );
      }

      return { booking: b, addedAssetIds };
    });

    // BOOKING ACTIVITY LOG: Log asset addition activity
    // Creates user-attributed note when assets are added to a booking
    // Skip note creation if kits are involved - kit notes are created separately
    // Note creation is best-effort — the booking update already succeeded,
    // so we log failures instead of throwing to prevent false error reports.
    if (!kitIds || kitIds.length === 0) {
      try {
        const assets = await db.asset.findMany({
          where: { id: { in: addedAssetIds }, organizationId },
          select: { id: true, title: true },
        });

        const assetContent = wrapAssetsWithDataForNote(assets, "added");

        if (userId) {
          const user = await getUserByID(userId, {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            } satisfies Prisma.UserSelect,
          });
          await createSystemBookingNote({
            bookingId: booking.id,
            organizationId,
            content: `${wrapUserLinkForNote(
              user
            )} added ${assetContent} to the booking.`,
          });
        } else {
          await createSystemBookingNote({
            bookingId: booking.id,
            organizationId,
            content: `${assetContent} added to the booking.`,
          });
        }
      } catch (noteError) {
        Logger.error(
          new ShelfError({
            cause: noteError,
            message: "Failed to create booking note after asset update",
            label,
            shouldBeCaptured: false,
          })
        );
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
  organizationId,
  kitIds,
  kits = [],
  userId,
  action = "added",
}: {
  bookingId: string;
  organizationId: string;
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
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    await createSystemBookingNote({
      bookingId,
      organizationId,
      content: `${wrapUserLinkForNote(
        user
      )} ${action} ${kitContent} to the booking.`,
    });
  } else {
    await createSystemBookingNote({
      bookingId,
      organizationId,
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
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: { id: true, status: true, activeSchedulerReference: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          title: "Not found",
          message:
            "Booking not found, are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /** Booking can be archived only if it is COMPLETE */
    if (booking.status !== BookingStatus.COMPLETE) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Archiving is only allowed for Completed bookings.",
      });
    }

    const updatedBooking = await db.booking.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2546; this is the write on that same proven id
      where: { id: booking.id },
      data: { status: BookingStatus.ARCHIVED },
    });

    // Cancel any pending auto-archive job
    await cancelScheduler(booking);

    // Add activity log for booking archival
    await createStatusTransitionNote({
      bookingId: updatedBooking.id,
      organizationId,
      fromStatus: booking.status,
      toStatus: BookingStatus.ARCHIVED,
      userId,
      custodianUserId: updatedBooking.custodianUserId || undefined,
    });

    // Semantic event — complements BOOKING_STATUS_CHANGED for filtered queries.
    await recordEvent({
      organizationId,
      actorUserId: userId ?? null,
      action: "BOOKING_ARCHIVED",
      entityType: "BOOKING",
      entityId: updatedBooking.id,
      bookingId: updatedBooking.id,
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
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          bookingAssets: {
            include: {
              asset: {
                select: {
                  id: true,
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /** Map bookingAssets to flat asset array for downstream logic */
    const cancelAssets = bookingFound.bookingAssets.map((ba) => ba.asset);

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

    const kitIds = getKitIdsByAssets(cancelAssets);
    const hasKits = kitIds.length > 0;

    const booking = await db.$transaction(async (tx) => {
      /** If booking is ONGOING or OVERDUE, we have to make the assets available */
      if (bookingFound.status !== BookingStatus.RESERVED) {
        await tx.asset.updateMany({
          where: {
            id: { in: cancelAssets.map((a) => a.id) },
            organizationId,
          },
          data: { status: AssetStatus.AVAILABLE },
        });

        /** If there are any kits, then update their status as well */
        if (hasKits) {
          await tx.kit.updateMany({
            where: { id: { in: kitIds }, organizationId },
            data: { status: KitStatus.AVAILABLE },
          });
        }
      }

      return tx.booking.update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: bookingFound id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2624; this is the write on that same proven id
        where: { id: bookingFound.id },
        data: { status: BookingStatus.CANCELLED, cancellationReason },
        include: {
          bookingAssets: true,
          ...BOOKING_INCLUDE_FOR_EMAIL,
        },
      });
    });

    /** Cancel any active schedulers */
    await cancelScheduler(booking);

    // Resolve notification recipients and send personalized emails
    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CANCEL",
      organizationId: booking.organizationId,
      editorUserId: userId,
    });

    if (recipients.length > 0) {
      const custodian = booking.custodianUser
        ? resolveUserDisplayName(booking.custodianUser)
        : booking.custodianTeamMember?.name ?? "";

      const text = cancelledBookingEmailContent({
        bookingName: booking.name,
        assetsCount: booking._count.bookingAssets,
        custodian,
        from: booking.from!,
        to: booking.to!,
        bookingId: booking.id,
        hints,
        customEmailFooter: booking.organization.customEmailFooter,
        cancellationReason: cancellationReason || undefined,
      });

      await sendBookingEmailToAllRecipients({
        recipients,
        booking,
        subject: `❌ Booking cancelled (${booking.name}) - shelf.nu`,
        textContent: text,
        heading: `Your booking has been cancelled: "${booking.name}"`,
        hints,
        templateProps: {
          cancellationReason: cancellationReason || undefined,
        },
      });
    }

    // Add activity log for booking cancellation
    await createStatusTransitionNote({
      bookingId: booking.id,
      organizationId,
      fromStatus: bookingFound.status,
      toStatus: BookingStatus.CANCELLED,
      userId,
      custodianUserId: booking.custodianUserId || undefined,
    });

    // Semantic event — complements BOOKING_STATUS_CHANGED for filtered queries.
    await recordEvent({
      organizationId,
      actorUserId: userId ?? null,
      action: "BOOKING_CANCELLED",
      entityType: "BOOKING",
      entityId: booking.id,
      bookingId: booking.id,
      meta: cancellationReason ? { cancellationReason } : undefined,
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
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: { id: true, status: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found, are you sure the booking exists in current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    /** User can only revert the booking to DRAFT from RESERVED */
    if (booking.status !== BookingStatus.RESERVED) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Booking can be reverted to draft only for reserved state.",
      });
    }

    const cancelledBooking = await db.booking.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2773; this is the write on that same proven id
      where: { id: booking.id },
      data: { status: BookingStatus.DRAFT },
    });

    // Add activity log for booking revert to draft
    if (userId) {
      await createStatusTransitionNote({
        bookingId: cancelledBooking.id,
        organizationId,
        fromStatus: booking.status,
        toStatus: BookingStatus.DRAFT,
        userId,
        custodianUserId: cancelledBooking.custodianUserId || undefined,
      });
    } else {
      // System-initiated revert (fallback)
      await createStatusTransitionNote({
        bookingId: cancelledBooking.id,
        organizationId,
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
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          to: true,
          activeSchedulerReference: true,
          bookingAssets: {
            include: {
              asset: { select: { id: true, status: true } },
            },
          },
          from: true,
          creatorId: true,
          custodianUserId: true,
          partialCheckins: { select: { assetIds: true } },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in the current workspace?",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

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
    const activeAssets = booking.bookingAssets
      .map((ba) => ba.asset)
      .filter(
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
    const updatedBooking = await db.$transaction(async (tx) => {
      /** Checking if the booking period is clashing with any other booking containing the same active asset(s).*/
      const clashingBookings: ClashingBooking[] = await tx.booking.findMany({
        where: {
          id: { not: booking.id },
          organizationId,
          status: {
            in: [BookingStatus.RESERVED],
          },
          bookingAssets: {
            some: { assetId: { in: activeAssets.map((a) => a.id) } },
          },
          // Check for bookings that start within the extension period
          from: {
            gt: booking.to,
            lte: newEndDate,
          },
        },
        select: { id: true, name: true },
      });

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

      return tx.booking.update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: booking id already org-checked via findUniqueOrThrow({where:{id,organizationId}}) at L2853; this is the write on that same proven id
        where: { id: booking.id },
        data: {
          /**
           * If booking is currently OVERDUE we have to make it ONGOING
           */
          status:
            booking.status === BookingStatus.OVERDUE
              ? BookingStatus.ONGOING
              : undefined,
          to: newEndDate,
        },
        include: BOOKING_INCLUDE_FOR_EMAIL,
      });
    });

    // Add activity log for booking extension
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    await createSystemBookingNote({
      bookingId: updatedBooking.id,
      organizationId,
      content: `${wrapUserLinkForNote(
        user
      )} extended the booking from **${wrapDateForNote(
        booking.to
      )}** to **${wrapDateForNote(newEndDate)}**.`,
    });

    /**
     * Activity event — record the date change for reports. Best-effort:
     * post-tx (mirrors the surrounding note-write location). The
     * `extendBooking` flow does NOT call `createStatusTransitionNote`
     * even when the status flips OVERDUE → ONGOING, so we also emit a
     * `BOOKING_STATUS_CHANGED` event ourselves for that case.
     */
    try {
      await recordEvent({
        organizationId,
        actorUserId: userId,
        action: "BOOKING_DATES_CHANGED",
        entityType: "BOOKING",
        entityId: updatedBooking.id,
        bookingId: updatedBooking.id,
        field: "to",
        fromValue: booking.to ? booking.to.toISOString() : null,
        toValue: newEndDate.toISOString(),
      });

      // Status flip is determined by the same condition used in the tx
      // update: OVERDUE → ONGOING. Anything else keeps the prior status.
      if (booking.status === BookingStatus.OVERDUE) {
        await recordEvent({
          organizationId,
          actorUserId: userId,
          action: "BOOKING_STATUS_CHANGED",
          entityType: "BOOKING",
          entityId: updatedBooking.id,
          bookingId: updatedBooking.id,
          field: "status",
          fromValue: BookingStatus.OVERDUE,
          toValue: BookingStatus.ONGOING,
        });
      }
    } catch (err) {
      Logger.error(
        new ShelfError({
          cause: err,
          message: "Failed to record extendBooking activity events",
          additionalData: { bookingId: updatedBooking.id },
          label,
        })
      );
    }

    // Resolve notification recipients and send personalized emails
    const recipients = await getBookingNotificationRecipients({
      booking: updatedBooking,
      eventType: "EXTEND",
      organizationId: updatedBooking.organizationId,
      editorUserId: userId,
    });

    if (recipients.length > 0) {
      const custodian = updatedBooking?.custodianUser
        ? resolveUserDisplayName(updatedBooking.custodianUser)
        : updatedBooking.custodianTeamMember?.name ?? "";

      const text = extendBookingEmailContent({
        bookingName: updatedBooking.name,
        assetsCount: updatedBooking._count.bookingAssets,
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

      await sendBookingEmailToAllRecipients({
        recipients,
        booking: updatedBooking,
        subject: `Booking extended (${updatedBooking.name}) - shelf.nu`,
        textContent: text,
        heading: `Booking extended from ${format(booking.to)} to ${format(
          newEndDate
        )}`,
        hints,
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
      await sendCheckinReminder(
        updatedBooking,
        updatedBooking._count.bookingAssets,
        hints,
        updatedBooking.organizationId
      );

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
    const teamMember = await db.teamMember.findFirst({
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
  extraInclude?: Prisma.BookingInclude;
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
    const where: Prisma.BookingWhereInput = { organizationId };

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
            bookingAssets: {
              some: {
                asset: {
                  OR: [
                    { title: { contains: term, mode: "insensitive" } },
                    {
                      qrCodes: {
                        some: { id: { contains: term, mode: "insensitive" } },
                      },
                    },
                    {
                      barcodes: {
                        some: {
                          value: { contains: term, mode: "insensitive" },
                        },
                      },
                    },
                  ],
                },
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
      where.bookingAssets = {
        some: {
          assetId: {
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
      where.bookingAssets = {
        some: { asset: { assetKits: { some: { kitId } } } },
      };
    }

    if (tags?.length) {
      if (tags.includes("untagged")) {
        where.tags = { none: {} };
      } else {
        where.tags = { some: { id: { in: tags } } };
      }
    }

    const [bookings, bookingCount] = await Promise.all([
      db.booking.findMany({
        ...(!takeAll && {
          skip,
          take,
        }),
        where,
        include: {
          ...BOOKING_COMMON_INCLUDE,
          bookingAssets: {
            // Explicit `select` (instead of `include`) so the inferred
            // type surfaces `assetKitId` on each row — the bookings list
            // sidebar (`BookingAssetsSidebar`) groups by it. Without an
            // explicit select, Prisma's type inference for
            // `include + nested include` doesn't expose the parent
            // scalars in a form the local component types accept.
            select: {
              id: true,
              quantity: true,
              assetKitId: true,
              asset: {
                select: {
                  title: true,
                  id: true,
                  type: true,
                  quantity: true,
                  custody: true,
                  availableToBook: true,
                  status: true,
                  mainImage: true,
                  thumbnailImage: true,
                  mainImageExpiration: true,
                  // Asset-code resolution fields — see `app/modules/barcode/display.ts`.
                  // Surfaced by the BookingAssetsSidebar so the chip matches the
                  // simple-mode booking overview list and every other code-bearing
                  // surface (see .claude/rules/code-bearing-entity-list-consistency.md).
                  sequentialId: true,
                  preferredBarcodeId: true,
                  qrCodes: { take: 1, select: { id: true } },
                  barcodes: { select: { id: true, type: true, value: true } },
                  category: {
                    select: {
                      id: true,
                      name: true,
                      color: true,
                    },
                  },
                  bookingAssets: {
                    select: {
                      bookingId: true,
                    },
                  },
                  assetKits: {
                    select: {
                      // See the comment in `bookings.$bookingId.overview.tsx`
                      // for why both `id` (the AssetKit row id) and `kitId`
                      // are needed for kit-source grouping.
                      id: true,
                      kitId: true,
                      kit: {
                        select: {
                          id: true,
                          name: true,
                          image: true,
                          imageExpiration: true,
                          category: {
                            select: {
                              id: true,
                              name: true,
                              color: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
            },
          },
          ...(extraInclude || undefined),
        },
        orderBy: { [orderBy]: orderDirection },
      }),
      db.booking.count({ where }),
    ]);

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

    /**
     * Audit trail: removing an asset that was materialised from a
     * `BookingModelRequest` must re-open that request by decrementing
     * its `fulfilledQuantity`. Otherwise the
     * operator ends up with `fulfilledQuantity > actualBookingAssets`
     * state — the Reserved Models card stays hidden (because
     * `fulfilledAt` is stamped) even though the booking is short by
     * the removed unit.
     *
     * Strategy:
     *   1. Look up `assetModelId` for each asset being removed.
     *   2. Group by `assetModelId` → how many units to "return".
     *   3. For each model with an open (or fulfilled) request on this
     *      booking, decrement `fulfilledQuantity` by that count (capped
     *      at 0) and clear `fulfilledAt` if it drops below `quantity`.
     *
     * Wrapped in a single transaction with the `bookingAsset.deleteMany`
     * so we don't end up with half-reverted state on failure.
     */
    await db.$transaction(async (tx) => {
      const removedAssets = await tx.asset.findMany({
        where: { id: { in: assetIds }, organizationId },
        select: { id: true, assetModelId: true },
      });

      // When the caller is the manage-kits flow removing one or more
      // kits, scope the deletion to the kit-driven BookingAsset rows for
      // those kits' AssetKits. Otherwise removing a kit would also blow
      // away any standalone slice the user added separately for the
      // same asset (e.g. Gloves booked standalone at qty 22 alongside
      // the kit's slice of 87 — only the 87 should disappear).
      //
      // When `kitIds` is empty, the call comes from the manage-assets
      // picker or asset-bulk remove flow, where the intent is to remove
      // ALL slices of the asset from the booking (legacy behaviour).
      if (kitIds.length > 0) {
        const kitDrivenAssetKitIds = await tx.assetKit.findMany({
          where: { kitId: { in: kitIds }, assetId: { in: assetIds } },
          select: { id: true },
        });
        await tx.bookingAsset.deleteMany({
          where: {
            bookingId: id,
            assetKitId: {
              in: kitDrivenAssetKitIds.map((ak: { id: string }) => ak.id),
            },
          },
        });
      } else {
        await tx.bookingAsset.deleteMany({
          where: { bookingId: id, assetId: { in: assetIds } },
        });
      }

      // Count removals per assetModelId so we decrement each request
      // in one update rather than N.
      const removalsByModel = new Map<string, number>();
      for (const asset of removedAssets) {
        if (!asset.assetModelId) continue;
        removalsByModel.set(
          asset.assetModelId,
          (removalsByModel.get(asset.assetModelId) ?? 0) + 1
        );
      }

      for (const [assetModelId, decrementBy] of removalsByModel) {
        const request = await tx.bookingModelRequest.findUnique({
          where: {
            bookingId_assetModelId: { bookingId: id, assetModelId },
          },
          select: { quantity: true, fulfilledQuantity: true },
        });
        if (!request || request.fulfilledQuantity === 0) continue;

        // Cap at 0 — if the operator removes more than what was
        // materialised (they scanned direct + via request, now removing
        // some), we only decrement the fulfilled share.
        const nextFulfilled = Math.max(
          0,
          request.fulfilledQuantity - decrementBy
        );
        // If we're dropping below the reserved `quantity`, the request
        // has outstanding units again — clear the completion stamp so
        // the Reserved Models card + CTAs surface again.
        const nextFulfilledAt =
          nextFulfilled < request.quantity ? null : undefined;

        await tx.bookingModelRequest.update({
          where: {
            bookingId_assetModelId: { bookingId: id, assetModelId },
          },
          data: {
            fulfilledQuantity: nextFulfilled,
            ...(nextFulfilledAt === null ? { fulfilledAt: null } : {}),
          },
        });
      }
    });

    const b = await db.booking.findUniqueOrThrow({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });
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
      await db.asset.updateMany({
        where: { id: { in: assetIds }, organizationId },
        data: { status: AssetStatus.AVAILABLE },
      });

      if (kitIds.length > 0) {
        await db.kit.updateMany({
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
      organizationId,
    });

    // Activity events — one BOOKING_ASSETS_REMOVED per asset detached.
    // Best-effort: don't fail the removal if event recording fails.
    if (assetIds.length > 0) {
      try {
        await recordEvents(
          assetIds.map((assetId) => ({
            organizationId,
            actorUserId: userId,
            action: "BOOKING_ASSETS_REMOVED",
            entityType: "BOOKING",
            entityId: booking.id,
            bookingId: booking.id,
            assetId,
          }))
        );
      } catch (err) {
        Logger.error(
          new ShelfError({
            cause: err,
            message: "Failed to record BOOKING_ASSETS_REMOVED events",
            additionalData: { bookingId: booking.id, assetIds },
            label,
          })
        );
      }
    }

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
        organizationId,
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
        organizationId,
        content: `${wrapUserLinkForNote(
          userForNotes
        )} removed ${kitContent} from booking.`,
      });
    } else if (hasAssets) {
      // Only assets removed
      const assetContent = wrapAssetsWithDataForNote(assets, "removed");

      await createSystemBookingNote({
        bookingId: booking.id,
        organizationId,
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
  hints: ClientHint,
  userId?: string
) {
  const { id, organizationId } = booking;
  const currentBooking = await db.booking.findUnique({
    where: { id, organizationId },
    include: {
      bookingAssets: {
        include: {
          asset: {
            select: {
              id: true,
              assetKits: { select: { kitId: true } },
            },
          },
        },
      },
    },
  });

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

    const activeBookingAssets =
      activeBooking?.bookingAssets.map((ba) => ba.asset) ?? [];
    const assetKitIds = activeBookingAssets
      .map((a) => a.assetKits?.[0]?.kitId)
      .filter((id): id is string => Boolean(id));
    const uniqueKitIds = new Set(assetKitIds);
    const hasKits = uniqueKitIds.size > 0;

    const b = await db.booking.delete({
      where: { id, organizationId },
      include: {
        ...BOOKING_COMMON_INCLUDE,
        ...BOOKING_INCLUDE_FOR_EMAIL,
        bookingAssets: {
          include: {
            asset: { select: { id: true } },
          },
        },
      },
    });

    // Resolve notification recipients and send personalized emails
    const recipients = await getBookingNotificationRecipients({
      booking: b,
      eventType: "DELETE",
      organizationId,
      editorUserId: userId,
    });

    if (recipients.length > 0) {
      const custodian = b.custodianUser
        ? resolveUserDisplayName(b.custodianUser)
        : b.custodianTeamMember?.name ?? "";

      const text = deletedBookingEmailContent({
        bookingName: b.name,
        assetsCount: b._count.bookingAssets,
        custodian,
        from: b.from as Date,
        to: b.to as Date,
        bookingId: b.id,
        hints,
        customEmailFooter: b.organization.customEmailFooter,
      });

      await sendBookingEmailToAllRecipients({
        recipients,
        booking: b,
        subject: `🗑️ Booking deleted (${b.name}) - shelf.nu`,
        textContent: text,
        heading: `Your booking has been deleted: "${b.name}"`,
        hints,
        templateProps: {
          hideViewButton: true,
        },
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
          organizationId,
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

export async function getBooking<T extends Prisma.BookingInclude | undefined>(
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

    // Build bookingAssets include with optional search, status filtering, and dynamic sorting
    const assetsWhere: Prisma.AssetWhereInput = {};

    if (search) {
      // Match the asset's title OR any of its codes (QR id, barcode value)
      // so a field worker can find an asset in a booking by the same string
      // that's printed on the physical label.
      assetsWhere.OR = [
        { title: { contains: search, mode: "insensitive" } },
        {
          qrCodes: { some: { id: { contains: search, mode: "insensitive" } } },
        },
        {
          barcodes: {
            some: { value: { contains: search, mode: "insensitive" } },
          },
        },
      ];
    }

    // if (status) {
    //   assetsWhere.status = status;
    // }

    const bookingAssetsInclude: Prisma.BookingInclude["bookingAssets"] = {
      include: BOOKING_WITH_ASSETS_INCLUDE.bookingAssets.include,
      orderBy: assetsOrderBy.map((o) => ({ asset: o })),
      ...(Object.keys(assetsWhere).length > 0 && {
        where: { asset: assetsWhere },
      }),
    };

    const mergedInclude = {
      ...BOOKING_WITH_ASSETS_INCLUDE,
      bookingAssets: bookingAssetsInclude,
      ...extraInclude,
    } as MergeInclude<typeof BOOKING_WITH_ASSETS_INCLUDE, T>;

    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const bookingFound = (await db.booking.findFirstOrThrow({
      where: {
        OR: [
          { id, organizationId },
          ...(userOrganizations?.length
            ? [{ id, organizationId: { in: otherOrganizationIds } }]
            : []),
        ],
      },
      include: mergedInclude,
    })) as BookingWithExtraInclude<T>;

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
            displayName: true,
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
          ? resolveUserDisplayName(booking.custodianUser)
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
                ? resolveUserDisplayName(booking.creator)
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

type AssetWithKitId = Pick<Asset, "id"> & {
  assetKits: { kitId: string }[];
};

export function getKitIdsByAssets(assets: AssetWithKitId[]) {
  // Defensive `?.` on `assetKits` tolerates fixtures / payloads where the
  // pivot relation isn't projected (older mocks, narrower selects).
  const allKitIds = assets
    .map((a) => a.assetKits?.[0]?.kitId)
    .filter((id): id is string => Boolean(id));

  const uniqueKitIds = new Set(allKitIds);

  return [...uniqueKitIds];
}

export async function getBookingFlags(
  booking: Pick<Booking, "id" | "from" | "to"> & {
    assetIds: Asset["id"][];
    /**
     * Count of outstanding `BookingModelRequest` rows on this booking.
     * A booking with no concrete `BookingAsset` rows but at least one
     * model-level reservation is still a valid thing to reserve/check
     * out. Without this, the Reserve button stays disabled on pure
     * book-by-model bookings.
     */
    modelRequestCount?: number;
    /** Caller's validated org — scopes the asset lookup (cross-org IDOR guard) */
    organizationId: string;
  }
) {
  const assets = await db.asset.findMany({
    // why: organizationId scoping prevents flag computation from reading
    // assets that belong to another tenant.
    where: {
      id: { in: booking.assetIds },
      organizationId: booking.organizationId,
    },
    include: {
      category: true,
      custody: true,
      assetKits: { select: { kitId: true } },
      bookingAssets: {
        where: {
          booking: {
            ...(booking.from && booking.to
              ? {
                  id: { not: booking.id }, // Exclude current booking
                  OR: [
                    // Rule 1: RESERVED bookings always conflict
                    {
                      status: "RESERVED",
                      OR: [
                        {
                          from: { lte: booking.to },
                          to: { gte: booking.from },
                        },
                        {
                          from: { gte: booking.from },
                          to: { lte: booking.to },
                        },
                      ],
                    },
                    // Rule 2: ONGOING/OVERDUE bookings (filtered by asset status in logic below)
                    {
                      status: { in: ["ONGOING", "OVERDUE"] },
                      OR: [
                        {
                          from: { lte: booking.to },
                          to: { gte: booking.from },
                        },
                        {
                          from: { gte: booking.from },
                          to: { lte: booking.to },
                        },
                      ],
                    },
                  ],
                }
              : { id: { not: booking.id } }),
          },
        },
        include: {
          booking: {
            select: { id: true, status: true },
          },
        },
      },
    },
  });

  const hasAssets = assets.length > 0;

  const hasUnavailableAssets = assets.some((asset) => !asset.availableToBook);

  /**
   * QUANTITY_TRACKED assets are exempt from the `CHECKED_OUT` /
   * "already booked" conflict flags. For a qty-tracked asset,
   * `Asset.status = CHECKED_OUT` only means at least ONE unit is out
   * somewhere — the rest of the pool is still allocatable. The
   * per-booking quantity availability is enforced at the service layer
   * via `computeBookingAvailableQuantity()` when assets are added /
   * quantities adjusted. Matches the logic in `hasAssetBookingConflicts`
   * which already returns false for qty-tracked.
   */
  const hasCheckedOutAssets = assets.some(
    (asset) =>
      asset.type !== AssetType.QUANTITY_TRACKED &&
      asset.status === AssetStatus.CHECKED_OUT
  );

  const hasAlreadyBookedAssets = assets.some((asset) => {
    if (asset.type === AssetType.QUANTITY_TRACKED) return false;
    if (!asset.bookingAssets || asset.bookingAssets.length === 0) return false;

    return asset.bookingAssets.some((ba) => {
      const conflictingBooking = ba.booking;
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

  // QUANTITY_TRACKED row-level IN_CUSTODY just means *some* units are
  // operator-allocated; the remaining pool is still bookable. Only
  // INDIVIDUAL custody blocks the checkout button. Mirrors the
  // server-side guards in `checkoutBooking`.
  const hasAssetsInCustody = assets.some(
    (asset) =>
      !isQuantityTracked(asset) && asset.status === AssetStatus.IN_CUSTODY
  );

  const hasKits = assets.some((asset) => (asset.assetKits ?? []).length > 0);
  const hasModelRequests = (booking.modelRequestCount ?? 0) > 0;

  return {
    hasAssets,
    hasUnavailableAssets,
    hasCheckedOutAssets,
    hasAlreadyBookedAssets,
    hasAssetsInCustody,
    hasKits,
    hasModelRequests,
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
    const where: Prisma.BookingWhereInput = bookingIds.includes(
      ALL_SELECTED_KEY
    )
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const [bookings, user] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          ...BOOKING_INCLUDE_FOR_EMAIL,
          bookingAssets: {
            include: {
              asset: {
                select: {
                  id: true,
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    /** If some booking was OVERDUE or ONGOING, we have to make their assets and kits available */
    const overdueOrOngoingBookings = bookings.filter(
      (booking) => booking.status === "OVERDUE" || booking.status === "ONGOING"
    );

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = bookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    await db.$transaction(async (tx) => {
      /** Deleting all selected bookings */
      await tx.booking.deleteMany({
        where: {
          id: { in: bookings.map((booking) => booking.id) },
          organizationId,
        },
      });

      /** Making assets and kits available */
      if (overdueOrOngoingBookings.length > 0) {
        const allAssets = overdueOrOngoingBookings.flatMap((booking) =>
          booking.bookingAssets.map((ba) => ba.asset)
        );

        const allKitIds = allAssets
          .map((asset) => asset.assetKits?.[0]?.kitId)
          .filter((id): id is string => Boolean(id));

        const uniqueKitIds = new Set(allKitIds);

        await tx.asset.updateMany({
          where: {
            id: { in: allAssets.map((asset) => asset.id) },
            organizationId,
          },
          data: { status: AssetStatus.AVAILABLE },
        });

        await tx.kit.updateMany({
          where: { id: { in: [...uniqueKitIds] }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Making notes for all the assets */
      const notesData = bookings
        .map((booking) =>
          booking.bookingAssets.map((ba) => ({
            userId,
            assetId: ba.asset.id,
            content: `**${resolveUserDisplayName(user)}** deleted booking **${
              booking.name
            }**.`,
            type: "UPDATE" as const,
          }))
        )
        .flat() satisfies Prisma.NoteCreateManyInput[];

      await tx.note.createMany({ data: notesData });
    });

    /** Cancelling scheduler */
    await Promise.all(
      bookingsWithSchedulerReference.map((booking) => cancelScheduler(booking))
    );

    // Resolve notification recipients and send personalized emails for each deleted booking
    for (const b of bookings) {
      const recipients = await getBookingNotificationRecipients({
        booking: b,
        eventType: "DELETE",
        organizationId,
        editorUserId: userId,
      });

      if (recipients.length > 0) {
        const custodian =
          resolveUserDisplayName(b.custodianUser) ||
          b.custodianTeamMember?.name ||
          "";

        const text = deletedBookingEmailContent({
          bookingName: b.name,
          assetsCount: b.bookingAssets.length,
          custodian,
          from: b.from as Date,
          to: b.to as Date,
          bookingId: b.id,
          hints,
        });

        await sendBookingEmailToAllRecipients({
          recipients,
          booking: b,
          subject: `🗑️ Booking deleted (${b.name}) - shelf.nu`,
          textContent: text,
          heading: `Your booking has been deleted: "${b.name}"`,
          hints,
          templateProps: {
            hideViewButton: true,
          },
        });
      }
    }
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
  userId,
  currentSearchParams,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  /**
   * Optional actor user ID — attributed on the per-booking
   * `BOOKING_ARCHIVED` activity events so reports can surface "who
   * archived these bookings". When absent, events are recorded as
   * system-initiated.
   */
  userId?: User["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /** If all are selected in the list, then we have to consider filter */
    const where: Prisma.BookingWhereInput = bookingIds.includes(
      ALL_SELECTED_KEY
    )
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const bookings = await db.booking.findMany({
      where,
      select: {
        id: true,
        status: true,
        custodianUserId: true,
        activeSchedulerReference: true,
      },
    });

    const someBookingNotComplete = bookings.some(
      (b) => b.status !== "COMPLETE"
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

    await db.$transaction(async (tx) => {
      /** Updating status of bookings to ARCHIVED  */
      await tx.booking.updateMany({
        where: { id: { in: bookings.map((b) => b.id) }, organizationId },
        data: { status: BookingStatus.ARCHIVED },
      });

      /** Create booking status transition notes for each booking */
      for (const booking of bookings) {
        await createStatusTransitionNote({
          bookingId: booking.id,
          organizationId,
          fromStatus: booking.status,
          toStatus: BookingStatus.ARCHIVED,
          userId,
          custodianUserId: booking.custodianUserId || undefined,
        });
      }

      /**
       * Per-booking lifecycle event — mirrors the single
       * `archiveBooking` emission so reports treat bulk + single
       * archival identically. Inside the same tx so a rollback wipes
       * both the status flips and the events together.
       */
      await recordEvents(
        bookings.map((booking) => ({
          organizationId,
          actorUserId: userId ?? null,
          action: "BOOKING_ARCHIVED" as const,
          entityType: "BOOKING" as const,
          entityId: booking.id,
          bookingId: booking.id,
        })),
        tx
      );
    });

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
    const where: Prisma.BookingWhereInput = bookingIds.includes(
      ALL_SELECTED_KEY
    )
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const [bookings, user] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          ...BOOKING_INCLUDE_FOR_EMAIL,
          bookingAssets: {
            include: {
              asset: {
                select: {
                  id: true,
                  assetKits: { select: { kitId: true } },
                },
              },
            },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

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

    /** We have to make all the assets and kits available if the booking as ongoing or overdue */
    const ongoingOrOverdueBookings = bookings.filter(
      (b) => b.status === "ONGOING" || b.status === "OVERDUE"
    );

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = bookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    await db.$transaction(async (tx) => {
      /** Updating status of bookings to CANCELLED */
      await tx.booking.updateMany({
        where: { id: { in: bookings.map((b) => b.id) }, organizationId },
        data: { status: BookingStatus.CANCELLED },
      });

      /** Updating status of assets and kits  */
      if (ongoingOrOverdueBookings.length > 0) {
        const allAssets = ongoingOrOverdueBookings.flatMap((b) =>
          b.bookingAssets.map((ba) => ba.asset)
        );
        const allKitIds = allAssets
          .map((a) => a.assetKits?.[0]?.kitId)
          .filter((id): id is string => Boolean(id));

        const uniqueKitIds = new Set(allKitIds);

        /** Making assets available */
        await tx.asset.updateMany({
          where: { id: { in: allAssets.map((a) => a.id) }, organizationId },
          data: { status: AssetStatus.AVAILABLE },
        });

        /** Making kits available */
        await tx.kit.updateMany({
          where: { id: { in: [...uniqueKitIds] }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Making notes for all the assets */
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });
      const notesData = bookings
        .map((b) =>
          b.bookingAssets.map((ba) => ({
            assetId: ba.asset.id,
            content: `${actor} cancelled booking.`,
            userId,
            type: "UPDATE" as const,
          }))
        )
        .flat() satisfies Prisma.NoteCreateManyInput[];

      await tx.note.createMany({ data: notesData });

      /** Create booking status transition notes for each booking */
      for (const booking of bookings) {
        await createStatusTransitionNote({
          bookingId: booking.id,
          organizationId,
          fromStatus: booking.status,
          toStatus: BookingStatus.CANCELLED,
          userId,
          custodianUserId: booking.custodianUserId || undefined,
        });
      }

      /**
       * Per-booking lifecycle event — mirrors the single
       * `cancelBooking` emission so reports treat bulk + single
       * cancellation identically. Inside the same tx so a rollback
       * wipes both the status flips and the events together. The bulk
       * path has no per-booking cancellation reason, so `meta` is
       * omitted (the single-cancel path includes it when supplied).
       */
      await recordEvents(
        bookings.map((booking) => ({
          organizationId,
          actorUserId: userId,
          action: "BOOKING_CANCELLED" as const,
          entityType: "BOOKING" as const,
          entityId: booking.id,
          bookingId: booking.id,
        })),
        tx
      );
    });

    /** Cancelling scheduler */
    await Promise.all(
      bookingsWithSchedulerReference.map((booking) => cancelScheduler(booking))
    );

    // Resolve notification recipients and send personalized cancellation emails
    for (const b of bookings) {
      const recipients = await getBookingNotificationRecipients({
        booking: b,
        eventType: "CANCEL",
        organizationId,
        editorUserId: userId,
      });

      if (recipients.length > 0) {
        const custodian =
          resolveUserDisplayName(b.custodianUser) ||
          b.custodianTeamMember?.name ||
          "";

        const text = cancelledBookingEmailContent({
          bookingName: b.name,
          assetsCount: b._count.bookingAssets,
          custodian,
          from: b.from as Date,
          to: b.to as Date,
          bookingId: b.id,
          hints,
          customEmailFooter: b.organization.customEmailFooter,
        });

        await sendBookingEmailToAllRecipients({
          recipients,
          booking: b,
          subject: `❌ Booking cancelled (${b.name}) - shelf.nu`,
          textContent: text,
          heading: `Your booking has been cancelled: "${b.name}"`,
          hints,
        });
      }
    }
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
  const [assets, kits] = await Promise.all([
    db.asset.findMany({
      where: { id: { in: assetIds }, organizationId },
      select: { id: true, title: true },
    }),
    kitIds.length > 0
      ? db.kit.findMany({
          where: { id: { in: kitIds }, organizationId },
          select: {
            id: true,
            name: true,
            assetKits: { select: { assetId: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Create a map of asset ID to kit name for assets that came from kits
  const assetIdToKitName = new Map<string, string>();
  kits.forEach((kit) => {
    kit.assetKits.forEach((ak) => {
      assetIdToKitName.set(ak.assetId, kit.name);
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
      displayName: true,
    } satisfies Prisma.UserSelect,
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
      organizationId,
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
      organizationId,
      content: `${wrapUserLinkForNote(
        userForNotes
      )} added ${kitContent} to booking.`,
    });
  } else if (hasAssets) {
    // Only assets added - create booking note
    const assetContent = wrapAssetsWithDataForNote(standaloneAssets, "added");

    await createSystemBookingNote({
      bookingId: booking.id,
      organizationId,
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
      organizationId,
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
          organizationId,
        });
      }
    }
  }
}

/**
 * Transaction-body helper shared by {@link addScannedAssetsToBooking} and
 * {@link fulfilModelRequestsAndCheckout}.
 *
 * Performs the pure write-side of "add scanned assets":
 *   1. For every scanned asset, calls `materializeModelRequestForAsset` so
 *      that any outstanding `BookingModelRequest` for the asset's model is
 *      decremented (or deleted when it hits zero). Failures here roll the
 *      whole transaction back — the caller never ends up with concrete
 *      `BookingAsset` rows alongside a stale request count.
 *   2. Creates the `BookingAsset` rows on the booking.
 *   3. If the booking is already ONGOING/OVERDUE, syncs the newly added
 *      asset + kit rows to CHECKED_OUT status so they reflect reality.
 *
 * This extraction exists so `fulfilModelRequestsAndCheckout` can run this
 * logic inside the SAME transaction as the subsequent checkout body,
 * guaranteeing atomicity: if availability validation fails after
 * materialisation, all the scanned writes roll back together. The
 * externally-exported `addScannedAssetsToBooking` wraps this helper in its
 * own `$transaction` and adds post-commit activity notes, preserving its
 * contract byte-for-byte.
 *
 * @param tx - Prisma transaction client (must be a real `$transaction` tx)
 * @param args.assetIds - IDs of directly-scanned (standalone) assets to add
 * @param args.kitSlices - Kit-driven slice specs (one per AssetKit membership)
 * @param args.kitIds - Optional kit IDs (only used to propagate kit status sync when booking is active)
 * @param args.bookingId - Booking being modified
 * @param args.organizationId - Organization scope for the booking + assets
 * @param args.userId - User performing the scan (attributed on materialized logs)
 * @returns `{ id, name, status }` of the updated booking
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function addScannedAssetsToBookingWithinTx(
  tx: any,
  {
    assetIds,
    kitIds,
    bookingId,
    organizationId,
    userId,
    quantities = {},
    kitSlices = [],
  }: {
    /** Directly-scanned (standalone) asset IDs — written with `assetKitId = null`. */
    assetIds: Asset["id"][];
    kitIds: string[];
    bookingId: Booking["id"];
    organizationId: Booking["organizationId"];
    userId: string;
    /**
     * Per-asset quantity for standalone QUANTITY_TRACKED scans. Missing
     * entries fall back to `BookingAsset.quantity`'s schema default (1)
     * — keeps callers that don't supply quantities (mobile, fulfil
     * flow) working unchanged.
     */
    quantities?: Record<Asset["id"], number>;
    /**
     * Kit-driven slice specs — one element per `AssetKit` membership
     * scanned (the drawer resolves the `AssetKit.id` for each member of
     * a scanned kit's QR). Each spec produces a `BookingAsset` row with
     * `assetKitId` set so the booking UI groups it under the kit. An
     * asset scanned via TWO kits yields TWO slices (distinct
     * `assetKitId`), each a legal row under the `(bookingId, assetKitId)`
     * partial unique. The slice's quantity defaults to the kit's
     * `AssetKit.quantity` when omitted.
     */
    kitSlices?: Array<{
      assetId: string;
      assetKitId: string;
      quantity?: number;
    }>;
  }
) {
  // The deduped union of standalone + kit-slice asset ids. Model-request
  // materialisation, events, and status flips operate on this set so a
  // kit-only scan still materialises requests and records events for its
  // member assets.
  const allScannedAssetIds = Array.from(
    new Set([...assetIds, ...kitSlices.map((s) => s.assetId)])
  );

  // Cross-org guards (request-supplied ids). The materialisation loop
  // below silently skips assets it can't find in-org, and the
  // `bookingAssets.create` would otherwise create rows for any globally-
  // existing id (FK satisfied) — so prove BOTH the asset ids and the
  // kit-slice assetKitIds belong to this org BEFORE any writes, throwing
  // (not silently dropping) on a foreign id. Mirrors the count-guard
  // `updateBookingAssets` performs.
  await assertAssetsBelongToOrg(
    { assetIds: allScannedAssetIds, organizationId },
    tx
  );
  await assertAssetKitsBelongToOrg(
    // Filter falsy ids: the kit-qty resolution below (line ~7557) already
    // tolerates slices with no assetKitId, so the guard must too — otherwise
    // a non-kit slice would surface a confusing "Invalid kits" 400.
    {
      assetKitIds: kitSlices.map((s) => s.assetKitId).filter(Boolean),
      organizationId,
    },
    tx
  );

  /**
   * Pre-fetch metadata for the scanned assets so we can run the
   * model-request materialization loop — each scanned asset that
   * matches an outstanding `BookingModelRequest` for its model
   * decrements that request. Assets without a matching request (or
   * with no model at all) fall through to the "direct BookingAsset
   * create" path below.
   *
   * Uses the tx client so the read participates in the same
   * snapshot as the writes that follow.
   */
  // Shape pinned explicitly because `tx` is typed `any` (extended Prisma
  // client tx type is incompatible with `Prisma.TransactionClient`).
  type ScannedAssetMeta = Pick<Asset, "id" | "title" | "type" | "assetModelId">;
  const scannedAssetsMeta: ScannedAssetMeta[] =
    allScannedAssetIds.length > 0
      ? await tx.asset.findMany({
          where: { id: { in: allScannedAssetIds }, organizationId },
          select: {
            id: true,
            title: true,
            type: true,
            assetModelId: true,
          },
        })
      : [];
  const scannedAssetsMetaById = new Map<string, ScannedAssetMeta>(
    scannedAssetsMeta.map((a) => [a.id, a])
  );

  for (const assetId of allScannedAssetIds) {
    const meta = scannedAssetsMetaById.get(assetId);
    if (!meta) continue; // asset not found in org — caught later by FK
    await materializeModelRequestForAsset({
      bookingId,
      asset: meta,
      organizationId,
      userId,
      tx,
    });
  }

  /**
   * Resolve the slice quantity for kit-driven scans. When a kit QR is
   * scanned, the drawer attributes each member to its `AssetKit` via
   * `kitSlices` but may not pass an explicit slice quantity — so a
   * QUANTITY_TRACKED member would otherwise default to 1 instead of the
   * kit's `AssetKit.quantity` (e.g. 33 batteries booked as 1). Fetch
   * the AssetKit rows for the referenced ids and use their quantity as
   * the fallback. An explicit `slice.quantity` (when the caller already
   * resolved it) still wins.
   */
  const referencedAssetKitIds = Array.from(
    new Set(kitSlices.map((s) => s.assetKitId).filter(Boolean))
  );
  const assetKitQtyById = new Map<string, number>(
    referencedAssetKitIds.length > 0
      ? (
          await tx.assetKit.findMany({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `referencedAssetKitIds` come from the org-scoped booking assets loaded earlier in this flow
            where: { id: { in: referencedAssetKitIds } },
            select: { id: true, quantity: true },
          })
        ).map((ak: { id: string; quantity: number }) => [ak.id, ak.quantity])
      : []
  );

  const booking = await tx.booking.update({
    where: { id: bookingId, organizationId },
    data: {
      bookingAssets: {
        // One row per standalone scan + one row per kit slice. An asset
        // scanned via TWO kits yields TWO kit-driven rows with distinct
        // `assetKitId`; the standalone bucket stays independent of an
        // asset's incidental kit memberships.
        create: [
          // Standalone scans: `assetKitId = null`. Quantity precedence:
          // explicit per-row qty input → 1 (schema default).
          ...assetIds.map((id) => ({
            assetId: id,
            quantity: quantities[id] ?? 1,
            assetKitId: null,
          })),
          // Kit-driven slices: `assetKitId` set. Quantity precedence:
          // explicit slice qty → kit's `AssetKit.quantity` → 1.
          ...kitSlices.map((slice) => ({
            assetId: slice.assetId,
            quantity:
              slice.quantity ?? assetKitQtyById.get(slice.assetKitId) ?? 1,
            assetKitId: slice.assetKitId,
          })),
        ],
      },
    },
    select: {
      id: true,
      name: true,
      status: true,
    },
  });

  /**
   * Per-asset event for each newly attached asset. Mirrors the
   * `BOOKING_ASSETS_ADDED` emission in `updateBookingAssets` so the
   * scanner-driven path produces the same audit-trail rows as the
   * manage-assets dialog. Inside the tx — rolls back together with
   * the BookingAsset row creates above. One event per distinct asset.
   */
  if (allScannedAssetIds.length > 0) {
    await recordEvents(
      allScannedAssetIds.map((assetId) => ({
        organizationId,
        actorUserId: userId,
        action: "BOOKING_ASSETS_ADDED" as const,
        entityType: "BOOKING" as const,
        entityId: bookingId,
        bookingId,
        assetId,
      })),
      tx
    );
  }

  /** When booking is active, newly added items must be flagged checked out */
  const isActiveBooking =
    booking.status === BookingStatus.ONGOING ||
    booking.status === BookingStatus.OVERDUE;

  if (isActiveBooking) {
    if (allScannedAssetIds.length > 0) {
      await tx.asset.updateMany({
        where: { id: { in: allScannedAssetIds }, organizationId },
        data: { status: AssetStatus.CHECKED_OUT },
      });
    }

    if (kitIds.length > 0) {
      await tx.kit.updateMany({
        where: { id: { in: kitIds }, organizationId },
        data: { status: KitStatus.CHECKED_OUT },
      });
    }
  }

  return booking;
}

/**
 * Adds scanned assets (and optionally kits) to a booking.
 *
 * @param {Object} params - The parameters for the function.
 * @param {string[]} params.assetIds - Array of directly-scanned (standalone) asset IDs to add.
 * @param {Array} [params.kitSlices] - Kit-driven slice specs (one per AssetKit membership). An asset scanned via two kits yields two slices.
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
  quantities = {},
  kitSlices = [],
}: {
  assetIds: Asset["id"][];
  kitIds?: string[];
  bookingId: Booking["id"];
  organizationId: Booking["organizationId"];
  userId: string;
  /**
   * Per-asset quantity for standalone QUANTITY_TRACKED scans. Missing
   * entries default `BookingAsset.quantity` to 1.
   */
  quantities?: Record<Asset["id"], number>;
  /**
   * Kit-driven slice specs — one per `AssetKit` membership scanned.
   * See the within-tx helper for full semantics.
   */
  kitSlices?: Array<{
    assetId: string;
    assetKitId: string;
    quantity?: number;
  }>;
}) {
  try {
    /**
     * Step 1: Add assets to booking inside a transaction so we can mirror the
     * status-sync behaviour used in manage-assets. The pure-tx body lives in
     * {@link addScannedAssetsToBookingWithinTx} so the fulfil-and-checkout
     * flow can reuse the same writes under a shared transaction.
     */
    const updatedBooking = await db.$transaction(async (tx) =>
      addScannedAssetsToBookingWithinTx(tx, {
        assetIds,
        kitIds,
        bookingId,
        organizationId,
        userId,
        quantities,
        kitSlices,
      })
    );

    /**
     * Step 2: Create activity notes. The notes helper derives standalone
     * vs kit-driven attribution from `kitIds` membership, so it needs the
     * full union of standalone + kit-slice asset ids.
     */
    const allAddedAssetIds = Array.from(
      new Set([...assetIds, ...kitSlices.map((s) => s.assetId)])
    );
    await createNotesForScannedAssetsAndKits({
      booking: updatedBooking,
      assetIds: allAddedAssetIds,
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

/**
 * Loads minimal details for an existing booking when adding assets/kits to it.
 *
 * `organizationId` is required and scopes the lookup so a caller cannot read
 * another tenant's booking status or asset titles by id (cross-org IDOR).
 *
 * @param bookingId - Target booking id (from request input)
 * @param organizationId - Caller's validated organization id
 * @throws {ShelfError} if the booking is missing, cross-org, or not DRAFT/RESERVED
 */
export async function getExistingBookingDetails(
  bookingId: string,
  organizationId: string
) {
  try {
    // why: findFirst + organizationId (findUnique can't take a non-unique org
    // filter) prevents cross-org booking disclosure. We null-check explicitly
    // instead of findFirstOrThrow so a cross-org/missing id returns a clean
    // 404 "Booking not found." rather than leaking a raw Prisma error string.
    const booking = await db.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: {
        id: true,
        status: true,
        bookingAssets: {
          include: {
            asset: { select: { id: true, title: true } },
          },
        },
      },
    });

    if (!booking) {
      throw new ShelfError({
        cause: null,
        message: "Booking not found.",
        status: 404,
        label: "Booking",
        shouldBeCaptured: false,
      });
    }

    if (!["DRAFT", "RESERVED"].includes(booking.status!)) {
      throw new ShelfError({
        cause: null,
        message: "Booking is not in Draft or Reserved status.",
        status: 400,
        label: "Booking",
        shouldBeCaptured: false,
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

/**
 * Resolves the subset of the given asset IDs that can be added to a booking.
 *
 * Assets that belong to a kit are rejected (kits are added as a unit, not as
 * loose assets).
 *
 * @param assetIds - Asset IDs sourced from request/form input
 * @param organizationId - The caller's validated organization ID. Scopes the
 *   lookup so foreign-org asset IDs are silently excluded (they simply won't
 *   be returned), preventing a cross-org IDOR where an attacker in Org A could
 *   add Org B's assets to a booking.
 * @returns The IDs of the assets that exist in `organizationId` and are not
 *   part of a kit
 * @throws {ShelfError} If any selected asset belongs to a kit
 */
export async function getAvailableAssetsIdsForBooking(
  assetIds: Asset["id"][],
  organizationId: string
): Promise<string[]> {
  try {
    const selectedAssets = await db.asset.findMany({
      // SECURITY (cross-org IDOR): scope by organizationId so an attacker
      // cannot resolve / attach assets that live in another workspace.
      where: { id: { in: assetIds }, organizationId },
      select: {
        status: true,
        id: true,
        assetKits: { select: { kitId: true } },
      },
    });

    if (selectedAssets.some((asset) => asset.assetKits.length > 0)) {
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
 * Checks which of the given assets are available and returns them together
 * with the existing booking info.
 *
 * @param bookingId - The booking the assets are being added to
 * @param assetIds - Asset IDs sourced from request/form input
 * @param organizationId - The caller's validated organization ID. Forwarded to
 *   {@link getAvailableAssetsIdsForBooking} so foreign-org assets cannot be
 *   added to the booking (cross-org IDOR protection).
 * @returns The resolved (org-scoped) asset IDs and the booking details
 * @throws {ShelfError} If no assets are available or the booking lookup fails
 */
export async function processBooking(
  bookingId: string,
  assetIds: string[],
  organizationId: string
) {
  try {
    const [finalAssetIds, bookingInfo] = await Promise.all([
      getAvailableAssetsIdsForBooking(assetIds, organizationId),
      getExistingBookingDetails(bookingId, organizationId),
    ]);

    if (!finalAssetIds.length) {
      throw new ShelfError({
        cause: null,
        message: "No assets available.",
        status: 400,
        label: "Booking",
        shouldBeCaptured: false,
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
      extraInclude: {
        notificationRecipients: { select: { id: true } },
      },
    });
    const hints = getHints(request);

    /**
     * Wrap creation + activity events in a transaction so the events
     * commit atomically with the booking row (matches `createBooking`).
     * `duplicateBooking` doesn't delegate to `createBooking` because it
     * needs to copy across more fields (per-asset quantities, tags,
     * notification recipients), so we mirror the emission pattern here.
     */
    const duplicatedAssetIds = bookingToDuplicate.bookingAssets.map(
      (ba: { assetId: string }) => ba.assetId
    ) as string[];

    const newBooking = await db.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
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
          bookingAssets: {
            /**
             * Preserve per-asset booked quantity when duplicating. Without
             * this the pivot row falls back to the schema default of 1,
             * which silently drops reservation sizes for QUANTITY_TRACKED
             * assets.
             *
             * Also preserve `assetKitId` (the kit-source discriminator).
             * Polish-6 allows multiple BookingAsset rows per asset (one
             * standalone + N kit-driven). Dropping `assetKitId` would make
             * every duplicated row standalone, so an asset with both a
             * standalone and a kit-driven slice collapses to two
             * `assetKitId IS NULL` rows for the same asset — a P2002 on the
             * `BookingAsset_manual_unique (bookingId, assetId)` partial
             * unique. Copying it keeps each slice distinct.
             *
             * Note: we copy the intent verbatim — the duplicate starts in
             * DRAFT and availability is re-validated at checkout, so an
             * over-reservation here is surfaced to the user at the right
             * time instead of being silently truncated now.
             */
            create: bookingToDuplicate.bookingAssets.map((ba) => ({
              assetId: ba.assetId,
              quantity: ba.quantity,
              assetKitId: ba.assetKitId,
            })),
          },
          tags: {
            connect: bookingToDuplicate.tags.map((tag) => ({ id: tag.id })),
          },
          // Copy per-booking notification recipients from the original
          ...(bookingToDuplicate.notificationRecipients?.length
            ? {
                notificationRecipients: {
                  connect: bookingToDuplicate.notificationRecipients.map(
                    (tm: { id: string }) => ({ id: tm.id })
                  ),
                },
              }
            : {}),
        },
      });

      /**
       * Lifecycle event for the duplicated booking. Mirrors `createBooking`
       * so reports treat the duplicate as a fresh draft just like any
       * other newly created booking.
       */
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "BOOKING_CREATED",
          entityType: "BOOKING",
          entityId: created.id,
          bookingId: created.id,
          meta: {
            assetCount: duplicatedAssetIds.length,
            duplicatedFromBookingId: bookingToDuplicate.id,
          },
        },
        tx
      );

      // One BOOKING_ASSETS_ADDED event per copied asset.
      if (duplicatedAssetIds.length > 0) {
        await recordEvents(
          duplicatedAssetIds.map((assetId) => ({
            organizationId,
            actorUserId: userId,
            action: "BOOKING_ASSETS_ADDED" as const,
            entityType: "BOOKING" as const,
            entityId: created.id,
            bookingId: created.id,
            assetId,
          })),
          tx
        );
      }

      return created;
    });

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
  const count = await db.partialBookingCheckin.count({
    where: { bookingId },
  });
  return count > 0;
}

/**
 * Get partial check-in history for a booking
 */
export function getPartialCheckinHistory(bookingId: string) {
  return db.partialBookingCheckin.findMany({
    where: { bookingId },
    include: {
      checkedInBy: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
          email: true,
        },
      },
    },
    orderBy: { checkinTimestamp: "desc" },
  });
}

/**
 * Get total assets checked in via partial check-ins for a booking
 */
export async function getTotalPartialCheckinCount(
  bookingId: string
): Promise<number> {
  const result = await db.partialBookingCheckin.aggregate({
    where: { bookingId },
    _sum: { checkinCount: true },
  });
  return result._sum.checkinCount || 0;
}

/**
 * Get all unique asset IDs that have been checked in via partial check-ins
 */
export async function getPartiallyCheckedInAssetIds(
  bookingId: string
): Promise<string[]> {
  const partialCheckins = await db.partialBookingCheckin.findMany({
    where: { bookingId },
    select: { assetIds: true },
  });

  // Flatten all asset ID arrays and get unique values
  const allAssetIds = partialCheckins.flatMap((pc) => pc.assetIds);
  return [...new Set(allAssetIds)];
}

/**
 * Get detailed partial check-in data with user and date information for each asset
 * Returns both the asset IDs and the detailed check-in data in one query
 */
export async function getDetailedPartialCheckinData(bookingId: string) {
  const partialCheckins = await db.partialBookingCheckin.findMany({
    where: { bookingId },
    include: {
      checkedInBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          profilePicture: true,
        },
      },
    },
    orderBy: { checkinTimestamp: "asc" },
  });

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
  const { assetIds, checkins, checkinIntentChoice, returnJson } = parseData(
    formData,
    partialCheckinAssetsSchema.extend({
      checkinIntentChoice: z.nativeEnum(CheckinIntentEnum).optional(),
      returnJson: z
        .string()
        .optional()
        .transform((val) => val === "true"),
    })
  );

  /**
   * At least one of `assetIds` (legacy) or `checkins` (per-asset
   * dispositions) must be present. The drawer sends one of the two
   * depending on whether the booking has qty-tracked assets in play.
   */
  if (
    (!assetIds || assetIds.length === 0) &&
    (!checkins || checkins.length === 0)
  ) {
    throw new ShelfError({
      cause: null,
      status: 400,
      label,
      message: "No assets provided for check-in.",
      shouldBeCaptured: false,
    });
  }

  const hints = getClientHint(request);

  const result = await partialCheckinBooking({
    id: bookingId,
    organizationId,
    assetIds,
    checkins,
    userId,
    hints,
    intentChoice: checkinIntentChoice,
  });

  /** Effective count of assets touched in this session — for toast messaging. */
  const touchedCount = checkins?.length ?? assetIds?.length ?? 0;
  const plural = touchedCount === 1 ? "" : "s";

  const notificationMessage = result.isComplete
    ? `Successfully checked in ${touchedCount} asset${plural} and completed the booking.`
    : `Successfully checked in ${touchedCount} asset${plural} from booking.`;

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
      message: `Successfully checked in ${touchedCount} asset${plural}`,
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
    const booking = await db.booking.findFirst({
      where: {
        status: { in: [BookingStatus.ONGOING, BookingStatus.OVERDUE] },
        organizationId,
        bookingAssets: { some: { assetId } },
        partialCheckins: { none: { assetIds: { has: assetId } } }, // Exclude bookings where this asset has been partially checked in
      },
    });

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

/**
 * Replaces the per-booking notification recipients with the given team
 * member IDs. Uses Prisma's `set` operation, so the caller must provide
 * the complete desired list — any previously connected team members not
 * in `teamMemberIds` will be disconnected.
 *
 * These per-booking recipients are resolved in step 6 of
 * `getBookingNotificationRecipients()` and receive emails with the
 * `"booking_recipient"` reason label.
 *
 * @param bookingId - The booking to update
 * @param organizationId - Scoping to ensure the booking belongs to this org
 * @param teamMemberIds - Complete list of team member IDs. Pass `[]` to clear.
 */
export async function updateBookingNotificationRecipients({
  bookingId,
  organizationId,
  teamMemberIds,
}: {
  bookingId: string;
  organizationId: string;
  teamMemberIds: string[];
}) {
  try {
    // Validate that all provided team member IDs belong to this organization
    // and have a valid email, preventing cross-org data injection.
    const validTeamMembers = await db.teamMember.findMany({
      where: {
        id: { in: teamMemberIds },
        organizationId,
        user: { isNot: null },
      },
      select: { id: true },
    });
    const validTeamMemberIds = validTeamMembers.map((m) => m.id);

    return await db.booking.update({
      where: { id: bookingId, organizationId },
      data: {
        notificationRecipients: {
          set: validTeamMemberIds.map((id) => ({ id })),
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update booking notification recipients",
      additionalData: { bookingId, organizationId, teamMemberIds },
      label,
    });
  }
}
