import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * This base hook is used to access the current organization
 * @returns The organization data or undefined if not found
 */
export function useCurrentOrganization() {
  const layoutData = useRouteLoaderData<typeof loader>(
    "routes/_layout+/_layout"
  );

  /** We make sure that currentOrganization exists within the loader, so layoutData cannot be null in this case */
  return layoutData?.currentOrganization;
}
