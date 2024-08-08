import { useRouteLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * This base hook is used to access the organization from within the _layout route
 * @returns The organization data or undefined if not found
 */
export function useCurrentOrganization() {
  const layoutData = useRouteLoaderData<typeof loader>(
    "routes/_layout+/_layout"
  );

  if (!layoutData || !layoutData.organizations) {
    return undefined;
  }

  return layoutData.organizations.find(
    (organization) => organization.id === layoutData.currentOrganizationId
  );
}
