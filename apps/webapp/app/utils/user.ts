/**
 * Name resolution for the people Shelf renders.
 *
 * `User.displayName` is the user-facing name. When it is set it REPLACES the
 * legal `firstName lastName` on every surface — lists, badges, notes, emails,
 * exports and PDFs. Only SSO users can set one (see the `updateDisplayName`
 * action in `~/routes/_layout+/account-details.general`), and setting it also
 * syncs `TeamMember.name`, so the two stay in step.
 *
 * @see {@link file://./../modules/user/fields.ts} — `USER_NAME_SELECT`, the
 *   Prisma fragment that selects exactly what these resolvers read.
 */

import type { User } from "@prisma/client";

/**
 * The name-bearing subset of a user.
 *
 * `displayName` is REQUIRED while the legal-name halves are optional, and that
 * asymmetry is the whole point: a projection that lists `firstName`/`lastName`
 * and quietly omits `displayName` still renders a perfectly plausible name, so
 * nothing at runtime — no test, no reviewer, no error — reveals that the user
 * is being called by a name they asked us not to use. Requiring the field here
 * is what turns that silence into a compile error.
 *
 * Pass the row through (spread it, or select with `USER_NAME_SELECT`) rather
 * than re-listing the fields by hand.
 */
export type UserNameFields = Pick<User, "displayName"> &
  Partial<Pick<User, "firstName" | "lastName">>;

/** A team member plus the user account behind it, if there is one. */
export type TeamMemberNameFields = {
  name: string;
  user?: (UserNameFields & Partial<Pick<User, "email">>) | null;
};

/** Generates a random username based on the email and 3 random numbers
 * @param email string
 * @return username
 */
export const randomUsernameFromEmail = (email: string): string =>
  `${email.split("@")[0]}${Math.floor(Math.random() * 999)}`;

/**
 * Resolves the name to show for a user.
 *
 * @param user - The user's name fields; `null`/`undefined` is tolerated so call
 *   sites don't need their own guard for an absent custodian or creator
 * @returns `displayName` when set, otherwise `firstName lastName`, otherwise ""
 */
export function resolveUserDisplayName(
  user: UserNameFields | null | undefined
): string {
  if (!user) return "";
  const trimmedDisplayName = user.displayName?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;
  const first = user.firstName?.trim() || "";
  const last = user.lastName?.trim() || "";
  return `${first} ${last}`.trim();
}

/**
 * Resolves the name to greet a user by, for email salutations ("Hey Sam,").
 *
 * Deliberately NOT {@link resolveUserDisplayName}: a greeting wants one short
 * name, so the fallback is the first name alone rather than the full legal
 * name. A display name is used whole, because it is the name the user chose to
 * be called by and we cannot know which part of it is the given name.
 *
 * @param user - The user being greeted; `null`/`undefined` returns ""
 * @returns `displayName` when set, otherwise `firstName`, otherwise ""
 */
export function resolveUserGreetingName(
  user: UserNameFields | null | undefined
): string {
  if (!user) return "";
  return user.displayName?.trim() || user.firstName?.trim() || "";
}

/**
 * Resolves the name to show for a team member.
 *
 * A registered member is named by their user account, so a display name wins
 * over the stored `TeamMember.name`. A non-registered member (NRM) has no user
 * account and is named by that stored value alone.
 *
 * @param teamMember - The member; `null`/`undefined` returns ""
 * @param includeEmail - Append ` (email)` when the member has a user account
 * @returns The resolved name, or "" when there is nothing to name
 */
export const resolveTeamMemberName = (
  teamMember: TeamMemberNameFields | null | undefined,
  includeEmail?: boolean
): string => {
  if (!teamMember) return "";
  const displayName = teamMember?.user
    ? resolveUserDisplayName(teamMember.user)
    : "";
  const name = displayName || teamMember.name;

  if (includeEmail && teamMember?.user?.email) {
    return `${name} (${teamMember.user.email})`;
  }

  return name;
};
