import type { Prisma } from "@prisma/client";

export type BookingForEmail = Prisma.BookingGetPayload<{
  include: {
    custodianTeamMember: true;
    custodianUser: true;
    organization: {
      include: {
        owner: {
          select: { email: true };
        };
      };
    };
    _count: {
      select: { assets: true };
    };
  };
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
