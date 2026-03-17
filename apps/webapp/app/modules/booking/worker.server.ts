/* eslint-disable no-console */
import { BookingStatus } from "@prisma/client";
import type { Sb } from "@shelf/database";
import type PgBoss from "pg-boss";
import { sbDb } from "~/database/supabase.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { BookingForEmail } from "~/emails/types";
import { getTimeRemainingMessage } from "~/utils/date-fns";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { wrapBookingStatusForNote } from "~/utils/markdoc-wrappers";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { BOOKING_SCHEDULER_EVENTS_ENUM } from "./constants";
import {
  checkoutReminderEmailContent,
  overdueBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import {
  createStatusTransitionNote,
  scheduleNextBookingJob,
} from "./service.server";
import type { SchedulerData } from "./types";
import { createSystemBookingNote } from "../booking-note/service.server";

/** Shape returned by the Supabase booking-for-email query */
type BookingEmailRow = Sb.BookingRow & {
  custodianUser: Sb.UserRow | null;
  custodianTeamMember: Sb.TeamMemberRow | null;
  organization: Sb.OrganizationRow & { owner: Pick<Sb.UserRow, "email"> };
  _count: { assets: number };
};

const BOOKING_EMAIL_SELECT =
  "*, custodianTeamMember:TeamMember(*), custodianUser:User(*), organization:Organization(*, owner:User(email))";

/** Fetch a booking with the relations needed for email templates */
async function fetchBookingForEmail(
  bookingId: string
): Promise<BookingEmailRow | null> {
  const { data: bookingRow, error: bookingError } = await sbDb
    .from("Booking")
    .select(BOOKING_EMAIL_SELECT)
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) throw bookingError;
  if (!bookingRow) return null;

  const { count: assetsCount, error: countError } = await sbDb
    .from("_AssetToBooking")
    .select("*", { count: "exact", head: true })
    .eq("B", bookingId);

  if (countError) throw countError;

  return {
    ...(bookingRow as unknown as Sb.BookingRow & {
      custodianUser: Sb.UserRow | null;
      custodianTeamMember: Sb.TeamMemberRow | null;
      organization: Sb.OrganizationRow & { owner: Pick<Sb.UserRow, "email"> };
    }),
    _count: { assets: assetsCount ?? 0 },
  };
}

const checkoutReminder = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await fetchBookingForEmail(data.id).catch((cause) => {
    throw new ShelfError({
      cause,
      message: "Booking not found",
      additionalData: { data, work: data.eventType },
      label: "Booking",
    });
  });

  if (!booking) {
    throw new ShelfError({
      cause: null,
      message: "Booking not found",
      additionalData: { data, work: data.eventType },
      label: "Booking",
    });
  }

  const email = booking.custodianUser?.email;

  if (email && booking.from && booking.to) {
    const html = await bookingUpdatesTemplateString({
      booking: booking as unknown as BookingForEmail,
      heading: `Your booking is due for checkout in ${getTimeRemainingMessage(
        new Date(booking.from),
        new Date()
      )}.`,
      assetCount: booking._count.assets,
      hints: data.hints,
    });

    sendEmail({
      to: email,
      subject: `🔔 Checkout reminder (${booking.name}) - shelf.nu`,
      text: checkoutReminderEmailContent({
        bookingName: booking.name,
        assetsCount: booking._count.assets,
        custodian:
          `${booking.custodianUser?.firstName} ${booking.custodianUser?.lastName}` ||
          (booking.custodianTeamMember?.name as string),
        from: new Date(booking.from),
        to: new Date(booking.to),
        bookingId: booking.id,
        hints: data.hints,
        customEmailFooter: booking.organization.customEmailFooter,
      }),
      html,
    });
  }
};

