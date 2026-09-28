import { OrganizationRoles } from "@prisma/client";
import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";
import { resolveMostPrivilegedRole } from "~/utils/role-precedence";

/**
 * This hook helps you to always know the roles of the current user
 * It also returns some helper boolean values to make it easier to check for specific roles
 */
export function useUserRoleHelper() {
  const roles = useRouteLoaderData<typeof loader>("routes/_layout+/_layout")
    ?.currentOrganizationUserRoles;

  const isAdministrator = roles?.includes(OrganizationRoles.ADMIN) || false;
  const isOwner = roles?.includes(OrganizationRoles.OWNER) || false;
  const isAdministratorOrOwner = isAdministrator || isOwner;

  const isSelfService =
    roles?.includes(OrganizationRoles.SELF_SERVICE) || false;
  const isBase = roles?.includes(OrganizationRoles.BASE) || false;

  /** A lot of actions share the same permissions for base & self service */
  const isBaseOrSelfService = isBase || isSelfService;

  /**
   * The one role the servers judge this membership by (its most privileged).
   * Gates that show or hide an action the server may refuse read this, not the
   * `is*` flags above, which are true for every role the membership holds.
   * BASE until the layout data loads, so no role-specific rule applies yet.
   */
  const effectiveRole = resolveMostPrivilegedRole(roles ?? []);

  return {
    roles,
    effectiveRole,
    isAdministrator,
    isOwner,
    isAdministratorOrOwner,
    isSelfService,
    isBase,
    isBaseOrSelfService,
  };
}
