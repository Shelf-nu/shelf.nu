import type { User } from "@prisma/client";

/** Generates a random username based on the email and 3 random numbers
 * @param email string
 * @return username
 */
export const randomUsernameFromEmail = (email: string): string =>
  `${email.split("@")[0]}${Math.floor(Math.random() * 999)}`;

/** Resolves the display name for a user.
 * Returns displayName if set, otherwise falls back to firstName + lastName.
 */
export function resolveUserDisplayName(
  user:
    | Partial<Pick<User, "displayName" | "firstName" | "lastName">>
    | null
    | undefined
): string {
  if (!user) return "";
  const trimmedDisplayName = user.displayName?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;
  const first = user.firstName?.trim() || "";
  const last = user.lastName?.trim() || "";
  return `${first} ${last}`.trim();
}

/** Resolves the team member name and includes an email if needed */
export const resolveTeamMemberName = (
  teamMember: {
    name: string;
    user?: Partial<
      Pick<User, "displayName" | "firstName" | "lastName" | "email">
    > | null;
  },
  includeEmail?: boolean
): string => {
  const displayName = teamMember?.user
    ? resolveUserDisplayName(teamMember.user)
    : "";
  const name = displayName || teamMember.name;

  if (includeEmail && teamMember?.user?.email) {
    return `${name} (${teamMember.user.email})`;
  }

  return name;
};
