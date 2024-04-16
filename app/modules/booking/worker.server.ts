/* eslint-disable no-console */
import { BookingStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { getTimeRemainingMessage } from "~/utils/date-fns";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { sendEmail } from "~/utils/mail.server";
import { scheduler } from "~/utils/scheduler.server";
import { schedulerKeys } from "./constants";
import {
  checkoutReminderEmailContent,
  overdueBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import {
  bookingIncludeForEmails,
  scheduleNextBookingJob,
} from "./service.server";
import type { SchedulerData } from "./types";

/** ===== start: listens and creates chain of jobs for a given booking ===== */
export const registerBookingWorkers = async () => {
  /** Check-out reminder */
  await scheduler.work<SchedulerData>(
    schedulerKeys.checkoutReminder,
    async ({ data }) => {
      try {
        const booking = await db.booking
          .findFirstOrThrow({
            where: { id: data.id },
            include: bookingIncludeForEmails,
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message: "Booking not found",
              additionalData: { data, work: schedulerKeys.checkoutReminder },
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
          });
        }

        //schedule the next job
        if (booking.to) {
          const when = new Date(booking.to);
          when.setHours(when.getHours() - 1);
          await scheduleNextBookingJob({
            data,
            when,
            key: schedulerKeys.checkinReminder,
          });
        }
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Something went wrong while executing scheduled work.",
            additionalData: { data, work: schedulerKeys.checkoutReminder },
            label: "Booking",
          })
        );
      }
    }
  );

  /** Check-in reminder */
  await scheduler.work<SchedulerData>(
    schedulerKeys.checkinReminder,
    async ({ data }) => {
      try {
        const booking = await db.booking
          .findFirstOrThrow({
            where: { id: data.id },
            include: bookingIncludeForEmails,
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message: "Booking not found",
              additionalData: { data, work: schedulerKeys.checkinReminder },
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
          await sendCheckinReminder(booking, booking._count.assets, data.hints);
        }

        //schedule the next job
        if (booking.to) {
          const when = new Date(booking.to);
          await scheduleNextBookingJob({
            data,
            when,
            key: schedulerKeys.overdueHandler,
          });
        }
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Something went wrong while executing scheduled work.",
            additionalData: { data, work: schedulerKeys.checkinReminder },
            label: "Booking",
          })
        );
      }
    }
  );

  /** overdue handler */
  await scheduler.work<SchedulerData>(
    schedulerKeys.overdueHandler,
    async ({ data }) => {
      try {
        const booking = await db.booking
          .update({
            where: { id: data.id, status: BookingStatus.ONGOING },
            data: { status: BookingStatus.OVERDUE },
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message: "Booking update failed",
              additionalData: { data, work: schedulerKeys.overdueHandler },
              label: "Booking",
            });
          });

        //schedule the next job
        if (booking.to) {
          const when = new Date(booking.to);
          when.setHours(when.getHours());
          await scheduleNextBookingJob({
            data,
            when,
            key: schedulerKeys.overdueReminder,
          });
        }
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Something went wrong while executing scheduled work.",
            additionalData: { data, work: schedulerKeys.overdueHandler },
            label: "Booking",
          })
        );
      }
    }
  );

  /** Overdue reminder */
  await scheduler.work<SchedulerData>(
    schedulerKeys.overdueReminder,
    async ({ data }) => {
      try {
        const booking = await db.booking
          .findFirstOrThrow({
            where: { id: data.id },
            include: bookingIncludeForEmails,
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message: "Booking not found",
              additionalData: { data, work: schedulerKeys.overdueReminder },
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
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Something went wrong while executing scheduled work.",
            additionalData: { data, work: schedulerKeys.overdueReminder },
            label: "Booking",
          })
        );
      }
    }
  );
  /** ===== end: listens and creates chain of jobs for a given booking ===== */
};
