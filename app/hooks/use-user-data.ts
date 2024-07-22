import type { OrganizationRoles } from "@prisma/client";
import { useRouteLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * This base hook is used to access the user data from within the _layout route
 */
export function useUserData() {
  let user = useRouteLoaderData<typeof loader>("routes/_layout+/_layout")?.user;
  return user;
}

export function useUserOrgRoles(): OrganizationRoles[] {
  const data = useRouteLoaderData<typeof loader>("routes/_layout+/_layout");

  const currentOrganizationId = data?.currentOrganizationId;
  const user = data?.user;

  if (!currentOrganizationId || !user) return [];

  const userOrg = user.userOrganizations.find(
    (uo) => uo.organization.id === currentOrganizationId
  );

  return userOrg?.roles || [];
}
