import type { Booking, TeamMember, User } from "@prisma/client";
import { SERVER_URL } from "~/utils";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { getTimeRemainingMessage } from "~/utils/date-fns";
import { sendEmail } from "~/utils/mail.server";
import type { ClientHint } from "./types";

/**
 * THis is the base content of the bookings related emails.
 * We always provide some general info so this function standardizes that.
 */
export const baseBookingEmailContent = ({
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
${SERVER_URL}/booking/${bookingId}

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
  baseBookingEmailContent({
    hints,
    bookingName,
    custodian,
    from,
    to,
    bookingId,
    assetsCount,
    emailContent: `Booking confirmation for ${custodian}.`,
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
  baseBookingEmailContent({
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
    )} minutes.`,
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
  baseBookingEmailContent({
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
    )} minutes.`,
  });

export const sendCheckinReminder = async (
  booking: Booking & {
    custodianTeamMember: TeamMember | null;
    custodianUser: User | null;
  },
  assetCount: number,
  hints: ClientHint
) => {
  await sendEmail({
    to: booking.custodianUser!.email,
    subject: `Checkin reminder - shelf.nu`,
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
  });
};
