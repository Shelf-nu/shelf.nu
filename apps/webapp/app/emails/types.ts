import type { Booking, Organization, TeamMember, User } from "@shelf/database";

export type BookingForEmail = Booking & {
  custodianTeamMember: TeamMember | null;
  custodianUser: User | null;
  organization: Organization & {
    owner: { email: string } | null;
  };
  _count: { assets: number };
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
