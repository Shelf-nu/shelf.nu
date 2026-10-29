/**
 * Notification copy
 *
 * The one place push wording lives, and the one place a booking or audit
 * notification's title lives. A call site looks up its event in
 * {@link PUSH_MESSAGES} and hands the result to `sendPush` with the people to
 * notify; it never writes push text itself. The matching email takes its
 * subject from {@link bookingEmailSubject} or {@link auditEmailSubject}, built
 * from the same title, so the push and the email cannot drift apart.
 *
 * A title names the booking or audit, so a body leads with what is new (the
 * dates, the time left) and never repeats the name: a long name truncates the
 * title, not the news. A body carries a time only when the push goes to one
 * person: times arrive formatted in that person's date and time preferences,
 * and one push carries one string for everyone it reaches.
 *
 * A tap opens the booking's, audit's or asset's detail page when the row has
 * one, and the list otherwise (a deleted booking has no page, and a removed
 * custodian may no longer open it). Every url carries `orgId`, even where the
 * email's link leaves it out, so the app switches to the event's workspace
 * before it opens the page.
 *
 * Imports nothing that reaches a database or a queue, so the copy is tested
 * on its own.
 *
 * @see {@link file://./service.server.ts} sendPush, which delivers these
 * @see {@link file://./types.ts} PushMessage and PushCategory
 */
import { AUDIT_REMINDER_TIMEFRAMES } from "~/modules/audit/constants";
import type { AuditReminder } from "~/modules/audit/constants";
import type { BookingEventType } from "~/modules/booking/notification-recipients.server";
import type { PushMessage } from "./types";

/** Identifies a booking in its push. */
type BookingPushContext = {
  bookingId: string;
  organizationId: string;
  bookingName: string;
};

/** A booking push to its custodian alone, with the booking's dates. */
type BookingPeriodPushContext = BookingPushContext & {
  /** The start, formatted in the custodian's date and time preferences. */
  from: string;
  /** The end, formatted the same way. */
  to: string;
};

/** Identifies an audit in its push. */
type AuditPushContext = {
  auditId: string;
  organizationId: string;
  auditName: string;
};

/** An assignment push, which goes to the one assignee. */
type AuditAssignedPushContext = AuditPushContext & {
  /** The due date in the assignee's preferences; absent when there is none. */
  dueDate?: string;
};

/** Identifies an asset reminder and its asset in the reminder's push. */
type AssetReminderPushContext = {
  assetId: string;
  organizationId: string;
  reminderName: string;
  assetTitle: string;
};

/**
 * The audit events that notify: the assignment, each reminder before the due
 * date, and the overdue notice.
 */
type AuditNotice = "ASSIGNED" | AuditReminder | "OVERDUE";

/**
 * What each event's push is built from. Every booking event pushes to the
 * custodian alone, so each carries the dates; an update that changes the
 * custodian tells the new one they hold it and the replaced one they do not.
 * Audit reminders and overdue notices reach several people, so none of them
 * carries a time.
 */
type PushContexts = Record<
  `BOOKING_${BookingEventType}`,
  BookingPeriodPushContext
> &
  Record<
    "BOOKING_CUSTODIAN_ASSIGNED" | "BOOKING_CUSTODIAN_REMOVED",
    BookingPushContext
  > &
  Record<`AUDIT_${Exclude<AuditNotice, "ASSIGNED">}`, AuditPushContext> &
  Record<"AUDIT_ASSIGNED", AuditAssignedPushContext> &
  Record<"ASSET_REMINDER", AssetReminderPushContext>;

/**
 * Every event that sends a push. Booking and audit events carry their domain
 * as a prefix because both domains have an `OVERDUE`.
 */
export type PushEvent = keyof PushContexts;

/** A push without its recipients: everything `sendPush` needs but `userIds`. */
export type PushMessageDraft = Omit<PushMessage, "userIds">;

/** The site name every booking and audit email subject ends with. */
const EMAIL_SUBJECT_SUFFIX = " - shelf.nu";

/** Each booking event's title, naming the booking. */
const BOOKING_TITLES: Record<
  BookingEventType,
  (bookingName: string) => string
> = {
  RESERVATION: (name) => `✅ Booking reserved (${name})`,
  CHECKOUT_REMINDER: (name) => `🔔 Checkout reminder (${name})`,
  CHECKIN_REMINDER: (name) => `🔔 Checkin reminder (${name})`,
  CHECKIN: (name) => `🎉 Booking complete (${name})`,
  OVERDUE: (name) => `⚠️ Overdue booking (${name})`,
  CANCEL: (name) => `❌ Booking cancelled (${name})`,
  REVERT_TO_DRAFT: (name) => `↩️ Booking reverted to draft (${name})`,
  EXTEND: (name) => `Booking extended (${name})`,
  SHORTEN: (name) => `Booking shortened (${name})`,
  DELETE: (name) => `🗑️ Booking deleted (${name})`,
  UPDATE: (name) => `📝 Booking updated (${name})`,
};

/** An audit reminder's title, with the time left as the email words it. */
function auditDueTitle(reminder: AuditReminder) {
  return (name: string) =>
    `🔔 Audit due in ${AUDIT_REMINDER_TIMEFRAMES[reminder]}: "${name}"`;
}

