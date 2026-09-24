/**
 * Role access builders for route and service tests.
 *
 * Routes read `access` from `requirePermission` / `getMobileUserContext`, and
 * booking services take it as a parameter. Tests build it here through the
 * real `resolveRoleAccess`, so a fixture can never describe an access object
 * the policy table would not produce.
 *
 *     requirePermissionMock.mockResolvedValue(
 *       permissionContext({ roles: ["SELF_SERVICE"], workspace: { selfServiceCanSeeBookings: true } })
 *     );
 *
 * @see {@link file://../../app/utils/permissions/role-access.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import {
  isSelfServiceOrBaseRole,
  resolveMostPrivilegedRole,
} from "~/utils/booking-authorization.server";
import type {
  RoleAccess,
  WorkspaceAccessSettings,
} from "~/utils/permissions/role-access";
import { resolveRoleAccess } from "~/utils/permissions/role-access";

/** Every workspace visibility toggle switched off. */
export const ALL_TOGGLES_OFF: WorkspaceAccessSettings = {
  selfServiceCanSeeBookings: false,
  baseUserCanSeeBookings: false,
  selfServiceCanSeeCustody: false,
  baseUserCanSeeCustody: false,
};

/**
 * The `RoleAccess` a membership resolves to.
 *
 * @param roles - Every role on the membership
 * @param workspace - Toggles to switch on; the rest stay off
 */
export function accessFor(
  roles: OrganizationRoles[],
  workspace: Partial<WorkspaceAccessSettings> = {}
): RoleAccess {
  return resolveRoleAccess({
    roles,
    workspace: { ...ALL_TOGGLES_OFF, ...workspace },
  });
}

/**
 * A `requirePermission` return value for route tests: the fields routes read
 * today plus `access`, all derived from the same roles and toggles so they
 * cannot disagree.
 *
 * @param args.roles - Every role on the membership (defaults to ADMIN)
 * @param args.workspace - Toggles to switch on
 * @param args.organizationId - The active organization (defaults to "org-1")
 */
export function permissionContext({
  roles = [OrganizationRoles.ADMIN],
  workspace = {},
  organizationId = "org-1",
}: {
  roles?: OrganizationRoles[];
  workspace?: Partial<WorkspaceAccessSettings>;
  organizationId?: string;
} = {}) {
  const toggles = { ...ALL_TOGGLES_OFF, ...workspace };
  const access = accessFor(roles, toggles);
  const role = resolveMostPrivilegedRole(roles);

  return {
    organizationId,
    role,
    isSelfServiceOrBase: isSelfServiceOrBaseRole(role),
    canSeeAllBookings: access.bookings.seeAll,
    canSeeAllCustody: access.custody.seeAll,
    access,
    userOrganizations: [{ organization: { id: organizationId }, roles }],
    currentOrganization: { id: organizationId, ...toggles },
  };
}
