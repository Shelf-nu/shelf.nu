import type { Organization } from "@prisma/client";
import { useMatchesData } from "./use-matches-data";

/**
 * This base hook is used to access the organizationId from within the _layout route
 * @param {string} id The route id
 * @returns {JSON|undefined} The router data or undefined if not found
 */
export function useOrganizationId(): Organization["id"] | undefined {
  return useMatchesData<{
    currentOrganizationId: Organization["id"];
  }>("routes/_layout+/_layout")?.currentOrganizationId;
}
