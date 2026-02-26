import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";

/**
 * This base hook is used to access the organizationId from within the _layout route
 */
export function useOrganizationId() {
  return useRouteLoaderData<typeof loader>("routes/_layout+/_layout")
    ?.currentOrganizationId;
}
