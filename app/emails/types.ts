import type { Prisma } from "@prisma/client";
import type {
  BOOKING_INCLUDE_FOR_EMAIL,
  BOOKING_INCLUDE_FOR_RESERVATION_EMAIL,
} from "~/modules/booking/constants";

export type BookingForEmail = Prisma.BookingGetPayload<{
  include: typeof BOOKING_INCLUDE_FOR_EMAIL;
}>;

export type BookingForReservationEmail = Prisma.BookingGetPayload<{
  include: typeof BOOKING_INCLUDE_FOR_RESERVATION_EMAIL;
}>;

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
