/* eslint-disable no-console */
import { BookingStatus } from "@prisma/client";
import type PgBoss from "pg-boss";
import { db } from "~/database/db.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import { getTimeRemainingMessage } from "~/utils/date-fns";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import {
  BOOKING_INCLUDE_FOR_EMAIL,
  BOOKING_SCHEDULER_EVENTS_ENUM,
} from "./constants";
import {
  checkoutReminderEmailContent,
  overdueBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import { scheduleNextBookingJob } from "./service.server";
import type { SchedulerData } from "./types";

const checkoutReminder = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await db.booking
    .findFirstOrThrow({
      where: { id: data.id },
      include: BOOKING_INCLUDE_FOR_EMAIL,
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Booking not found",
        additionalData: { data, work: data.eventType },
        label: "Booking",
      });
    });

  const email = booking.custodianUser?.email;

  if (email && booking.from && booking.to) {
    sendEmail({
      to: email,
      subject: `🔔 Checkout reminder (${booking.name}) - shelf.nu`,
      text: checkoutReminderEmailContent({
        bookingName: booking.name,
        assetsCount: booking._count.assets,
        custodian:
          `${booking.custodianUser?.firstName} ${booking.custodianUser?.lastName}` ||
          (booking.custodianTeamMember?.name as string),
        from: booking.from,
        to: booking.to,
        bookingId: booking.id,
        hints: data.hints,
      }),
      html: bookingUpdatesTemplateString({
        booking,
        heading: `Your booking is due for checkout in ${getTimeRemainingMessage(
          new Date(booking.from),
          new Date()
        )}.`,
        assetCount: booking._count.assets,
        hints: data.hints,
      }),
    });
  }
};

const checkinReminder = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await db.booking
    .findFirstOrThrow({
      where: { id: data.id },
      include: BOOKING_INCLUDE_FOR_EMAIL,
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Booking not found",
        additionalData: { data, work: data.eventType },
        label: "Booking",
      });
    });

  const email = booking.custodianUser?.email;

  /**
   * We need to meet some conditions to send the reminder, most important the booking needs to be ongoing so we dont send check-in reminder for assets that are not even checked out yet
   */
  if (
    email &&
    booking.from &&
    booking.to &&
    booking.status === BookingStatus.ONGOING
  ) {
    sendCheckinReminder(booking, booking._count.assets, data.hints);
  }

  //schedule the next job
  // if the booking is ongoing and has a to date, we schedule the overdue handler
  // this is to make sure we dont schedule the overdue handler if the booking is already OVERDUE && still RESERVED
  if (booking.to && booking.status === BookingStatus.ONGOING) {
    const when = new Date(booking.to);
    await scheduleNextBookingJob({
      data: {
        ...data,
        eventType: BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler,
      },
      when,
    });
  }
};

const overdueHandler = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await db.booking
    .update({
      where: { id: data.id, status: BookingStatus.ONGOING },
      data: { status: BookingStatus.OVERDUE },
      include: BOOKING_INCLUDE_FOR_EMAIL,
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Booking update failed",
        additionalData: { data, work: data.eventType },
        label: "Booking",
      });
    });

  /** Check this just in case  */
  if (booking.status !== BookingStatus.OVERDUE) {
    Logger.warn(
      `ignoring overdueReminder for booking with id ${data.id}, as its not in overdue status`
    );
    return;
  }

  /** Send the OVERDUE email */
  const email = booking.custodianUser?.email;

  if (email) {
    sendEmail({
      to: email,
      subject: `⚠️ Overdue booking (${booking.name}) - shelf.nu`,
      text: overdueBookingEmailContent({
        bookingName: booking.name,
        assetsCount: booking._count.assets,
        custodian:
          `${booking.custodianUser?.firstName} ${booking.custodianUser?.lastName}` ||
          (booking.custodianTeamMember?.name as string),
        from: booking.from as Date, // We can safely cast here as we know the booking is overdue so it must have a from and to date
        to: booking.to as Date,
        bookingId: booking.id,
        hints: data.hints,
      }),
      html: bookingUpdatesTemplateString({
        booking,
        heading: `You have passed the deadline for checking in your booking "${booking.name}".`,
        assetCount: booking._count.assets,
        hints: data.hints,
      }),
    });
  }
};

const event2HandlerMap: Record<
  BOOKING_SCHEDULER_EVENTS_ENUM,
  (job: PgBoss.Job<SchedulerData>) => Promise<void>
> = {
  [BOOKING_SCHEDULER_EVENTS_ENUM.checkoutReminder]: checkoutReminder,
  [BOOKING_SCHEDULER_EVENTS_ENUM.checkinReminder]: checkinReminder,
  [BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler]: overdueHandler,
};

/** ===== start: listens and creates chain of jobs for a given booking ===== */
export const registerBookingWorkers = async () => {
  /** Check-out reminder */
  await scheduler.work<SchedulerData>(QueueNames.bookingQueue, async (job) => {
    const handler = event2HandlerMap[job.data.eventType];
    if (typeof handler != "function") {
      Logger.error(
        new ShelfError({
          cause: null,
          message: "Wrong event type received for the scheduled worker",
          additionalData: { job },
          label: "Booking",
        })
      );
      return;
    }
    try {
      await handler(job);
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Something went wrong while executing scheduled work.",
          additionalData: { data: job.data, work: job.data.eventType },
          label: "Booking",
        })
      );
    }
  });
};
