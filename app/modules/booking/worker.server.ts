import { db } from "~/database";
import { sendEmail } from "~/utils/mail.server";
import { scheduler } from "~/utils/scheduler.server";
import { schedulerKeys } from "./constants";

interface SchedulerData {
  id: string;
}

scheduler.work<SchedulerData>(
  schedulerKeys.checkoutReminder,
  async ({ data }) => {
    const booking = await db.booking.findFirst({
      where: { id: data.id },
      include: {
        custodianTeamMember: true,
        custodianUser: true,
        organization: true,
      },
    });
    if (!booking) {
      console.warn(
        `booking with id ${data.id} not found in checkoutReminder worker`
      );
      return;
    }
    const email = booking.custodianUser?.email;
    if (email) {
      await sendEmail({
        to: email,
        subject: `checkout reminder`,
        text: `you have 1 hour to checkout your booking ${booking.name} of ${booking.organization.name}`,
      }).catch((err) => {
        console.error(`failed to send checkoutReminder email`, err);
      });
    }
    //schedule the next job
    if (booking.to) {
      const when = new Date(booking.to);
      when.setHours(when.getHours() - 1);
      const id = await scheduler.sendAfter(
        schedulerKeys.checkinReminder,
        data,
        {},
        when
      );
      await db.booking.update({
        where: { id: booking.id },
        data: { activeSchedulerReference: id },
      });
    }
  }
);

scheduler.work<SchedulerData>(
  schedulerKeys.checkinReminder,
  async ({ data }) => {
    const booking = await db.booking.findFirst({
      where: { id: data.id },
      include: {
        custodianTeamMember: true,
        custodianUser: true,
        organization: true,
      },
    });
    if (!booking) {
      console.warn(
        `booking with id ${data.id} not found in checkinReminder worker`
      );
      return;
    }
    const email = booking.custodianUser?.email;
    if (email) {
      await sendEmail({
        to: email,
        subject: `checkin reminder`,
        text: `you have 1 hour to checkin your booking ${booking.name} of ${booking.organization.name}`,
      }).catch((err) => {
        console.error(`failed to send checkin reminder email`, err);
      });
    }
    //schedule the next job
    if (booking.to) {
      const when = new Date(booking.to);
      when.setHours(when.getHours() + 1);
      const id = await scheduler.sendAfter(
        schedulerKeys.overdueReminder,
        data,
        {},
        when
      );
      await db.booking.update({
        where: { id: booking.id },
        data: { activeSchedulerReference: id },
      });
    }
  }
);

scheduler.work<SchedulerData>(
  schedulerKeys.overdueReminder,
  async ({ data }) => {
    const booking = await db.booking.findFirst({
      where: { id: data.id },
      include: {
        custodianTeamMember: true,
        custodianUser: true,
        organization: true,
      },
    });
    if (!booking) {
      console.warn(
        `booking with id ${data.id} not found in checkinReminder worker`
      );
      return;
    }
    const email = booking.custodianUser?.email;
    if (email) {
      await sendEmail({
        to: email,
        subject: `overdue reminder`,
        text: `you have passed the deadline for checkin out your booking ${booking.name} of ${booking.organization.name}`,
      }).catch((err) => {
        console.error(`failed to send overdue reminder email`, err);
      });
    }
  }
);
