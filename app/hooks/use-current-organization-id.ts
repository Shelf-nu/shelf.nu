import { useRouteLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/_layout";
import { ShelfError } from "~/utils/error";

/**
 * This base hook is used to access the organization from within the _layout route
 * @returns The organization data or undefined if not found
 */
export function useCurrentOrganization() {
  const layoutData = useRouteLoaderData<typeof loader>(
    "routes/_layout+/_layout"
  );

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
