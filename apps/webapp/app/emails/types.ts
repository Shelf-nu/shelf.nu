import type { Prisma } from "@prisma/client";
import type { BOOKING_INCLUDE_FOR_EMAIL } from "~/modules/booking/constants";

export type BookingForEmail = Prisma.BookingGetPayload<{
  include: typeof BOOKING_INCLUDE_FOR_EMAIL;
}>;

/** What the acting person did, as the label of the actor line. */
export type BookingEmailActorLabel =
  | "Reserved by"
  | "Completed by"
  | "Extended by"
  | "Reverted by"
  | "Cancelled by"
  | "Deleted by"
  | "Updated by";

/**
 * The person whose action a booking email reports. Rendered under the
 * heading as "<label>: <name> on <date, time>". Scheduled emails (reminders,
 * overdue) have no actor and leave it out.
 */
export type BookingEmailActor = {
  label: BookingEmailActorLabel;
  /** Their display name, from `resolveUserDisplayName`. */
  name: string;
  /** When the action ran. Each recipient sees it in their own format and zone. */
  at: Date;
};

export type EmailPayloadType = {
  /** Email address of recipient */
  to: string;

  /** Subject of email */
  subject: string;

  /** Text content of email */
  text: string;

  /** HTML content of email */
  html?: string;

  /** Override the default sender */
  from?: string;

  /** Override the default reply to email address */
  replyTo?: string;
};
