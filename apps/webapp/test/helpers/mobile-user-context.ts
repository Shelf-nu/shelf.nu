/**
 * Builds a `getMobileUserContext` return value for route tests.
 *
 * Route tests mock that function, so every field a route reads must be present
 * on the mock. `access` is resolved by the real `resolveRoleAccess`, so a test
 * describes a membership and workspace, never a hand-written permission flag:
 *
 *     mobileUserContext({ roles: ["BASE"], workspace: { baseUserCanSeeBookings: true } })
 *
 * @see {@link file://./role-access.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import type { WorkspaceAccessSettings } from "~/utils/permissions/role-access";
import { accessFor } from "./role-access";

/**
 * A `getMobileUserContext` return value.
 *
 * @param overrides.roles - Every role on the membership (defaults to ADMIN)
 * @param overrides.workspace - Visibility toggles to switch on; the rest stay off
 * @param overrides.canUseBarcodes - Defaults to `true`
 * @param overrides.canUseAudits - Defaults to `true`
 * @returns The context, with `access` resolved from the roles and toggles
 */
export function mobileUserContext(
  overrides: {
    roles?: OrganizationRoles[];
    workspace?: Partial<WorkspaceAccessSettings>;
    canUseBarcodes?: boolean;
    canUseAudits?: boolean;
  } = {}
) {
  const roles = overrides.roles ?? [OrganizationRoles.ADMIN];
  return {
    roles,
    access: accessFor(roles, overrides.workspace),
    canUseBarcodes: overrides.canUseBarcodes ?? true,
    canUseAudits: overrides.canUseAudits ?? true,
  };
}
