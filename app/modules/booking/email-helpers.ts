import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { BookingForEmail } from "~/emails/types";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { getTimeRemainingMessage } from "~/utils/date-fns";
import { SERVER_URL } from "~/utils/env";

type BasicEmailContentArgs = {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
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
 * This email gets sent when a booking is checked-in
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
