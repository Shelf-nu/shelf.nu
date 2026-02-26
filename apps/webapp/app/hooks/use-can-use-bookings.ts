import { useRouteLoaderData } from "react-router";
import type { loader } from "~/routes/_layout+/_layout";
import { isPersonalOrg } from "~/utils/organization";
import { useCurrentOrganization } from "./use-current-organization";

/**
 * Returns whether the current organization can use bookings.
 *
 * Checks BOTH the server-side `canUseBookings` flag (which respects
 * ENABLE_PREMIUM_FEATURES) AND the org type. Even when premium is
 * disabled, Personal orgs cannot actually create bookings — the
 * booking route loader will reject them. So we always return false
 * for Personal orgs to avoid showing broken CTAs.
 */
export function useCanUseBookings(): boolean {
  const layoutData = useRouteLoaderData<typeof loader>(
    "routes/_layout+/_layout"
  );
  const currentOrganization = useCurrentOrganization();

  // Personal orgs can never use bookings regardless of premium flag
  if (isPersonalOrg(currentOrganization)) {
    return false;
  }

  return layoutData?.canUseBookings ?? false;
}
