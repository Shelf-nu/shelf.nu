/**
 * Membership access: the `RoleAccess` of the caller's membership in the
 * active organization.
 *
 * `requirePermission` and `getMobileUserContext` return `access` already. This
 * exists for the few loaders that resolve the organization through
 * `getSelectedOrganization` directly (the model-filters search endpoint), so
 * they resolve access with the same inputs instead of re-deriving a role.
 *
 * @see {@link file://./role-access.ts}
 */
import type { RoleAccess, WorkspaceAccessSettings } from "./role-access";
import { resolveRoleAccess } from "./role-access";

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
