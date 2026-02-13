import { db } from "~/database/db.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { BookingForEmail } from "~/emails/types";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { getTimeRemainingMessage } from "~/utils/date-fns";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { BOOKING_INCLUDE_FOR_EMAIL } from "./constants";

type BasicEmailContentArgs = {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
  customEmailFooter?: string | null;
};

/**
 * THis is the base content of the bookings related emails.
 * We always provide some general info so this function standardizes that.
 */
export const baseBookingTextEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
  emailContent,
  hints,
  customEmailFooter,
}: BasicEmailContentArgs & { emailContent: string }) => {
  const fromDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(from);
  const toDate = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(to);
  return `Howdy,

${emailContent}

${bookingName} | ${assetsCount} assets

Custodian: ${custodian}
From: ${fromDate}
To: ${toDate}

To view the booking, follow the link below:
${SERVER_URL}/bookings/${bookingId}
${customEmailFooter ? `\n---\n${customEmailFooter}` : ""}
Thanks,
The Shelf Team
`;
};

/**
 * This is the content of the email sent to the custodian when a booking is reserved.
 */
export const assetReservedEmailContent = (args: BasicEmailContentArgs) =>
  baseBookingTextEmailContent({
    ...args,
    emailContent: `Booking reservation for ${args.custodian}.`,
  });

/**
 * This is the content of the email sent to the custodian when a booking is checked out.
 */
export const checkoutReminderEmailContent = (args: BasicEmailContentArgs) =>
  baseBookingTextEmailContent({
    ...args,
    emailContent: `Your booking is due for checkout in ${getTimeRemainingMessage(
      new Date(args.from),
      new Date()
    )}.`,
  });

/**
 * This is the content of the email sent to the custodian when a booking is checked in.
 */

export const checkinReminderEmailContent = (args: BasicEmailContentArgs) =>
  baseBookingTextEmailContent({
    ...args,
    emailContent: `Your booking is due for checkin in ${getTimeRemainingMessage(
      new Date(args.to),
      new Date()
    )}.`,
  });

export async function sendCheckinReminder(
  booking: BookingForEmail,
  assetCount: number,
  hints: ClientHint
) {
  const html = await bookingUpdatesTemplateString({
    booking,
    heading: `Your booking is due for checkin in ${getTimeRemainingMessage(
      new Date(booking.to!),
      new Date()
    )}.`,
    assetCount,
    hints,
  });

  sendEmail({
    to: booking.custodianUser!.email,
    subject: `🔔 Checkin reminder (${booking.name}) - shelf.nu`,
    text: checkinReminderEmailContent({
      hints,
      bookingName: booking.name,
      assetsCount: assetCount,
      custodian:
        `${booking.custodianUser!.firstName} ${booking.custodianUser
          ?.lastName}` || (booking.custodianTeamMember?.name as string),
      from: booking.from!,
      to: booking.to!,
      bookingId: booking.id,
      customEmailFooter: booking.organization.customEmailFooter,
    }),
    html,
  });
}

/**
 * Booking is overdue
 *
 * This email gets sent when a booking is overdue
 */
export const overdueBookingEmailContent = (args: BasicEmailContentArgs) =>
  baseBookingTextEmailContent({
    ...args,
    emailContent: `You have passed the deadline for checking in your booking "${args.bookingName}".`,
  });

/**
 * Booking is completed
 *
 * This email gets sent when a booking is checked-in
 */
export const completedBookingEmailContent = (args: BasicEmailContentArgs) =>
  baseBookingTextEmailContent({
    ...args,
    emailContent: `Your booking has been completed: "${args.bookingName}".`,
  });

/**
 * Booking is deleted
 *
 * This email gets sent when a booking is checked-in
 */
export const deletedBookingEmailContent = (args: BasicEmailContentArgs) =>
  baseBookingTextEmailContent({
    ...args,
    emailContent: `Your booking has been deleted: "${args.bookingName}".`,
  });

