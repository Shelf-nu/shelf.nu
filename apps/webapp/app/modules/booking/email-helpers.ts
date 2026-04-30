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
import { resolveUserDisplayName } from "~/utils/user";
import { BOOKING_INCLUDE_FOR_EMAIL } from "./constants";
import { getBookingNotificationRecipients } from "./notification-recipients.server";

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
 * This is the content of the email sent to the custodian when a booking
 * is reserved.
 *
 * Phase 3d (Book-by-Model): when the booking has outstanding
 * `BookingModelRequest` rows, the plain-text email appends a
 * "Requested models" block that mirrors the HTML template. The list is
 * omitted when empty so the plain-text output stays identical for
 * bookings that don't use model-level reservations.
 *
 * @param args.modelRequests - Optional list of `{ quantity, modelName }`
 *   rows. Must be pre-filtered so only entries with `quantity > 0`
 *   reach this helper.
 */
export const assetReservedEmailContent = ({
  modelRequests,
  ...args
}: BasicEmailContentArgs & {
  modelRequests?: { quantity: number; modelName: string }[];
}) => {
  const modelRequestsBlock =
    modelRequests && modelRequests.length > 0
      ? `\n\nRequested models:\n${modelRequests
          .map((req) => `- ${req.quantity} × ${req.modelName}`)
          .join("\n")}`
      : "";

  return baseBookingTextEmailContent({
    ...args,
    emailContent: `Booking reservation for ${args.custodian}.${modelRequestsBlock}`,
  });
};

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

/**
 * Sends a check-in reminder email to all resolved notification recipients.
 *
 * Unlike the original implementation (which sent only to the custodian),
 * this function now resolves the full recipient list via
 * `getBookingNotificationRecipients()` and sends a personalized email
 * to each recipient with their specific reason footer.
 *
 * Called from the `checkinReminder` scheduled job handler in
 * `worker.server.ts`, which handles the booking status guard.
 *
 * @param booking - The booking with all email-required relations included
 * @param assetCount - Number of assets in the booking (for display)
 * @param hints - Client hints for date/time formatting
 * @param organizationId - Used to resolve org-level notification settings
 */
export async function sendCheckinReminder(
  booking: BookingForEmail,
  assetCount: number,
  hints: ClientHint,
  organizationId: string
) {
  const recipients = await getBookingNotificationRecipients({
    booking,
    eventType: "CHECKIN_REMINDER",
    organizationId,
    isScheduledJob: true, // Don't exclude editor for scheduled reminders
  });

  if (recipients.length === 0) return;

  const custodian =
    resolveUserDisplayName(booking.custodianUser) ||
    (booking.custodianTeamMember?.name as string);

  const subject = `🔔 Checkin reminder (${booking.name}) - shelf.nu`;

  const text = checkinReminderEmailContent({
    hints,
    bookingName: booking.name,
    assetsCount: assetCount,
    custodian,
    from: booking.from!,
    to: booking.to!,
    bookingId: booking.id,
    customEmailFooter: booking.organization.customEmailFooter,
  });

  for (const recipient of recipients) {
    const html = await bookingUpdatesTemplateString({
      booking,
      heading: `Your booking is due for checkin in ${getTimeRemainingMessage(
        new Date(booking.to!),
        new Date()
      )}.`,
      assetCount,
      hints,
      recipientReason: recipient.reason,
      recipientEmail: recipient.email,
    });

    sendEmail({
      to: recipient.email,
      subject,
      text,
      html,
    });
  }
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
 * Sends a "Booking Updated" email to all resolved notification recipients.
 *
 * Resolves recipients via `getBookingNotificationRecipients()` with the
 * `UPDATE` event type, which excludes the editing user from the list.
 * Each recipient gets a personalized email with their reason footer.
 *
 * **Special case — custodian change:** When `oldCustodianEmail` is provided,
 * the old custodian may no longer appear in the resolved recipient list
 * (since they're no longer the booking's custodian). This function
 * explicitly checks and sends them a notification if they weren't already
 * included and aren't the editor.
 *
 * Skips sending entirely if `changes` is empty (no meaningful update).
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
  userId: string;
  changes: string[];
  hints: ClientHint;
  oldCustodianEmail?: string;
}) {
  try {
    if (changes.length === 0) return;

    const booking = await db.booking.findUnique({
      where: { id: bookingId, organizationId },
      include: BOOKING_INCLUDE_FOR_EMAIL,
    });

    if (!booking) return;

    // Don't send update emails for draft bookings — the booking hasn't
    // been reserved yet, so emailing about changes is noise.
    // Exception: custodian changes still send emails even in draft,
    // because the new custodian needs to know they've been assigned
    // and the old custodian needs to know they've been removed.
    if (booking.status === "DRAFT" && !oldCustodianEmail) return;

    const custodian =
      (resolveUserDisplayName(booking.custodianUser) ||
        booking.custodianTeamMember?.name) ??
      "";

    const subject = `📝 Booking updated (${booking.name}) - shelf.nu`;

    const emailArgs: BasicEmailContentArgs = {
      bookingName: booking.name,
      assetsCount: booking._count.bookingAssets,
      custodian,
      from: booking.from!,
      to: booking.to!,
      bookingId: booking.id,
      hints,
      customEmailFooter: booking.organization.customEmailFooter,
    };

    const text = bookingUpdatedEmailContent({ ...emailArgs, changes });

    // Resolve all recipients with editor exclusion.
    // The old custodian (if changed) is handled separately below.
    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "UPDATE",
      organizationId,
      editorUserId: userId,
    });

    // Send to all resolved recipients
    for (const recipient of recipients) {
      const html = await bookingUpdatesTemplateString({
        booking,
        heading: `Your booking "${booking.name}" has been updated`,
        assetCount: booking._count.bookingAssets,
        hints,
        changes,
        recipientReason: recipient.reason,
        recipientEmail: recipient.email,
      });

      sendEmail({
        to: recipient.email,
        subject,
        text,
        html,
      });
    }

    // Special case: if custodian changed, notify the OLD custodian too
    // (they might not be in the recipient list anymore since they're no longer the custodian)
    if (oldCustodianEmail) {
      const alreadySent = recipients.some((r) => r.email === oldCustodianEmail);
      if (!alreadySent) {
        // Check the old custodian is not the editor
        const oldCustodianUser = await db.user.findUnique({
          where: { email: oldCustodianEmail },
          select: { id: true },
        });

        if (!oldCustodianUser || oldCustodianUser.id !== userId) {
          const html = await bookingUpdatesTemplateString({
            booking,
            heading: `Your booking "${booking.name}" has been updated`,
            assetCount: booking._count.bookingAssets,
            hints,
            changes,
            recipientReason: "custodian",
            recipientEmail: oldCustodianEmail,
          });

          sendEmail({
            to: oldCustodianEmail,
            subject,
            text,
            html,
          });
        }
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
