/**
 * useRoleAccess, the signed-in member's reach, as the server resolved it.
 *
 * Reads `roleAccess` from the `_layout` loader, so components ask the same
 * object the server's loaders and actions read. Before layout data exists it
 * returns BASE access with every toggle off: gates stay closed while loading.
 *
 * @see {@link file://../utils/permissions/role-access.ts}
 */
import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";
import type { RoleAccess } from "~/utils/permissions/role-access";
import { resolveRoleAccess } from "~/utils/permissions/role-access";

/**
 * The access every component reads before the `_layout` loader has run
 * (first paint, or a route rendered outside that loader's data). BASE, with
 * every workspace toggle off, so a gate reads "deny" rather than "unknown"
 * during that window.
 */
const LOADING_ACCESS = resolveRoleAccess({
  roles: [],
  workspace: {
    selfServiceCanSeeBookings: false,
    baseUserCanSeeBookings: false,
    selfServiceCanSeeCustody: false,
    baseUserCanSeeCustody: false,
  },
});

/**
 * Returns the current member's `RoleAccess`, as resolved by the `_layout`
 * loader for the active organization.
 *
 * @returns The current member's `RoleAccess`
 */
export function useRoleAccess(): RoleAccess {
  return (
    useRouteLoaderData<typeof loader>("routes/_layout+/_layout")?.roleAccess ??
    LOADING_ACCESS
  );
}
