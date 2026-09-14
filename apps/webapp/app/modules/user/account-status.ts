/**
 * Account status labels for the admin user list.
 *
 * The admin dashboard shows one line per user answering a billing question:
 * is this person paying, are they on a trial, or are they somebody else's
 * invited team member. The answer is assembled from the user's memberships
 * rather than from a single column, because Shelf bills the workspace OWNER —
 * an invited member of a paid team is themselves on the free tier, and reading
 * their own tier reports the wrong thing about the team they belong to.
 *
 * Kept out of the route module so it can be unit-tested: a route may not export
 * helpers, since every retained export pulls its `*.server` imports into the
 * client bundle.
 *
 * @see {@link file://./../../routes/_layout+/admin-dashboard+/users.tsx}
 */
import { OrganizationRoles, OrganizationType, TierId } from "@prisma/client";

import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { formatDate } from "~/utils/date-format";

/** A workspace membership, as far as the status label is concerned. */
export type MembershipForAccountStatus = {
  roles: OrganizationRoles[];
  organization: {
    id: string;
    type: OrganizationType;
    /** The owner's user id — the workspace's billing party. */
    userId: string;
    /** The owner, whose tier is what the workspace is actually paying for. */
    owner: { tierId: TierId };
  };
};

/** The subset of a Stripe subscription the label reads. */
export type SubscriptionForAccountStatus = {
  status?: string | null;
  trial_end?: number | null;
} | null;

/** A user row, as far as the status label is concerned. */
export type UserForAccountStatus = {
  id: string;
  tierId: TierId;
  subscription: SubscriptionForAccountStatus;
  userOrganizations: MembershipForAccountStatus[];
};

/**
 * Whether a tier is one somebody pays for.
 *
 * @param tierId - The tier to test
 * @returns `true` for every tier except the free one
 */
function isPaidTier(tierId: TierId): boolean {
  return tierId !== TierId.free;
}

/**
 * The team workspace this user owns, if any.
 *
 * Ownership is recorded twice — as an OWNER role and as the organization's
 * `userId` — so both are accepted.
 */
function findOwnedTeam(
  user: UserForAccountStatus
): MembershipForAccountStatus | undefined {
  return user.userOrganizations.find(
    (uo) =>
      uo.organization.type === OrganizationType.TEAM &&
      (uo.roles.includes(OrganizationRoles.OWNER) ||
        uo.organization.userId === user.id)
  );
}

/**
 * The team workspace this user was invited to.
 *
 * A user can be a member of several teams, so a paid one is preferred: the
 * label exists to answer "is this person already inside a paying team", and
 * answering "no" while one of their teams pays is the wrong answer.
 */
function findJoinedTeam(
  user: UserForAccountStatus
): MembershipForAccountStatus | undefined {
  const joinedTeams = user.userOrganizations.filter(
    (uo) =>
      uo.organization.type === OrganizationType.TEAM &&
      !uo.roles.includes(OrganizationRoles.OWNER)
  );

  return (
    joinedTeams.find((uo) => isPaidTier(uo.organization.owner.tierId)) ??
    joinedTeams[0]
  );
}

/**
 * The label for someone who pays for their own workspace — a team they own, or
 * a personal workspace. They are the billing party, so their own tier and
 * subscription are the right things to read.
 */
function formatOwnerStatus(
  user: UserForAccountStatus,
  prefs: ResolvedFormatPrefs
): string {
  const isTrial =
    user.subscription?.status === "trialing" && !!user.subscription?.trial_end;

  if (isTrial && user.subscription?.trial_end) {
    const trialEndDate = new Date(user.subscription.trial_end * 1000);
    const formattedDate = formatDate(trialEndDate, prefs, {
      month: "short",
      day: "numeric",
    });
    return `Owner (Trial - ends ${formattedDate})`;
  }

  if (user.tierId === TierId.tier_1) return "Owner (Paid - Plus)";
  if (user.tierId === TierId.tier_2) return "Owner (Paid - Team)";
  if (user.tierId === TierId.custom) return "Owner (Paid - Custom)";

  return "Owner (Free)";
}

/**
 * The label for someone who was invited into a team workspace.
 *
 * Read from the workspace OWNER's tier, never the member's own: an invited
 * member sits on the free tier no matter what their team pays, and a member who
 * separately bought Plus for their personal workspace is not evidence that the
 * team pays for anything.
 *
 * A trialing team reads as paid here. Distinguishing it would mean fetching the
 * owner's Stripe subscription for every row, and the owner's own line already
 * carries the trial and its end date.
 *
 * @param team - The team the user was invited to
 */
function formatMemberStatus(team: MembershipForAccountStatus): string {
  return isPaidTier(team.organization.owner.tierId)
    ? "Member (Invited to paid)"
    : "Member (Invited to team)";
}

/**
 * The admin dashboard's account status for one user.
 *
 * Owning a team makes someone the billing party even if they have also joined
 * other teams, so ownership is checked first. Someone who only joined teams is
 * labelled from those teams' owners; everyone else pays, or not, for their own.
 *
 * @param user - The user row, with memberships and their owners' tiers
 * @param prefs - Date formatting preferences, for a trial end date
 * @returns A human-readable status, e.g. `Member (Invited to paid)`
 */
export function getAccountStatus(
  user: UserForAccountStatus,
  prefs: ResolvedFormatPrefs
): string {
  if (!findOwnedTeam(user)) {
    const joinedTeam = findJoinedTeam(user);
    if (joinedTeam) {
      return formatMemberStatus(joinedTeam);
    }
  }

  return formatOwnerStatus(user, prefs);
}
