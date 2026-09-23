/**
 * Paid team memberships for the subscription page.
 *
 * Shelf bills the workspace OWNER: a Team workspace runs on its owner's tier.
 * An invited member of that workspace pays nothing themselves and sits on the
 * free tier, so their own Stripe customer and tier say nothing about the plan
 * they work under. This module answers the question the subscription page
 * needs for them: which active, paid Team workspaces is this user a member of,
 * without owning them.
 *
 * Kept out of the route module so it can be unit-tested: a route may not export
 * helpers, since every retained export pulls its `*.server` imports into the
 * client bundle.
 *
 * @see {@link file://./../../routes/_layout+/account-details.subscription.tsx}
 * @see {@link file://./../../utils/stripe.server.ts} `disabledTeamOrg`, the rule {@link ownerTierRunsTeamWorkspace} mirrors
 */
import { OrganizationRoles, OrganizationType, TierId } from "@prisma/client";

/** A workspace membership, as far as the paid-team check is concerned. */
export type MembershipForPaidTeams = {
  roles: OrganizationRoles[];
  organization: {
    id: string;
    name: string;
    type: OrganizationType;
    /** The owner's user id: the workspace's billing party. */
    userId: string;
    /** Set by a Shelf admin to switch the workspace off for everyone. */
    workspaceDisabled: boolean;
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
 * Whether a workspace owner's tier keeps their Team workspaces running.
 *
 * Only Team (`tier_2`) and custom owners do. `disabledTeamOrg` in
 * `~/utils/stripe.server` disables a Team workspace whose owner is on `free`
 * or Plus (`tier_1`), so a member of such a workspace is not covered by any
 * plan. The two rules must stay the same: change one, change both.
 *
 * @param tierId - The workspace OWNER's tier
 * @returns `true` when the owner's Team workspaces are active
 */
export function ownerTierRunsTeamWorkspace(tierId: TierId): boolean {
  return tierId === TierId.tier_2 || tierId === TierId.custom;
}

/**
 * Whether the user owns the workspace of this membership.
 *
 * Ownership is recorded twice, as an OWNER role and as the organization's
 * `userId`, so either one counts.
 */
function isOwnedBy(membership: MembershipForPaidTeams, userId: string) {
  return (
    membership.roles.includes(OrganizationRoles.OWNER) ||
    membership.organization.userId === userId
  );
}

/**
 * The active, paid Team workspaces a user belongs to without owning them.
 *
 * Only a user on the free tier can be covered by someone else's plan. A user
 * on any other tier (Plus, Team or custom) has a plan of their own, whether or
 * not a Stripe product for it is recognised, so they get an empty list.
 *
 * Owning a Team workspace makes the user a billing party, so anyone who owns
 * one also gets an empty list and the page treats them as an owner, even if
 * they have also joined someone else's paid team. This is the same precedence
 * the admin user list applies in `getAccountStatus`.
 *
 * Otherwise a membership counts when all of these hold:
 * - the workspace is a TEAM (a PERSONAL workspace has no other members);
 * - the user does not own it ({@link isOwnedBy});
 * - the workspace is not switched off (`workspaceDisabled`);
 * - the owner's tier keeps the workspace running
 *   ({@link ownerTierRunsTeamWorkspace}).
 *
 * The last two are the checks the app layout uses to show a Team workspace as
 * disabled, so a member is never told a disabled workspace covers them.
 *
 * @param args.userId - The signed-in user
 * @param args.userTierId - The signed-in user's own tier
 * @param args.memberships - That user's `UserOrganization` rows, with each
 *   organization's type, owner id, `workspaceDisabled` flag and owner tier
 * @returns The matching workspaces as `{ id, name }`, in the input order
 */
export function getPaidTeamMemberships({
  userId,
  userTierId,
  memberships,
}: {
  userId: string;
  userTierId: TierId;
  memberships: MembershipForPaidTeams[];
}): PaidTeamMembership[] {
  if (userTierId !== TierId.free) {
    return [];
  }

  const teamMemberships = memberships.filter(
    ({ organization }) => organization.type === OrganizationType.TEAM
  );

  if (teamMemberships.some((membership) => isOwnedBy(membership, userId))) {
    return [];
  }

  return teamMemberships
    .filter(
      ({ organization }) =>
        !organization.workspaceDisabled &&
        ownerTierRunsTeamWorkspace(organization.owner.tierId)
    )
    .map(({ organization }) => ({
      id: organization.id,
      name: organization.name,
    }));
}
