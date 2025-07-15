import { BookingStatus, AssetStatus, KitStatus } from "@prisma/client";
import type {
  Booking,
  Prisma,
  Organization,
  Asset,
  Kit,
  User,
  UserOrganization,
  Tag,
} from "@prisma/client";
import { isBefore } from "date-fns";
import { DateTime } from "luxon";
import { CheckinIntentEnum } from "~/components/booking/checkin-dialog";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";
import type { HeaderData } from "~/components/layout/header/types";
import type { SortingDirection } from "~/components/list/filters/sort-by";
import { db } from "~/database/db.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import {
  getClientHint,
  getDateTimeFormatFromHints,
  type ClientHint,
} from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import {
  getFiltersFromRequest,
  updateCookieWithPerPage,
} from "~/utils/cookies.server";
import { calcTimeDifference } from "~/utils/date-fns";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import type { MergeInclude } from "~/utils/utils";
import {
  BOOKING_COMMON_INCLUDE,
  BOOKING_INCLUDE_FOR_EMAIL,
  BOOKING_SCHEDULER_EVENTS_ENUM,
  BOOKING_WITH_ASSETS_INCLUDE,
} from "./constants";
import {
  assetReservedEmailContent,
  cancelledBookingEmailContent,
  completedBookingEmailContent,
  deletedBookingEmailContent,
  extendBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import { isBookingEarlyCheckin, isBookingEarlyCheckout } from "./helpers";
import type {
  BookingLoaderResponse,
  BookingWithExtraInclude,
  ClashingBooking,
  SchedulerData,
} from "./types";
import {
  formatBookingsDates,
  getBookingWhereInput,
  isBookingExpired,
} from "./utils.server";
import { createNotes } from "../note/service.server";
import { getOrganizationAdminsEmails } from "../organization/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Booking";

async function cancelScheduler(
  b?: Pick<Booking, "activeSchedulerReference"> | null
) {
  try {
    if (b?.activeSchedulerReference) {
      await scheduler.cancel(b.activeSchedulerReference);
    }
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to cancel the scheduler for booking",
        additionalData: { booking: b },
        label,
      })
    );
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
    return await db.asset.updateMany({
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
    return await db.kit.updateMany({
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
      dataToCreate.assets = {
        connect: assetIds.map((id) => ({ id })),
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

    return await db.booking.create({
      data: dataToCreate,
      include: { ...BOOKING_COMMON_INCLUDE, organization: true },
    });
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
  }) {
  try {
    const booking = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          custodianUserId: true,
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
        dataToUpdate.custodianTeamMember = {
          connect: { id: custodianTeamMemberId },
        };

        /**
         * If a userId is passed, meaning the team member is connected to a user, we connct to it.
         * This will override the value if there were any previous custodians`
         */
        if (custodianUserId) {
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

    return await db.booking.update({
      where: { id: booking.id },
      data: dataToUpdate,
    });
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
  }) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          ...BOOKING_INCLUDE_FOR_EMAIL,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in current workspace?",
        });
      });

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
      dataToUpdate.custodianTeamMember = {
        connect: { id: custodianTeamMemberId },
      };

      /**
       * If a userId is passed, meaning the team member is connected to a user, we connct to it.
       * This will override the value if there were any previous custodians`
       */
      if (custodianUserId) {
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

    if (bookingFound.custodianUser?.email) {
      const custodian = bookingFound?.custodianUser
        ? `${bookingFound.custodianUser.firstName} ${bookingFound.custodianUser.lastName}`
        : bookingFound.custodianTeamMember?.name ?? "";

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
      });

      const html = bookingUpdatesTemplateString({
        booking: bookingFound,
        heading: `Booking reservation for ${custodian}`,
        assetCount: bookingFound._count.assets,
        hints,
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

        sendEmail({
          to: adminsEmails.join(","),
          subject: adminSubject,
          text,
          /** We need to invoke this function separately for the admin email as the footer of emails is different */
          html: bookingUpdatesTemplateString({
            booking: bookingFound,
            heading: `Booking reservation request for ${custodian}`,
            assetCount: bookingFound._count.assets,
            hints,
            isAdminEmail: true,
          }),
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

    return updatedBooking;
  } catch (cause) {
    throw new ShelfError({
      cause: null,
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
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  intentChoice?: CheckoutIntentEnum;
}) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: {
          assets: true,
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

    const updatedBooking = await db.$transaction(async (tx) => {
      /* Updating the status of all assets inside booking */
      await tx.asset.updateMany({
        where: { id: { in: bookingFound.assets.map((a) => a.id) } },
        data: { status: AssetStatus.CHECKED_OUT },
      });

      /** If there are any kits associated with the booking, then update their status */
      if (hasKits) {
        await tx.kit.updateMany({
          where: { id: { in: kitIds } },
          data: { status: KitStatus.CHECKED_OUT },
        });
      }

      /** Finally update the booking */
      return tx.booking.update({
        where: { id: bookingFound.id },
        data: dataToUpdate,
        include: {
          ...BOOKING_INCLUDE_FOR_EMAIL,
          assets: true,
        },
      });
    });

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
        sendCheckinReminder(bookingFound, bookingFound._count.assets, hints);
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
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
  intentChoice?: CheckinIntentEnum;
}) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        include: { assets: { select: { id: true, kitId: true } } },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          status: 404,
          label,
          message:
            "Booking not found, are you sure it exists in current workspace.",
        });
      });

    const dataToUpdate: Prisma.BookingUpdateInput = {
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

    const updatedBooking = await db.$transaction(async (tx) => {
      /* Updating the status of all assets inside booking */
      await tx.asset.updateMany({
        where: { id: { in: bookingFound.assets.map((a) => a.id) } },
        data: { status: AssetStatus.AVAILABLE },
      });

      /* If there are any kits associated with the booking, then update their status */
      if (hasKits) {
        await tx.kit.updateMany({
          where: { id: { in: kitIds } },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Finally update the booking */
      return tx.booking.update({
        where: { id: bookingFound.id },
        data: dataToUpdate,
        include: {
          ...BOOKING_INCLUDE_FOR_EMAIL,
          assets: true,
        },
      });
    });

    /**
     * At this point when user is checking in the booking,
     * we just have to cancel all active scheduler (if there is any).
     * Because, if the only possible case is OVERDUE, and if it was OVERDUE
     * during the checkin it must have been handled by overdueHandler.
     */
    await cancelScheduler(updatedBooking);

    if (updatedBooking.custodianUser?.email) {
      const custodian = updatedBooking?.custodianUser
        ? `${updatedBooking.custodianUser.firstName} ${updatedBooking.custodianUser.lastName}`
        : updatedBooking.custodianTeamMember?.name ?? "";

      const subject = `🎉 Booking completed (${updatedBooking.name}) - shelf.nu`;
      const text = completedBookingEmailContent({
        bookingName: updatedBooking.name,
        assetsCount: updatedBooking._count.assets,
        custodian: custodian,
        from: updatedBooking.from as Date, // We can safely cast here as we know the booking is overdue so it must have a from and to date
        to: updatedBooking.to as Date,
        bookingId: updatedBooking.id,
        hints: hints,
      });

      const html = bookingUpdatesTemplateString({
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

export async function updateBookingAssets({
  id,
  organizationId,
  assetIds,
}: Pick<Booking, "id" | "organizationId"> & {
  assetIds: Asset["id"][];
}) {
  try {
    const booking = await db.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id, organizationId },
        data: {
          assets: {
            connect: assetIds.map((id) => ({ id })),
          },
        },
        select: {
          id: true,
          name: true,
          status: true,
        },
      });

      /**
       *  When adding an asset to a booking, we need to update the status of the asset to CHECKED_OUT if the booking is ONGOING or OVERDUE
       */
      if (
        b.status === BookingStatus.ONGOING ||
        b.status === BookingStatus.OVERDUE
      ) {
        await db.asset.updateMany({
          where: { id: { in: assetIds }, organizationId },
          data: { status: AssetStatus.CHECKED_OUT },
        });
      }
      return b;
    });

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

export async function archiveBooking({
  id,
  organizationId,
}: Pick<Booking, "id" | "organizationId">) {
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
          title: "Not found",
          message:
            "Booking not found, are you sure it exists in current workspace?",
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

    return await db.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.ARCHIVED },
    });
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
}: Pick<Booking, "id" | "organizationId"> & {
  hints: ClientHint;
}) {
  try {
    const bookingFound = await db.booking
      .findUniqueOrThrow({
        where: { id, organizationId },
        select: {
          id: true,
          status: true,
          assets: { select: { id: true, kitId: true } },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in current workspace?",
        });
      });

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

    const booking = await db.$transaction(async (tx) => {
      /** If booking is ONGOING or OVERDUE, we have to make the assets available */
      if (bookingFound.status !== BookingStatus.RESERVED) {
        await tx.asset.updateMany({
          where: { id: { in: bookingFound.assets.map((a) => a.id) } },
          data: { status: AssetStatus.AVAILABLE },
        });

        /** If there are any kits, then update their status as well */
        if (hasKits) {
          await tx.kit.updateMany({
            where: { id: { in: kitIds } },
            data: { status: KitStatus.AVAILABLE },
          });
        }
      }

      return tx.booking.update({
        where: { id: bookingFound.id },
        data: { status: BookingStatus.CANCELLED },
        include: {
          assets: true,
          ...BOOKING_INCLUDE_FOR_EMAIL,
        },
      });
    });

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
      });

      const html = bookingUpdatesTemplateString({
        booking: booking,
        heading: `Your booking has been cancelled: "${booking.name}".`,
        assetCount: booking._count.assets,
        hints,
      });

      sendEmail({
        to: booking.custodianUser.email,
        subject,
        text,
        html,
      });
    }

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
}: Pick<Booking, "id" | "organizationId">) {
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
      where: { id: booking.id },
      data: { status: BookingStatus.DRAFT },
    });

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
}: Pick<Booking, "id" | "organizationId"> & {
  newEndDate: Date;
  hints: ClientHint;
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
          assets: { select: { id: true } },
          from: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          label,
          message:
            "Booking not found. Are you sure it exists in the current workspace?",
        });
      });

    /** Checking if the booking period is clashing with any other booking containing the same asset(s).*/
    const clashingBookings: ClashingBooking[] = await db.booking.findMany({
      where: {
        id: { not: booking.id },
        organizationId,
        status: {
          in: [BookingStatus.RESERVED],
        },
        assets: { some: { id: { in: booking.assets.map((a) => a.id) } } },
        // Check for bookings that start within the extension period
        from: {
          gt: booking.to!,
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

    const updatedBooking = await db.booking.update({
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

    /** Send extended booking email */
    if (updatedBooking?.custodianUser?.email) {
      const custodian = updatedBooking?.custodianUser
        ? `${updatedBooking.custodianUser.firstName} ${updatedBooking.custodianUser.lastName}`
        : updatedBooking.custodianTeamMember?.name ?? "";

      const text = extendBookingEmailContent({
        bookingName: updatedBooking.name,
        assetsCount: updatedBooking._count.assets,
        custodian,
        from: updatedBooking.from!,
        to: updatedBooking.to!,
        hints,
        bookingId: updatedBooking.id,
        oldToDate: booking.to!,
      });

      const { format } = getDateTimeFormatFromHints(hints, {
        dateStyle: "short",
        timeStyle: "short",
      });

      const html = bookingUpdatesTemplateString({
        booking: updatedBooking,
        heading: `Booking extended from ${format(booking.to!)} to ${format(
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
        sendCheckinReminder(
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
    name: "bookingFilter",
    path: "/bookings",
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
    let where: Prisma.BookingWhereInput = { organizationId };

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
      where.name = {
        contains: search.trim(),
        mode: "insensitive",
      };
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
      where.OR = [
        {
          from: { lte: bookingTo },
          to: { gte: bookingFrom },
        },
        {
          from: { gte: bookingFrom },
          to: { lte: bookingTo },
        },
      ];
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

    const [bookings, bookingCount] = await Promise.all([
      db.booking.findMany({
        ...(!takeAll && {
          skip,
          take,
        }),
        where,
        include: {
          ...BOOKING_COMMON_INCLUDE,
          assets: {
            select: {
              title: true,
              id: true,
              custody: true,
              availableToBook: true,
            },
          },
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
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
  organizationId,
}: {
  booking: Pick<Booking, "id"> & {
    assetIds: Asset["id"][];
  };
  firstName: string;
  lastName: string;
  userId: string;
  kitIds?: Kit["id"][];
  organizationId: Booking["organizationId"];
}) {
  try {
    const { assetIds, id } = booking;
    const b = await db.booking.update({
      // First, disconnect the assets from the booking
      where: { id, organizationId },
      data: {
        assets: {
          disconnect: assetIds.map((id) => ({ id })),
        },
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

    await createNotes({
      content: `**${firstName?.trim()} ${lastName?.trim()}** removed asset from booking **[${
        b.name
      }](/bookings/${b.id})**.`,
      type: "UPDATE",
      userId,
      assetIds,
    });

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
  try {
    const { id, organizationId } = booking;
    const activeBooking = await db.booking.findFirst({
      where: {
        id,
        status: { in: [BookingStatus.OVERDUE, BookingStatus.ONGOING] },
        organizationId,
      },
      include: {
        assets: {
          select: {
            id: true,
            kitId: true,
          },
        },
      },
    });

    const assetWithKits = activeBooking?.assets.filter((a) => !!a.kitId) ?? [];
    const uniqueKitIds = new Set(
      assetWithKits.map((a) => a.kitId) as unknown as string
    );
    const hasKits = uniqueKitIds.size > 0;

    const b = await db.booking.delete({
      where: { id, organizationId },
      include: {
        ...BOOKING_COMMON_INCLUDE,
        ...BOOKING_INCLUDE_FOR_EMAIL,
        assets: {
          select: {
            id: true,
          },
        },
      },
    });

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
      });
      const html = bookingUpdatesTemplateString({
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
    await cancelScheduler(b);

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
    request?: Request;
    extraInclude?: T;
  }
) {
  try {
    const { id, organizationId, userOrganizations, request, extraInclude } =
      booking;

    /**
     * On the booking page, we need some data related to the assets added, so we know what actions are possible
     *
     * For reserving a booking, we need to make sure that the assets in the booking dont have any other bookings that overlap with the current booking
     * Moreover we just query certain statuses as they are the only ones that matter for an asset being considered unavailable
     */
    const mergedInclude = {
      ...BOOKING_WITH_ASSETS_INCLUDE,
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

  const { searchParams, search, status, teamMemberIds, tags } =
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
      tags,
      extraInclude: {
        custodianTeamMember: true,
        custodianUser: true,
        tags: { select: { id: true, name: true } },
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
          url: `/bookings/${booking.id}`,
          classNames: [
            `bookingId-${booking.id}`,
            ...getStatusClasses(
              booking.status,
              isOneDayEvent(booking.from as Date, booking.to as Date)
            ),
          ],
          extendedProps: {
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
  const assets = await db.asset.findMany({
    where: { id: { in: booking.assetIds } },
    include: {
      category: true,
      custody: true,
      kit: true,
      bookings: {
        where: {
          ...(booking.from && booking.to
            ? {
                status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
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
              }
            : {}),
        },
      },
    },
  });

  const hasAssets = assets.length > 0;

  const hasUnavailableAssets = assets.some((asset) => !asset.availableToBook);

  const hasCheckedOutAssets = assets.some(
    (asset) => asset.status === AssetStatus.CHECKED_OUT
  );

  const hasAlreadyBookedAssets = assets.some(
    (asset) => asset.bookings && asset.bookings.length > 0
  );

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
    const where: Prisma.BookingWhereInput = bookingIds.includes(
      ALL_SELECTED_KEY
    )
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const [bookings, user] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          custodianTeamMember: true,
          custodianUser: true,
          organization: { include: { owner: { select: { email: true } } } },
          _count: { select: { assets: true } },
          assets: { select: { id: true, kitId: true } },
        },
      }),
      getUserByID(userId),
    ]);

    /** We have to send mails to custodianUsers */
    const bookingsToSendEmail = bookings.filter(
      (booking) => !!booking.custodianUser?.email
    );

    /** If some booking was OVERDUE or ONGOING, we have to make their assets and kits available */
    const overdueOrOngoingBookings = bookings.filter(
      (booking) => booking.status === "OVERDUE" || booking.status === "ONGOING"
    );

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = overdueOrOngoingBookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    await db.$transaction(async (tx) => {
      /** Deleting all selected bookings */
      await tx.booking.deleteMany({
        where: { id: { in: bookings.map((booking) => booking.id) } },
      });

      /** Making assets and kits available */
      if (overdueOrOngoingBookings.length > 0) {
        const allAssets = overdueOrOngoingBookings.flatMap(
          (booking) => booking.assets
        );

        const allKitIds = allAssets
          .filter((asset) => !!asset.kitId)
          .map((asset) => asset.kitId as string);

        const uniqueKitIds = new Set(allKitIds);

        await tx.asset.updateMany({
          where: { id: { in: allAssets.map((asset) => asset.id) } },
          data: { status: AssetStatus.AVAILABLE },
        });

        await tx.kit.updateMany({
          where: { id: { in: [...uniqueKitIds] } },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Making notes for all the assets */
      const notesData = bookings
        .map((booking) =>
          booking.assets.map((asset) => ({
            userId,
            assetId: asset.id,
            content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** deleted booking **${
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

    const emailConfigs = bookingsToSendEmail.map((b) => ({
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
      html: bookingUpdatesTemplateString({
        booking: b,
        heading: `Your booking as been deleted: "${b.name}"`,
        assetCount: b.assets.length,
        hints,
        hideViewButton: true,
      }),
    }));

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
    const where: Prisma.BookingWhereInput = bookingIds.includes(
      ALL_SELECTED_KEY
    )
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const bookings = await db.booking.findMany({ where });

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
        where: { id: { in: bookings.map((b) => b.id) } },
        data: { status: BookingStatus.ARCHIVED },
      });
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
          custodianTeamMember: true,
          custodianUser: true,
          organization: { include: { owner: { select: { email: true } } } },
          _count: { select: { assets: true } },
          assets: { select: { id: true, kitId: true } },
        },
      }),
      getUserByID(userId),
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

    /** We have to send mails to custodianUsers */
    const bookingsToSendEmail = bookings.filter(
      (booking) => !!booking.custodianUser?.email
    );

    /** We have to make all the assets and kits available if the booking as ongoing or overdue */
    const ongoingOrOverdueBookings = bookings.filter(
      (b) => b.status === "ONGOING" || b.status === "OVERDUE"
    );

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = ongoingOrOverdueBookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    await db.$transaction(async (tx) => {
      /** Updating status of bookings to CANCELLED */
      await tx.booking.updateMany({
        where: { id: { in: bookings.map((b) => b.id) } },
        data: { status: BookingStatus.CANCELLED },
      });

      /** Updating status of assets and kits  */
      if (ongoingOrOverdueBookings.length > 0) {
        const allAssets = ongoingOrOverdueBookings.flatMap((b) => b.assets);
        const allKitIds = allAssets
          .filter((a) => !!a.kitId)
          .map((a) => a.kitId as string);

        const uniqueKitIds = new Set(allKitIds);

        /** Making assets available */
        await tx.asset.updateMany({
          where: { id: { in: allAssets.map((a) => a.id) } },
          data: { status: AssetStatus.AVAILABLE },
        });

        /** Making kits available */
        await tx.kit.updateMany({
          where: { id: { in: [...uniqueKitIds] } },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Making notes for all the assets */
      const notesData = bookings
        .map((b) =>
          b.assets.map((asset) => ({
            assetId: asset.id,
            content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** cancelled booking **[${
              b.name
            }](/bookings/${b.id})**.`,
            userId,
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

    /** Sending cancellation emails */
    await Promise.all(
      bookingsToSendEmail.map((b) => {
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
        });

        const html = bookingUpdatesTemplateString({
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

export async function addScannedAssetsToBooking({
  assetIds,
  bookingId,
  organizationId,
}: {
  assetIds: Asset["id"][];
  bookingId: Booking["id"];
  organizationId: Booking["organizationId"];
}) {
  try {
    const booking = await db.booking.findFirstOrThrow({
      where: { id: bookingId, organizationId },
    });

    /** We just add all the assets to the booking, and let the user manage the list on the booking page.
     * If there are already checked out or in custody assets, the user wont be able to check out
     */

    /** Adding assets into booking */
    return await db.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          assets: {
            connect: assetIds.map((id) => ({ id })),
          },
        },
      });
    });
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while adding scanned assets to booking.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { assetIds, bookingId, organizationId },
      label,
    });
  }
}

export async function getExistingBookingDetails(bookingId: string) {
  try {
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        assets: { select: { id: true, title: true } },
      },
    });

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
    const selectedAssets = await db.asset.findMany({
      where: { id: { in: assetIds } },
      select: { status: true, id: true, kitId: true },
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

  // Format booking dates
  const items = formatBookingsDates(bookings, request);

  return {
    showModal: true,
    header,
    bookings: items,
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
