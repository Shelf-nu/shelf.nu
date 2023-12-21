import { SERVER_URL } from "~/utils";
import { getTimeRemainingMessage } from "~/utils/date-fns";

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
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: string;
  to: string;
  bookingId: string;
  emailContent: string;
}) => `Howdy,

${emailContent}

${bookingName} | ${assetsCount} assets

Custodian: ${custodian}
From: ${from}
To: ${to}

To view the booking, follow the link below:
${SERVER_URL}/booking/${bookingId}

Thanks,
The Shelf Team
`;

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
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: string;
  to: string;
  bookingId: string;
}) =>
  baseBookingEmailContent({
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
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: string;
  to: string;
  bookingId: string;
}) =>
  baseBookingEmailContent({
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
}: {
  bookingName: string;
  assetsCount: number;
  custodian: string;
  from: string;
  to: string;
  bookingId: string;
}) =>
  baseBookingEmailContent({
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
