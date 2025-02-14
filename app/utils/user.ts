import type { User } from "@prisma/client";

/** Generates a random username based on the email and 3 random numbers
 * @param email string
 * @return username
 */
export const randomUsernameFromEmail = (email: string): string =>
  `${email.split("@")[0]}${Math.floor(Math.random() * 999)}`;

/** Resolves the team member name and inlcudes an email if needed */
export const resolveTeamMemberName = (
  teamMember: {
    name: string;
    user?: Partial<
      Pick<User, "firstName" | "lastName" | "profilePicture" | "email">
    > | null;
  },
  includeEmail?: boolean
): string => {
  if (includeEmail && teamMember?.user?.email) {
    return `${teamMember?.user?.firstName || ""} ${
      teamMember?.user?.lastName || ""
    } (${teamMember?.user?.email})`;
  }

  return teamMember?.user
    ? `${teamMember?.user?.firstName || ""} ${teamMember?.user?.lastName || ""}`
    : teamMember.name;
};
