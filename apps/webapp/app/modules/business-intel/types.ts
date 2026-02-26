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
}

export interface UpdateBusinessIntelPayload {
  howDidYouHearAboutUs?: string | null;
  jobTitle?: string | null;
  teamSize?: string | null;
  companyName?: string | null;
  primaryUseCase?: string | null;
  currentSolution?: string | null;
  timeline?: string | null;
}

export type { UserBusinessIntel };
