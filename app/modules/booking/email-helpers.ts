import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import type { BookingForEmail } from "~/emails/types";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
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

const LABEL_STORE_URL = "http://store.shelf.nu";

const getFormattedDates = ({
  from,
  to,
  hints,
}: Pick<BasicEmailContentArgs, "from" | "to" | "hints">) => {
  const formatter = getDateTimeFormatFromHints(hints, {
    dateStyle: "short",
    timeStyle: "short",
  });

  return {
    fromDate: formatter.format(from),
    toDate: formatter.format(to),
  };
};

/**
 * This is the content of the email sent to the custodian when a booking is reserved.
 */
export const assetReservedEmailContent = (args: BasicEmailContentArgs) => {
  const { fromDate, toDate } = getFormattedDates(args);

  return `Howdy ${args.custodian},

Your booking is confirmed.

📦 **${args.bookingName}**
Assets: ${args.assetsCount}
Pickup: ${fromDate}
Return: ${toDate}

→ View booking: ${SERVER_URL}/bookings/${args.bookingId}

**Pro tip:** Print QR labels for faster checkout → ${LABEL_STORE_URL}

Thanks,
The Shelf Team
`;
};

export const bookingApprovalRequestEmailContent = (
  args: BasicEmailContentArgs
) => {
  const { fromDate, toDate } = getFormattedDates(args);

  return `Howdy,

${args.custodian} requested a booking that needs your approval.

📦 **${args.bookingName}**
Assets: ${args.assetsCount}
From: ${fromDate}
To: ${toDate}

→ Approve or decline: ${SERVER_URL}/bookings/${args.bookingId}

Thanks,
The Shelf Team
`;
};

/**
 * This is the content of the email sent to the custodian when a booking is checked out.
 */
export const checkoutReminderEmailContent = (args: BasicEmailContentArgs) => {
  const { fromDate, toDate } = getFormattedDates(args);

  return `Howdy ${args.custodian},

Your booking starts in 1 hour.

📦 **${args.bookingName}**
Assets: ${args.assetsCount}
From: ${fromDate}
To: ${toDate}

→ Checkout now: ${SERVER_URL}/bookings/${args.bookingId}

**Using QR codes?** Durable labels make it faster → ${LABEL_STORE_URL}

Thanks,
The Shelf Team
`;
};

/**
 * This is the content of the email sent to the custodian when a booking is checked in.
 */

export const checkinReminderEmailContent = (args: BasicEmailContentArgs) => {
  const { fromDate, toDate } = getFormattedDates(args);

  return `Howdy ${args.custodian},

Your booking is due for return in 1 hour.

📦 **${args.bookingName}**
Assets: ${args.assetsCount}
From: ${fromDate}
To: ${toDate}

→ Check in now: ${SERVER_URL}/bookings/${args.bookingId}

Need more time? Extend the booking to keep assets longer.

Thanks,
The Shelf Team
`;
};

export function sendCheckinReminder(
  booking: BookingForEmail,
  assetCount: number,
  hints: ClientHint
) {
  sendEmail({
    to: booking.custodianUser!.email,
    subject: `🔔 Return soon: ${booking.name} (due in 1 hour)`,
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
      heading: "Your booking is due for return in 1 hour.",
      assetCount,
      hints,
      bodyLines: ["Need more time? Extend the booking to keep assets longer."],
      buttonLabel: "Check in now",
    }),
  });
}

/**
 * Booking is overdue
 *
 * This email gets sent when a booking is overdue
 */
export const overdueBookingEmailContent = (args: BasicEmailContentArgs) => {
  const { toDate } = getFormattedDates(args);

  return `Howdy ${args.custodian},

Your booking "${args.bookingName}" was due on ${toDate}.

**This is now overdue.**

📦 **${args.bookingName}**
Assets: ${args.assetsCount}
Was due: ${toDate}

→ Check in now: ${SERVER_URL}/bookings/${args.bookingId}

If you still need these assets, extend the booking to avoid blocking other reservations.

Thanks,
The Shelf Team
`;
};

/**
 * Booking is completed
 *
 * This email gets sent when a booking is checked-in
 */
export const completedBookingEmailContent = (args: BasicEmailContentArgs) => {
  const { fromDate, toDate } = getFormattedDates(args);

  return `Howdy ${args.custodian},

All done! Your booking "${args.bookingName}" is complete.

📦 **${args.bookingName}**
Assets: ${args.assetsCount}
Period: ${fromDate} - ${toDate}

→ View history: ${SERVER_URL}/bookings/${args.bookingId}

**Need more labels?** Stock up → ${LABEL_STORE_URL}

Thanks,
The Shelf Team
`;
};

/**
 * Booking is deleted
 *
 * This email gets sent when a booking is checked-in
 */
export const deletedBookingEmailContent = (args: BasicEmailContentArgs) => {
  const { fromDate, toDate } = getFormattedDates(args);

  return `Howdy,

Your booking has been deleted: "${args.bookingName}"

📦 **Details:**
Assets: ${args.assetsCount}
Custodian: ${args.custodian}
Period: ${fromDate} - ${toDate}

This action is permanent. The booking no longer exists.

Thanks,
The Shelf Team
`;
};

/**
 * Booking is cancelled
 *
 * This email gets sent when a booking is checked-in
 */
export const cancelledBookingEmailContent = (args: BasicEmailContentArgs) => {
  const { fromDate, toDate } = getFormattedDates(args);

  return `Howdy ${args.custodian},

Your booking has been cancelled: "${args.bookingName}"

📦 **Details:**
Assets: ${args.assetsCount}
Period: ${fromDate} - ${toDate}

If this was a mistake, contact your workspace admin.

Thanks,
The Shelf Team
`;
};

/**
 * Booking is extended
 *
 * This email is sent when a booking's end date is extended.
 */
export function extendBookingEmailContent({
  oldToDate,
  ...args
}: BasicEmailContentArgs & { oldToDate: Date }) {
  const formatter = getDateTimeFormatFromHints(args.hints, {
    dateStyle: "short",
    timeStyle: "short",
  });
  const { fromDate, toDate } = getFormattedDates(args);

  return `Howdy ${args.custodian},

Your booking has been extended.

**New return date:** ${formatter.format(args.to)}
**Previous return date:** ${formatter.format(oldToDate)}

📦 **${args.bookingName}**
Assets: ${args.assetsCount}
From: ${fromDate}
To: ${toDate}

→ View booking: ${SERVER_URL}/bookings/${args.bookingId}

Thanks,
The Shelf Team
`;
}
