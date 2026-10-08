/**
 * useOrganizationRoles: every role the signed-in member holds in the current
 * workspace, as the `_layout` loader returned them.
 *
 * For permission-MATRIX checks only: `userHasPermission({ roles, entity,
 * action })` grants the union of every held role, so it needs the whole
 * array. Questions about reach (whose bookings, whose custody, which audits,
 * workspace ownership) read `useRoleAccess()` instead. `undefined` until the
 * layout data loads; `userHasPermission` denies on it.
 *
 * @see {@link file://./use-role-access.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * Returns the member's roles in the current workspace.
 *
 * @returns The member's roles, or `undefined` while the layout data loads
 */
export function useOrganizationRoles(): OrganizationRoles[] | undefined {
  return useRouteLoaderData<typeof loader>("routes/_layout+/_layout")
    ?.currentOrganizationUserRoles;
}
