import { OrganizationRoles } from "@prisma/client";
import { useRouteLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * This hook helps you to always know the roles of the current user
 * It also returns some helper boolean values to make it easier to check for specific roles
 */
export function useUserRoleHelper() {
  const roles = useRouteLoaderData<typeof loader>(
    "routes/_layout+/_layout"
  )?.currentOrganizationUserRoles;

  const isAdministrator = roles?.includes(OrganizationRoles.ADMIN) || false;
  const isOwner = roles?.includes(OrganizationRoles.OWNER) || false;
  const isAdministratorOrOwner = isAdministrator || isOwner;

  const isSelfService =
    roles?.includes(OrganizationRoles.SELF_SERVICE) || false;
  const isBase = roles?.includes(OrganizationRoles.BASE) || false;

  /** A lot of actions share the same permissions for base & self service */
  const isBaseOrSelfService = isBase || isSelfService;

  return {
    roles,
    isAdministrator,
    isOwner,
    isAdministratorOrOwner,
    isSelfService,
    isBase,
    isBaseOrSelfService,
  };
}