const checkinReminder = async ({ data }: PgBoss.Job<SchedulerData>) => {
  const booking = await fetchBookingForEmail(data.id).catch((cause) => {
    throw new ShelfError({
      cause,
      message: "Booking not found",
      additionalData: { data, work: data.eventType },
      label: "Booking",
    });
  });

  if (!booking) {
    throw new ShelfError({
      cause: null,
      message: "Booking not found",
      additionalData: { data, work: data.eventType },
      label: "Booking",
    });
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
      booking as unknown as BookingForEmail,
      booking._count.assets,
      data.hints
    );
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
  // Update booking status to OVERDUE (only if currently ONGOING)
  const { error: updateError } = await sbDb
    .from("Booking")
    .update({ status: "OVERDUE" })
    .eq("id", data.id)
    .eq("status", "ONGOING");

  if (updateError) {
    throw new ShelfError({
      cause: updateError,
      message: "Booking update failed",
      additionalData: { data, work: data.eventType },
      label: "Booking",
    });
  }

  // Fetch the updated booking with relations for email
  const booking = await fetchBookingForEmail(data.id).catch((cause) => {
    throw new ShelfError({
      cause,
      message: "Booking not found after update",
      additionalData: { data, work: data.eventType },
      label: "Booking",
    });
  });

  if (!booking) return;

  /** Check this just in case  */
  if (booking.status !== BookingStatus.OVERDUE) {
    Logger.warn(
      `ignoring overdueReminder for booking with id ${data.id}, as its not in overdue status`
    );
    return;
  }

  // Create status transition note for automatic overdue transition
  const fromStatusBadge = wrapBookingStatusForNote(
    "ONGOING",
    booking.custodianUserId || undefined
  );
  const toStatusBadge = wrapBookingStatusForNote(
    "OVERDUE",
    booking.custodianUserId || undefined
  );

  await createSystemBookingNote({
    bookingId: booking.id,
    content: `Booking became overdue. Status changed from ${fromStatusBadge} to ${toStatusBadge}`,
  });

  /** Send the OVERDUE email */
  const email = booking.custodianUser?.email;

  if (email) {
    const html = await bookingUpdatesTemplateString({
      booking: booking as unknown as BookingForEmail,
      heading: `You have passed the deadline for checking in your booking "${booking.name}".`,
      assetCount: booking._count.assets,
      hints: data.hints,
    });

    sendEmail({
      to: email,
      subject: `⚠️ Overdue booking (${booking.name}) - shelf.nu`,
      text: overdueBookingEmailContent({
        bookingName: booking.name,
        assetsCount: booking._count.assets,
        custodian:
          `${booking.custodianUser?.firstName} ${booking.custodianUser?.lastName}` ||
          (booking.custodianTeamMember?.name as string),
        from: new Date(booking.from), // We can safely use this as we know the booking is overdue so it must have a from and to date
        to: new Date(booking.to),
        bookingId: booking.id,
        hints: data.hints,
        customEmailFooter: booking.organization.customEmailFooter,
      }),
      html,
    });
  }
};

const autoArchiveHandler = async ({ data }: PgBoss.Job<SchedulerData>) => {
  try {
    // Fetch the booking to check if it's still in COMPLETE status
    const { data: booking, error: fetchError } = await sbDb
      .from("Booking")
      .select("id, status, custodianUserId, organizationId")
      .eq("id", data.id)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!booking) {
      Logger.warn(
        `Auto-archive: Booking ${data.id} not found, skipping archive`
      );
      return;
    }

    // Only archive if the booking is still COMPLETE
    // (user might have manually archived it or reopened it)
    if (booking.status !== BookingStatus.COMPLETE) {
      Logger.info(
        `Auto-archive: Booking ${data.id} is no longer COMPLETE (status: ${booking.status}), skipping archive`
      );
      return;
    }

    // Check if auto-archive is still enabled for this organization
    const { data: bookingSettings, error: settingsError } = await sbDb
      .from("BookingSettings")
      .select("autoArchiveBookings")
      .eq("organizationId", booking.organizationId)
      .maybeSingle();

    if (settingsError) throw settingsError;

    if (!bookingSettings?.autoArchiveBookings) {
      Logger.info(
        `Auto-archive: Auto-archive is disabled for organization ${booking.organizationId}, skipping booking ${data.id}`
      );
      return;
    }

    // Archive the booking atomically — include status in where clause
    // to prevent race with concurrent manual archive (TOCTOU)
    const now = new Date();
    const { data: updatedBooking, error: archiveError } = await sbDb
      .from("Booking")
      .update({
        status: "ARCHIVED",
        autoArchivedAt: now.toISOString(),
      })
      .eq("id", booking.id)
      .eq("status", "COMPLETE")
      .select("id, status, custodianUserId")
      .maybeSingle();

    if (archiveError) {
      Logger.warn(
        `Auto-archive: Failed to archive booking ${data.id}: ${archiveError.message}`
      );
    }

    if (!updatedBooking) {
      Logger.info(
        `Auto-archive: Booking ${data.id} was modified concurrently, skipping archive`
      );
      return;
    }

    // Create system note for the status transition
    await createStatusTransitionNote({
      bookingId: booking.id,
      fromStatus: BookingStatus.COMPLETE,
      toStatus: BookingStatus.ARCHIVED,
      custodianUserId: booking.custodianUserId || undefined,
    });

    Logger.info(`Auto-archived booking ${booking.id}`);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to auto-archive booking",
        additionalData: { bookingId: data.id },
        label: "Booking",
      })
    );
  }
};

const event2HandlerMap: Record<
  BOOKING_SCHEDULER_EVENTS_ENUM,
  (job: PgBoss.Job<SchedulerData>) => Promise<void>
> = {
  [BOOKING_SCHEDULER_EVENTS_ENUM.checkoutReminder]: checkoutReminder,
  [BOOKING_SCHEDULER_EVENTS_ENUM.checkinReminder]: checkinReminder,
  [BOOKING_SCHEDULER_EVENTS_ENUM.overdueHandler]: overdueHandler,
  [BOOKING_SCHEDULER_EVENTS_ENUM.autoArchiveHandler]: autoArchiveHandler,
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
