import type { UserBusinessIntel } from "@prisma/client";

export interface CreateBusinessIntelPayload {
  userId: string;
  howDidYouHearAboutUs?: string | null;
  jobTitle?: string | null;
  teamSize?: string | null;
  companyName?: string | null;
  primaryUseCase?: string | null;
  currentSolution?: string | null;
  timeline?: string | null;
  /** Plan the signup link asked for ("team" | "plus"); see `~/modules/signup-intent`. */
  signupPlan?: string | null;
  /** Whether the signup link asked to start with a trial. */
  signupTrial?: boolean | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
}

export interface UpdateBusinessIntelPayload {
  howDidYouHearAboutUs?: string | null;
  jobTitle?: string | null;
  teamSize?: string | null;
  companyName?: string | null;
  primaryUseCase?: string | null;
  currentSolution?: string | null;
  timeline?: string | null;
  /** Plan the signup link asked for ("team" | "plus"); see `~/modules/signup-intent`. */
  signupPlan?: string | null;
  /** Whether the signup link asked to start with a trial. */
  signupTrial?: boolean | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
}

export type { UserBusinessIntel };