/** Each audit notice's title, naming the audit. */
const AUDIT_TITLES: Record<AuditNotice, (auditName: string) => string> = {
  ASSIGNED: (name) => `🔍 You've been assigned to audit: "${name}"`,
  REMINDER_24H: auditDueTitle("REMINDER_24H"),
  REMINDER_4H: auditDueTitle("REMINDER_4H"),
  REMINDER_1H: auditDueTitle("REMINDER_1H"),
  OVERDUE: (name) => `⚠️ Audit overdue: "${name}"`,
};

/**
 * The subject of a booking event's email: the event's push title with the
 * site name after it.
 */
export function bookingEmailSubject(
  eventType: BookingEventType,
  bookingName: string
): string {
  return `${BOOKING_TITLES[eventType](bookingName)}${EMAIL_SUBJECT_SUFFIX}`;
}

/**
 * The subject of an audit notice's email: the notice's push title with the
 * site name after it.
 */
export function auditEmailSubject(
  notice: AuditNotice,
  auditName: string
): string {
  return `${AUDIT_TITLES[notice](auditName)}${EMAIL_SUBJECT_SUFFIX}`;
}

/** The booking's page, the target of a booking email's button. */
function bookingUrl({ bookingId, organizationId }: BookingPushContext) {
  return `/bookings/${bookingId}?orgId=${organizationId}`;
}

/** The bookings list, for a booking whose page the reader cannot open. */
function bookingsListUrl({ organizationId }: BookingPushContext) {
  return `/bookings?orgId=${organizationId}`;
}

/** A booking event's push, titled for the event and opening `url`. */
function bookingPush(
  context: BookingPushContext,
  eventType: BookingEventType,
  body: string,
  url = bookingUrl(context)
): PushMessageDraft {
  return {
    organizationId: context.organizationId,
    category: "bookings",
    title: BOOKING_TITLES[eventType](context.bookingName),
    body,
    url,
  };
}

/** A booking's start and end. */
function bookingPeriod({ from, to }: BookingPeriodPushContext) {
  return `${from} to ${to}`;
}

/** An audit notice's push, titled for the notice; it opens the audit. */
function auditPush(
  context: AuditPushContext,
  notice: AuditNotice,
  body: string
): PushMessageDraft {
  return {
    organizationId: context.organizationId,
    category: "audits",
    title: AUDIT_TITLES[notice](context.auditName),
    body,
    url: `/audits/${context.auditId}/overview?orgId=${context.organizationId}`,
  };
}

/** The body of every reminder before an audit's due date. */
const AUDIT_DUE_BODY = "Complete it before it's due.";

/**
 * The push each event sends, built from that event's context. A new push
 * event needs its row here; the type checker refuses a table without it.
 */
export const PUSH_MESSAGES: {
  [E in PushEvent]: (context: PushContexts[E]) => PushMessageDraft;
} = {
  BOOKING_RESERVATION: (c) => bookingPush(c, "RESERVATION", bookingPeriod(c)),
  BOOKING_CHECKOUT_REMINDER: (c) =>
    bookingPush(c, "CHECKOUT_REMINDER", `Checkout on ${c.from}`),
  BOOKING_CHECKIN_REMINDER: (c) =>
    bookingPush(c, "CHECKIN_REMINDER", `Checkin on ${c.to}`),
  BOOKING_CHECKIN: (c) => bookingPush(c, "CHECKIN", bookingPeriod(c)),
  BOOKING_OVERDUE: (c) =>
    bookingPush(c, "OVERDUE", `Checkin was due on ${c.to}`),
  BOOKING_CANCEL: (c) => bookingPush(c, "CANCEL", bookingPeriod(c)),
  BOOKING_REVERT_TO_DRAFT: (c) =>
    bookingPush(c, "REVERT_TO_DRAFT", bookingPeriod(c)),
  BOOKING_EXTEND: (c) => bookingPush(c, "EXTEND", `Now ends on ${c.to}`),
  BOOKING_SHORTEN: (c) => bookingPush(c, "SHORTEN", `Now ends on ${c.to}`),
  BOOKING_DELETE: (c) =>
    bookingPush(c, "DELETE", bookingPeriod(c), bookingsListUrl(c)),
  BOOKING_UPDATE: (c) =>
    bookingPush(c, "UPDATE", "Details changed. Tap to review."),
  BOOKING_CUSTODIAN_ASSIGNED: (c) =>
    bookingPush(c, "UPDATE", "You are now the custodian. Tap to review."),
  BOOKING_CUSTODIAN_REMOVED: (c) => ({
    organizationId: c.organizationId,
    category: "bookings",
    title: "You were removed from a booking",
    body: c.bookingName,
    url: bookingsListUrl(c),
  }),

  AUDIT_ASSIGNED: (c) =>
    auditPush(c, "ASSIGNED", c.dueDate ? `Due on ${c.dueDate}` : "No due date"),
  AUDIT_REMINDER_24H: (c) => auditPush(c, "REMINDER_24H", AUDIT_DUE_BODY),
  AUDIT_REMINDER_4H: (c) => auditPush(c, "REMINDER_4H", AUDIT_DUE_BODY),
  AUDIT_REMINDER_1H: (c) => auditPush(c, "REMINDER_1H", AUDIT_DUE_BODY),
  AUDIT_OVERDUE: (c) =>
    auditPush(c, "OVERDUE", "Complete it as soon as possible."),

  ASSET_REMINDER: (c) => ({
    organizationId: c.organizationId,
    category: "stockAndReminders",
    title: "⏰ Asset Reminder Notice",
    body: `${c.reminderName} (${c.assetTitle})`,
    url: `/assets/${c.assetId}?orgId=${c.organizationId}`,
  }),
};
