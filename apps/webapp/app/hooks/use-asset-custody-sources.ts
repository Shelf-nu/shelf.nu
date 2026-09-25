import { useRouteLoaderData } from "react-router";
import type { CustodySourceSummary } from "~/modules/asset/custody-source";
import type { loader } from "~/routes/_layout+/assets.$assetId";

/**
 * The asset's custody sources, from the asset detail loader
 * (`routes/_layout+/assets.$assetId`), for components rendered under it: the
 * header actions menu and the overview's custody, placements and quantity
 * cards. One loader feeds them all, so the Assign and Adjust dialogs show the
 * same numbers wherever they open from.
 *
 * @returns The summary, or null outside an asset page
 */
export function useAssetCustodySources(): CustodySourceSummary | null {
  return (
    useRouteLoaderData<typeof loader>("routes/_layout+/assets.$assetId")
      ?.custodySources ?? null
  );
}
