import type { Prisma, User } from "@prisma/client";

export interface UpdateUserPayload {
  id: User["id"];
  username?: User["username"];
  email?: User["email"];
  firstName?: User["firstName"];
  lastName?: User["lastName"];
  profilePicture?: User["profilePicture"];
  onboarded?: User["onboarded"];
  password?: string;
  confirmPassword?: string;
  usedFreeTrial?: boolean;
  referralSource?: User["referralSource"];
  jobTitle?: User["jobTitle"];
  teamSize?: User["teamSize"];
  companyName?: User["companyName"];
  primaryUseCase?: User["primaryUseCase"];
  currentSolution?: User["currentSolution"];
  timeline?: User["timeline"];
}

export interface UpdateUserResponse {
  user: User | null;
  errors: {
    /** key is the field name, value is the error message */
    username?: string | null;
    [k: string]: string | unknown;
  } | null;

  /** Used when sending a pwd reset link for the user */
  passwordReset?: boolean;
}

export const USER_STATIC_INCLUDE = {
  userOrganizations: true,
} satisfies Prisma.UserInclude;
