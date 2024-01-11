import { OrganizationRoles, type $Enums } from "@prisma/client";
import { useMatchesData } from ".";

/**
 * This base hook is used to check if user is self service
 */
export function useUserIsSelfService(): boolean {
  let roles = useMatchesData<{
    currentOrganizationUserRoles: $Enums.OrganizationRoles[] | undefined;
  }>("routes/_layout+/_layout")?.currentOrganizationUserRoles;
  return roles?.includes(OrganizationRoles.SELF_SERVICE) || false;
}
