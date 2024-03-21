import { OrganizationRoles } from "@prisma/client";
import { useRouteLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * This base hook is used to check if user is self service
 */
export function useUserIsSelfService(): boolean {
  const roles = useRouteLoaderData<typeof loader>("routes/_layout+/_layout")
    ?.currentOrganizationUserRoles;
  return roles?.includes(OrganizationRoles.SELF_SERVICE) || false;
}
