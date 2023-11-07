import type { Organization } from "@prisma/client";
import { ShelfStackError } from "~/utils/error";
import { useMatchesData } from "./use-matches-data";

/**
 * This base hook is used to access the organization from within the _layout route
 * @param {string} id The route id
 * @returns {JSON|undefined} The router data or undefined if not found
 */
export function useCurrentOrganization(): Organization | undefined {
  const layoutData = useMatchesData<{
    organizations: Organization[];
    currentOrganizationId: string;
  }>("routes/_layout+/_layout");

  if (!layoutData) {
    throw new ShelfStackError({
      message:
        "Something went wrong with fetching your organization defails. If the issue persists, please contact support",
    });
  }

  return layoutData.organizations.find(
    (organization) => organization.id === layoutData.currentOrganizationId
  );
}