/**
 * Booking is cancelled
 *
 * This email gets sent when a booking is cancelled
 */
export const cancelledBookingEmailContent = (
  args: BasicEmailContentArgs & { cancellationReason?: string }
) =>
  baseBookingTextEmailContent({
    ...args,
    emailContent: `Your booking has been cancelled: "${args.bookingName}".${
      args.cancellationReason ? `\n\nReason: ${args.cancellationReason}` : ""
    }`,
  });

/**
 * Booking is extended
 *
 * This email is sent when a booking's end date is extended.
 */
export function extendBookingEmailContent({
  oldToDate,
  ...args
}: BasicEmailContentArgs & { oldToDate: Date }) {
  const { format } = getDateTimeFormatFromHints(args.hints, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return baseBookingTextEmailContent({
    ...args,
    emailContent: `You booking has been extended from ${format(
      oldToDate
    )} to ${format(args.to)}`,
  });
}

/**
 * Booking is updated
 *
 * This email is sent when a booking's fields or assets are modified.
 */
export const bookingUpdatedEmailContent = (
  args: BasicEmailContentArgs & { changes: string[] }
) =>
  baseBookingTextEmailContent({
    ...args,
    emailContent: `Your booking "${
      args.bookingName
    }" has been updated.\n\nChanges:\n${args.changes
      .map((c) => `- ${c}`)
      .join("\n")}`,
  });

/**
 * Sends a "Booking Updated" email to the custodian(s).
 *
 * Skips sending if the custodian is the editor,
 * or if there are no changes, or if custodian has no email.
 * On custodian change, notifies both old and new custodians.
 */
export async function sendBookingUpdatedEmail({
  bookingId,
  organizationId,
  userId,
  changes,
  hints,
  oldCustodianEmail,
}: {
  bookingId: string;
  organizationId: string;
  /** The user who made the edit */
  userId: string;
  /** Plain-text change descriptions */
  changes: string[];
  hints: ClientHint;
  /** Email of old custodian (for custodian change scenarios) */
  oldCustodianEmail?: string;
}) {
  try {
    if (changes.length === 0) return;

    const booking = await db.booking.findUnique({
      where: { id: bookingId, organizationId },
      include: BOOKING_INCLUDE_FOR_EMAIL,
    });

    if (!booking) return;

    const custodian = booking.custodianUser
      ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`
      : booking.custodianTeamMember?.name ?? "";

    const subject = `📝 Booking updated (${booking.name}) - shelf.nu`;

    const emailArgs: BasicEmailContentArgs = {
      bookingName: booking.name,
      assetsCount: booking._count.assets,
      custodian,
      from: booking.from!,
      to: booking.to!,
      bookingId: booking.id,
      hints,
      customEmailFooter: booking.organization.customEmailFooter,
    };

    const text = bookingUpdatedEmailContent({ ...emailArgs, changes });

    const html = await bookingUpdatesTemplateString({
      booking,
      heading: `Your booking "${booking.name}" has been updated`,
      assetCount: booking._count.assets,
      hints,
      changes,
    });

    // Send to current custodian if they have an email
    // and they're not the one who made the edit
    if (booking.custodianUser?.email && booking.custodianUser.id !== userId) {
      sendEmail({
        to: booking.custodianUser.email,
        subject,
        text,
        html,
      });
    }

    // Send to old custodian if provided and they're not the editor
    // (the old custodian's userId was already disconnected,
    // so we use the email directly)
    if (oldCustodianEmail) {
      // Look up the old custodian's user to check if they are the editor
      const oldCustodianUser = await db.user.findUnique({
        where: { email: oldCustodianEmail },
        select: { id: true },
      });

      if (!oldCustodianUser || oldCustodianUser.id !== userId) {
        sendEmail({
          to: oldCustodianEmail,
          subject,
          text,
          html,
        });
      }
    }
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to send booking updated email",
        additionalData: { bookingId },
        label: "Booking",
      })
    );
  }
}
