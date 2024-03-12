import type { Organization } from "@prisma/client";
import { ShelfError } from "~/utils/error";
import { useMatchesData } from "./use-matches-data";

/**
 * This base hook is used to access the organization from within the _layout route
 * @returns The organization data or undefined if not found
 */
export function useCurrentOrganization(): Organization | undefined {
  const layoutData = useMatchesData<{
    organizations: Organization[];
    currentOrganizationId: string;
  }>("routes/_layout+/_layout");

  // FIXME: check what throwing in frontend implies
  if (!layoutData) {
    throw new ShelfError({
      cause: null,
      message:
        "Something went wrong with fetching your organization details. If the issue persists, please contact support",
      label: "Organization",
    });
  }

  return layoutData.organizations.find(
    (organization) => organization.id === layoutData.currentOrganizationId
  );
}
