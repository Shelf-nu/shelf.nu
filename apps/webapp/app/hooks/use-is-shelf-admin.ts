import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * Whether the signed-in user is a **Shelf staff admin** (the platform-wide
 * `Roles.ADMIN` on the User record).
 *
 * Not to be confused with the per-workspace `OrganizationRoles.ADMIN` that
 * `useUserRoleHelper` reports — a workspace admin is an ordinary customer.
 *
 * Reads the value the `_layout` loader already derives, so the role check
 * itself lives in exactly one place.
 *
 * @returns `true` for Shelf staff admins, `false` otherwise
 */
export function useIsShelfAdmin() {
  const layoutData = useRouteLoaderData<typeof loader>(
    "routes/_layout+/_layout"
  );

  return Boolean(layoutData?.isAdmin);
}
