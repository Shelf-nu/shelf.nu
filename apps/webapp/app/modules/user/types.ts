import type { Prisma, User } from "@prisma/client";

export interface UpdateUserPayload {
  id: User["id"];
  username?: User["username"];
  email?: User["email"];
  firstName?: User["firstName"];
  lastName?: User["lastName"];
  displayName?: User["displayName"];
  profilePicture?: User["profilePicture"];
  onboarded?: User["onboarded"];
  password?: string;
  confirmPassword?: string;
  usedFreeTrial?: boolean;
  /** User's chosen short-date field order; null → not yet detected. */
  dateFormat?: User["dateFormat"];
  /** 12- vs 24-hour clock; null → not yet detected. */
  timeFormat?: User["timeFormat"];
  /** First day of the week for calendars; null → not yet detected. */
  weekStart?: User["weekStart"];
  /** IANA time-zone name; null → not yet detected. */
  timeZone?: User["timeZone"];
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
