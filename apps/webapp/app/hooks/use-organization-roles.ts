/**
 * useOrganizationRoles: every role the signed-in member holds in the current
 * workspace, as the `_layout` loader returned them, carrying the workspace's
 * permission switches (`roleAccess.workspaceGrants`).
 *
 * For permission-MATRIX checks only: `userHasPermission({ roles, entity,
 * action })` grants the union of every held role, so it needs the whole
 * array, and it reads the switches the array carries, so a gate shows what
 * the owner switched on without passing anything else. Questions about reach
 * (whose bookings, whose custody, which audits, workspace ownership) read
 * `useRoleAccess()` instead. `undefined` until the layout data loads;
 * `userHasPermission` denies on it.
 *
 * @see {@link file://./use-role-access.ts}
 */
import { useMemo } from "react";
import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";
import type { MemberRoles } from "~/utils/permissions/member-roles";
import { withWorkspaceGrants } from "~/utils/permissions/member-roles";

/**
 * Returns the member's roles in the current workspace, carrying the
 * workspace's permission switches.
 *
 * @returns The member's roles, or `undefined` while the layout data loads
 */
export function useOrganizationRoles(): MemberRoles | undefined {
  const layout = useRouteLoaderData<typeof loader>("routes/_layout+/_layout");
  const roles = layout?.currentOrganizationUserRoles;
  const workspaceGrants = layout?.roleAccess.workspaceGrants;

  // why: memoized so the array keeps its identity across renders while the
  // loader data is unchanged; consumers put `roles` in effect and memo deps.
  return useMemo(
    () =>
      roles && workspaceGrants
        ? withWorkspaceGrants(roles, workspaceGrants)
        : roles,
    [roles, workspaceGrants]
  );
}
