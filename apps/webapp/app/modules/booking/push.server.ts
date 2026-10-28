/**
 * Booking pushes
 *
 * Sends the companion-app push that goes out beside a booking email. A
 * booking push reaches the custodian only: the creator, the workspace
 * broadcast audience, the always-notify list and the per-booking recipients
 * get the email and no push. A custodian change also tells the custodian it
 * replaced.
 *
 * Nobody is pushed about their own action. The email list keeps a custodian
 * who acted (see step 7 of `getBookingNotificationRecipients`); the push
 * drops them here.
 *
 * Each function returns at once: the push is queued in the background and a
 * queue failure is logged, never thrown, so it cannot fail the booking action.
 *
 * @see {@link file://../push/messages.ts} what each booking push says
 * @see {@link file://./notification-recipients.server.ts} who gets the email
 */
import type { BookingForEmail } from "~/emails/types";
import type { PushMessageDraft } from "~/modules/push/messages";
import { PUSH_MESSAGES } from "~/modules/push/messages";
import { sendPush } from "~/modules/push/service.server";
import type { ClientHint } from "~/utils/client-hints";
import { formatDate, resolveFormatPrefs } from "~/utils/date-format";
import type {
  BookingEventType,
  NotificationRecipient,
} from "./notification-recipients.server";

/** The booking fields a push reads. */
type BookingForPush = Pick<
  BookingForEmail,
  "id" | "name" | "organizationId" | "from" | "to"
>;

/** Queues `message` for `userId` unless they are the person who acted. */
function pushUnlessActor(
  userId: string,
  actorUserId: string | undefined,
  message: PushMessageDraft
): void {
  if (userId === actorUserId) return;
  void sendPush({ userIds: [userId], ...message });
}

/**
 * Pushes a booking event to the booking's custodian when they are among the
 * email recipients and did not act themself, and does nothing otherwise (a
 * custodian without an account cannot have the app). The booking's dates are
 * formatted in the custodian's preferences from their recipient row, with
 * `hints` filling any preference they have not set, exactly as their email
 * does.
 *
 * @param args.eventType - The booking event; picks the push wording
 * @param args.booking - The booking the email is about
 * @param args.recipients - The email recipients for this event
 * @param args.hints - The acting user's hints, the fallback for unset prefs
 * @param args.actorUserId - The user who acted, never pushed about it;
 *   `undefined` for a scheduled job, which has no actor
 */
export function sendBookingPushToCustodian({
  eventType,
  booking,
  recipients,
  hints,
  actorUserId,
}: {
  eventType: BookingEventType;
  booking: BookingForPush;
  recipients: NotificationRecipient[];
  hints: ClientHint;
  actorUserId: string | undefined;
}): void {
  const custodian = recipients.find(({ reason }) => reason === "custodian");
  if (!custodian) return;

  const prefs = resolveFormatPrefs(custodian, hints);
  pushUnlessActor(
    custodian.userId,
    actorUserId,
    PUSH_MESSAGES[`BOOKING_${eventType}`]({
      bookingId: booking.id,
      organizationId: booking.organizationId,
      bookingName: booking.name,
      from: formatDate(booking.from, prefs, { includeTime: true }),
      to: formatDate(booking.to, prefs, { includeTime: true }),
    })
  );
}

/**
 * Tells the custodian a booking update or reservation replaced that they
 * were removed, unless they made the change themself. The push opens the bookings list:
 * once removed, their role may no longer open the booking.
 *
 * @param args.booking - The booking as updated or reserved
 * @param args.replacedCustodianUserId - The custodian the change replaced
 * @param args.actorUserId - The user who made the change; `undefined` when
 *   no user is known, so nobody is skipped
 */
export function sendBookingPushToReplacedCustodian({
  booking,
  replacedCustodianUserId,
  actorUserId,
}: {
  booking: Pick<BookingForEmail, "id" | "name" | "organizationId">;
  replacedCustodianUserId: string;
  actorUserId: string | undefined;
}): void {
  pushUnlessActor(
    replacedCustodianUserId,
    actorUserId,
    PUSH_MESSAGES.BOOKING_CUSTODIAN_REMOVED({
      bookingId: booking.id,
      organizationId: booking.organizationId,
      bookingName: booking.name,
    })
  );
}
