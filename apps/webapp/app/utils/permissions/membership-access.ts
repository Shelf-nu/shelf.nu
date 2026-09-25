/**
 * Membership access and membership rules.
 *
 * `resolveMembershipAccess` gives the `RoleAccess` of the caller's membership
 * in the active organization. `requirePermission` and `getMobileUserContext`
 * return `access` already; this exists for the few loaders that resolve the
 * organization through `getSelectedOrganization` directly (the model-filters
 * search endpoint), so they resolve access with the same inputs instead of
 * re-deriving a role.
 *
 * The membership rules answer who may assign a role, who may receive
 * transferred entities and what a role change moves, from the role policy
 * table. Every answer reads a `membership.*` policy field; nothing here names
 * a role. Pure (no server imports), so the team pages and the server actions
 * call the same functions. Two resolution styles are used on purpose:
 * - questions about ONE member's standing read the effective role
 *   (`resolveRole`), the same role every other policy decision reads;
 * - `holdsRoleWhere` is the in-memory twin of the Prisma filter
 *   `roles: { hasSome: rolesWhere(predicate) }`, so a list built with that
 *   filter and a check on one of its rows can never disagree.
 *
 * @see {@link file://./role-access.ts}
 */
import type {
  OrganizationRole,
  RoleAccess,
  RolePolicy,
  WorkspaceAccessSettings,
} from "./role-access";
import {
  ROLE_POLICIES,
  resolveRole,
  resolveRoleAccess,
  rolesWhere,
  transfersBookingsOnRoleChange,
  transfersOwnershipOnRoleChange,
} from "./role-access";

/**
 * Resolves the caller's access in `organizationId`.
 *
 * A caller with no membership in that organization resolves to BASE access
 * (the resolver's empty-roles answer), which denies every write scope.
 *
 * @param args.userOrganizations - The caller's memberships
 * @param args.organizationId - The active organization
 * @param args.workspace - That organization's visibility toggles
 * @returns The caller's access in the active organization
 */
export function resolveMembershipAccess({
  userOrganizations,
  organizationId,
  workspace,
}: {
  userOrganizations: ReadonlyArray<{
    organization: { id: string };
    roles: readonly string[];
  }>;
  organizationId: string;
  workspace: WorkspaceAccessSettings;
}): RoleAccess {
  return resolveRoleAccess({
    roles: userOrganizations.find((o) => o.organization.id === organizationId)
      ?.roles,
    workspace,
  });
}

/**
 * Whether any role a membership holds satisfies a policy predicate.
 *
 * @param roles - Every role on the membership (unknown strings never match)
 * @param predicate - A question about a role policy
 * @returns `true` when at least one held role's policy satisfies it
 */
export function holdsRoleWhere(
  roles: readonly string[] | undefined,
  predicate: (policy: RolePolicy) => boolean
): boolean {
  const matching: readonly string[] = rolesWhere(predicate);
  return (roles ?? []).some((held) => matching.includes(held));
}

/**
 * Whether granting, changing or revoking a role needs the workspace owner.
 *
 * @param role - The role being granted, or the member's current effective role
 * @returns `true` when only the owner may make the change
 */
export function roleChangeRequiresOwner(role: OrganizationRole): boolean {
  return ROLE_POLICIES[role].membership.changeRequiresOwner;
}

/**
 * Whether an actor may assign a role, through an invite (single, CSV, resend)
 * or a role change.
 *
 * @param args.actorOwnsWorkspace - `access.ownsWorkspace` of the acting member
 * @param args.role - The role being assigned
 * @returns `true` when the actor may assign it
 */
export function canAssignRole({
  actorOwnsWorkspace,
  role,
}: {
  actorOwnsWorkspace: boolean;
  role: OrganizationRole;
}): boolean {
  return actorOwnsWorkspace || !roleChangeRequiresOwner(role);
}

/** What a role change moves off the member whose role changes. */
export type RoleChangeTransfers = {
  /** Ownership columns: assets, categories, tags, locations, custom fields, images, kits, reminders. */
  ownership: boolean;
  /** Bookings the member created for a different registered custodian. */
  bookingsCreatedForOthers: boolean;
};

/**
 * What changing a member's role moves, from their effective role to the new
 * one. The change-role dialog, the entity-count preview, the manual role
 * change and SSO role transitions all call this, so what an admin confirms is
 * what moves.
 *
 * @param args.fromRoles - Every role the member holds now
 * @param args.to - The single role they will hold
 * @returns Which kinds of entities move to someone else
 */
export function roleChangeTransfers({
  fromRoles,
  to,
}: {
  fromRoles: readonly string[];
  to: OrganizationRole;
}): RoleChangeTransfers {
  const from = resolveRole(fromRoles);
  return {
    ownership: transfersOwnershipOnRoleChange({ from, to }),
    bookingsCreatedForOthers: transfersBookingsOnRoleChange({ from, to }),
  };
}
