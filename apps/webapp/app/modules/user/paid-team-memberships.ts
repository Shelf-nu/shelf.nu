/**
 * Paid team memberships for the subscription page.
 *
 * Shelf bills the workspace OWNER: a Team workspace is paid for when its
 * owner's tier is a paid one. An invited member of that workspace pays nothing
 * themselves and sits on the free tier, so their own Stripe customer and tier
 * say nothing about the plan they work under. This module answers the question
 * the subscription page needs for them: which paid Team workspaces is this
 * user a member of, without owning them.
 *
 * Kept out of the route module so it can be unit-tested: a route may not export
 * helpers, since every retained export pulls its `*.server` imports into the
 * client bundle.
 *
 * @see {@link file://./account-status.ts} for the same owner-tier rule on the admin user list
 * @see {@link file://./../../routes/_layout+/account-details.subscription.tsx}
 */
import type { TierId } from "@prisma/client";
import { OrganizationRoles, OrganizationType } from "@prisma/client";

import { isPaidTier } from "./account-status";

/** A workspace membership, as far as the paid-team check is concerned. */
export type MembershipForPaidTeams = {
  roles: OrganizationRoles[];
  organization: {
    id: string;
    name: string;
    type: OrganizationType;
    /** The owner's user id: the workspace's billing party. */
    userId: string;
    /** The owner, whose tier is the plan the workspace runs on. */
    owner: { tierId: TierId };
  };
};

/**
 * A paid Team workspace the user is a member of.
 *
 * Only the id and the workspace name: the page names the team, and nothing
 * about the owner or their billing belongs in a member's payload.
 */
export type PaidTeamMembership = { id: string; name: string };

/**
 * The paid Team workspaces a user belongs to without owning them.
 *
 * A membership counts when all of these hold:
 * - the workspace is a TEAM (a PERSONAL workspace has no other members);
 * - the user does not own it. Ownership is recorded twice, as an OWNER role
 *   and as the organization's `userId`, so either one excludes it;
 * - the owner's tier is a paid one ({@link isPaidTier}).
 *
 * @param args.userId - The signed-in user
 * @param args.memberships - That user's `UserOrganization` rows, with each
 *   organization's type, owner id and owner tier
 * @returns The matching workspaces as `{ id, name }`, in the input order
 */
export function getPaidTeamMemberships({
  userId,
  memberships,
}: {
  userId: string;
  memberships: MembershipForPaidTeams[];
}): PaidTeamMembership[] {
  return memberships
    .filter(
      ({ roles, organization }) =>
        organization.type === OrganizationType.TEAM &&
        !roles.includes(OrganizationRoles.OWNER) &&
        organization.userId !== userId &&
        isPaidTier(organization.owner.tierId)
    )
    .map(({ organization }) => ({
      id: organization.id,
      name: organization.name,
    }));
}
