import type { Prisma } from "@prisma/client";
import type { BOOKING_INCLUDE_FOR_EMAIL } from "~/modules/booking/constants";

export type BookingForEmail = Prisma.BookingGetPayload<{
  include: typeof BOOKING_INCLUDE_FOR_EMAIL;
}>;

export type EmailPayloadType = {
  /**
   * Email address of the recipient. A comma separated list is allowed for
   * internal emails that go to several inboxes (see FEEDBACK_EMAIL); every
   * address in it is checked against the soft-deleted domain individually.
   */
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
