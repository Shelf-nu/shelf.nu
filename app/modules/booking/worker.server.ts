/* eslint-disable no-console */
import { BookingStatus } from "@prisma/client";
import { db } from "~/database";
import { sendEmail } from "~/utils/mail.server";
import { scheduler } from "~/utils/scheduler.server";
import { schedulerKeys } from "./constants";
import {
  checkoutReminderEmailContent,
  overdueBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import { scheduleNextBookingJob } from "./service.server";
import type { SchedulerData } from "./types";

/** ===== start: listens and creates chain of jobs for a given booking ===== */

let counter = 0;
export const registerBookingWorkers = () => {
  console.log(`called registerBookingWorkers ${++counter} `);

  /** Check-out reminder */
  scheduler.work<SchedulerData>(
    schedulerKeys.checkoutReminder,
    async ({ data }) => {
      const booking = await db.booking.findFirst({
        where: { id: data.id },
        include: {
          custodianTeamMember: true,
          custodianUser: true,
          organization: true,
          _count: {
            select: { assets: true },
          },
        },
      });
      if (!booking) {
        console.warn(
          `booking with id ${data.id} not found in checkoutReminder worker`
        );
        return;
      }
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
        }).catch((err) => {
          console.error(`failed to send checkoutReminder email`, err);
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
    }
  );

  /** Check-in reminder */
  scheduler.work<SchedulerData>(
    schedulerKeys.checkinReminder,
    async ({ data }) => {
      const booking = await db.booking.findFirst({
        where: { id: data.id },
        include: {
          custodianTeamMember: true,
          custodianUser: true,
          organization: true,
          _count: {
            select: { assets: true },
          },
        },
      });
      if (!booking) {
        console.warn(
          `booking with id ${data.id} not found in checkinReminder worker`
        );
        return;
      }
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
        await sendCheckinReminder(
          booking,
          booking._count.assets,
          data.hints
        ).catch((err) => {
          console.error(`failed to send checkin reminder email`, err);
        });
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
    }
  );

  /** overdue handler */
  scheduler.work<SchedulerData>(
    schedulerKeys.overdueHandler,
    async ({ data }) => {
      const booking = await db.booking.update({
        where: { id: data.id, status: BookingStatus.ONGOING },
        data: { status: BookingStatus.OVERDUE },
      });
      if (!booking) {
        console.warn(
          `booking with id ${data.id} and status ${BookingStatus.ONGOING} not found in overdueHandler worker`
        );
        return;
      }

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
    }
  );

  /** Overdue reminder */
  scheduler.work<SchedulerData>(
    schedulerKeys.overdueReminder,
    async ({ data }) => {
      const booking = await db.booking.findFirst({
        where: { id: data.id },
        include: {
          custodianTeamMember: true,
          custodianUser: true,
          organization: true,
          _count: {
            select: { assets: true },
          },
        },
      });
      if (!booking) {
        console.warn(
          `booking with id ${data.id} not found in overdueReminder worker`
        );
        return;
      }
      if (booking.status !== BookingStatus.OVERDUE) {
        console.warn(
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
            from: booking.from as Date, // We can safely cast here as we know the booking is overdue so it myust have a from and to date
            to: booking.to as Date,
            bookingId: booking.id,
            hints: data.hints,
          }),
        }).catch((err) => {
          console.error(`failed to send overdue reminder email`, err);
        });
      }
    }
  );
  /** ===== end: listens and creates chain of jobs for a given booking ===== */
};
