/* eslint-disable no-console */
import { BookingStatus } from "@prisma/client";
import type PgBoss from "pg-boss";
import { db } from "~/database/db.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { getTimeRemainingMessage } from "~/utils/date-fns";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { sendEmail } from "~/utils/mail.server";
import { scheduler } from "~/utils/scheduler.server";
import { bookingSchedulerEventsEnum, schedulerKeys } from "./constants";
import {
  checkoutReminderEmailContent,
  overdueBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import {
  bookingIncludeForEmails,
  scheduleNextBookingJob,
} from "./service.server";
import type { SchedulerData, SchedulerDataDeprecated } from "./types";

const checkoutReminder = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await db.booking
    .findFirstOrThrow({
      where: { id: data.id },
      include: bookingIncludeForEmails,
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
    await sendEmail({
      to: email,
      subject: `Checkout reminder (${booking.name}) - shelf.nu`,
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
    }).catch((cause) => {
      //lets not fail the process because of email failure
      Logger.warn(
        new ShelfError({
          cause,
          message: "Failed to send checkout reminder email",
          additionalData: { data, work: data.eventType },
          label: "Booking",
        })
      );
    });
  }

  //schedule the next job
  if (booking.to) {
    const when = new Date(booking.to);
    when.setHours(when.getHours() - 1);
    await scheduleNextBookingJob({
      data: {
        ...data,
        eventType: bookingSchedulerEventsEnum.checkinReminder,
      },
      when,
    });
  }
};

const checkinReminder = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await db.booking
    .findFirstOrThrow({
      where: { id: data.id },
      include: bookingIncludeForEmails,
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
    await sendCheckinReminder(booking, booking._count.assets, data.hints).catch(
      (err) => {
        Logger.warn(err);
      }
    );
  }

  //schedule the next job
  if (booking.to) {
    const when = new Date(booking.to);
    await scheduleNextBookingJob({
      data: { ...data, eventType: bookingSchedulerEventsEnum.overdueHandler },
      when,
    });
  }
};

const overdueHandler = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await db.booking
    .update({
      where: { id: data.id, status: BookingStatus.ONGOING },
      data: { status: BookingStatus.OVERDUE },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Booking update failed",
        additionalData: { data, work: data.eventType },
        label: "Booking",
      });
    });

  //schedule the next job
  if (booking.to) {
    const when = new Date(booking.to);
    when.setHours(when.getHours());
    await scheduleNextBookingJob({
      data: {
        ...data,
        eventType: bookingSchedulerEventsEnum.overdueReminder,
      },
      when,
    });
  }
};

const overdueReminder = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await db.booking
    .findFirstOrThrow({
      where: { id: data.id },
      include: bookingIncludeForEmails,
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Booking not found",
        additionalData: { data, work: data.eventType },
        label: "Booking",
      });
    });

  if (booking.status !== BookingStatus.OVERDUE) {
    Logger.warn(
      `ignoring overdueReminder for booking with id ${data.id}, as its not in overdue status`
    );
    return;
  }

  const email = booking.custodianUser?.email;

  if (email) {
    await sendEmail({
      to: email,
      subject: `Overdue booking (${booking.name}) - shelf.nu`,
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
  bookingSchedulerEventsEnum,
  (job: PgBoss.Job<SchedulerData>) => Promise<void>
> = {
  [bookingSchedulerEventsEnum.checkinReminder]: checkinReminder,
  [bookingSchedulerEventsEnum.checkoutReminder]: checkoutReminder,
  [bookingSchedulerEventsEnum.overdueHandler]: overdueHandler,
  [bookingSchedulerEventsEnum.overdueReminder]: overdueReminder,
};

/** ===== start: listens and creates chain of jobs for a given booking ===== */
export const registerBookingWorkers = async () => {
  /** Check-out reminder */
  await scheduler.work<SchedulerData>(
    schedulerKeys.bookingQueue,
    async (job) => {
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
    }
  );

  // === @TODO MUST remove this once no more jobs with name values(`bookingSchedulerEventsEnum`) found in DB
  // keeping it causes unncessary polling to db(2 calls / min)
  // this is just for backward compatibility ===
  await Promise.all(
    Object.values(bookingSchedulerEventsEnum).map(async (key) => {
      await scheduler.work<SchedulerDataDeprecated>(key, async (job) => {
        const handler = event2HandlerMap[key];
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
        const data: SchedulerData = { ...job.data, eventType: key };
        try {
          await handler({ ...job, data });
        } catch (cause) {
          Logger.error(
            new ShelfError({
              cause,
              message: "Something went wrong while executing scheduled work.",
              additionalData: { data: job.data, work: key },
              label: "Booking",
            })
          );
        }
      });
    })
  );
  // === END ===
};
