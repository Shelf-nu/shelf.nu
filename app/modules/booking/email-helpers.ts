import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { BookingForEmail } from "~/emails/types";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { getTimeRemainingMessage } from "~/utils/date-fns";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import type { ClientHint } from "./types";

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
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  emailContent: string;
  hints: ClientHint;
}) => {
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
export const assetReservedEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
  hints,
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
}) =>
  baseBookingTextEmailContent({
    hints,
    bookingName,
    custodian,
    from,
    to,
    bookingId,
    assetsCount,
    emailContent: `Booking reservation for ${custodian}.`,
  });

/**
 * This is the content of the email sent to the custodian when a booking is checked out.
 */
export const checkoutReminderEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
  hints,
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
}) =>
  baseBookingTextEmailContent({
    hints,
    bookingName,
    custodian,
    from,
    to,
    bookingId,
    assetsCount,
    emailContent: `Your booking is due for checkout in ${getTimeRemainingMessage(
      new Date(from),
      new Date()
    )}.`,
  });

/**
 * This is the content of the email sent to the custodian when a booking is checked in.
 */

export const checkinReminderEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
  hints,
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
}) =>
  baseBookingTextEmailContent({
    hints,
    bookingName,
    custodian,
    from,
    to,
    bookingId,
    assetsCount,
    emailContent: `Your booking is due for checkin in ${getTimeRemainingMessage(
      new Date(to),
      new Date()
    )}.`,
  });

export function sendCheckinReminder(
  booking: BookingForEmail,
  assetCount: number,
  hints: ClientHint
) {
  sendEmail({
    to: booking.custodianUser!.email,
    subject: `Checkin reminder (${booking.name}) - shelf.nu`,
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
    html: bookingUpdatesTemplateString({
      booking,
      heading: `Your booking is due for checkin in ${getTimeRemainingMessage(
        new Date(booking.to!),
        new Date()
      )}.`,
      assetCount,
      hints,
    }),
  });
}

/**
 * Booking is overdue
 *
 * This email gets sent when a booking is overdue
 */
export const overdueBookingEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
  hints,
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
}) =>
  baseBookingTextEmailContent({
    hints,
    bookingName,
    custodian,
    from,
    to,
    bookingId,
    assetsCount,
    emailContent: `You have passed the deadline for checking in your booking "${bookingName}".`,
  });

/**
 * Booking is completed
 *
 * This email gets sent when a booking is checked-in
 */
export const completedBookingEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
  hints,
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
}) =>
  baseBookingTextEmailContent({
    hints,
    bookingName,
    custodian,
    from,
    to,
    bookingId,
    assetsCount,
    emailContent: `Your booking has been completed: "${bookingName}".`,
  });

/**
 * Booking is deleted
 *
 * This email gets sent when a booking is checked-in
 */
export const deletedBookingEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
  hints,
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
}) =>
  baseBookingTextEmailContent({
    hints,
    bookingName,
    custodian,
    from,
    to,
    bookingId,
    assetsCount,
    emailContent: `Your booking has been deleted: "${bookingName}".`,
  });

/**
 * Booking is cancelled
 *
 * This email gets sent when a booking is checked-in
 */
export const cancelledBookingEmailContent = ({
  bookingName,
  custodian,
  from,
  to,
  bookingId,
  assetsCount,
  hints,
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: Date;
  to: Date;
  bookingId: string;
  hints: ClientHint;
}) =>
  baseBookingTextEmailContent({
    hints,
    bookingName,
    custodian,
    from,
    to,
    bookingId,
    assetsCount,
    emailContent: `Your booking has been cancelled: "${bookingName}".`,
  });
