/**
 * Member roles: a member's roles in the current workspace together with that
 * workspace's permission switches, as `useOrganizationRoles()` hands them out.
 *
 * Pure (no `.client` suffix, no server imports) so the client validator and
 * the shared navigation modules (`admin-areas.ts`) read the switches the same
 * way.
 *
 * @see {@link file://../../hooks/use-organization-roles.ts}
 * @see {@link file://./permission.validator.client.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import type { WorkspaceGrantSettings } from "./role-access";

/**
 * A role array carrying the workspace's permission switches. Still a plain
 * role array to every other reader; a copy (`[...roles]`, `.filter`) drops
 * the switches and reads as all-off, the safe direction.
 */
export type MemberRoles = OrganizationRoles[] & {
  readonly workspaceGrants?: WorkspaceGrantSettings;
};

/**
 * Attaches the workspace's permission switches to a role array.
 *
 * @param roles - The member's roles in the current workspace
 * @param workspaceGrants - That workspace's permission switches
 * @returns A new role array carrying the switches
 */
export function withWorkspaceGrants(
  roles: readonly OrganizationRoles[],
  workspaceGrants: WorkspaceGrantSettings
): MemberRoles {
  return Object.assign([...roles], { workspaceGrants });
}

/**
 * The switches a role array carries, for `roleHasPermission`'s `workspace`.
 *
 * @param roles - Roles from `useOrganizationRoles()`, or any plain role array
 * @returns The switches, or `undefined` (all off) for a plain array
 */
export function workspaceGrantsOf(
  roles: readonly OrganizationRoles[] | MemberRoles | undefined
): WorkspaceGrantSettings | undefined {
  return (roles as MemberRoles | undefined)?.workspaceGrants;
}
