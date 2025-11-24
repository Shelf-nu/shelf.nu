import { useFetchers, useLoaderData } from "react-router";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

/** Hook that returns the flags for the first column.
 * Can only be used in asset index page or its child routes
 */
export function useAssetIndexFreezeColumn() {
  const { settings } = useLoaderData<AssetIndexLoaderData>();

  /** Get the mode from the settings
   * We meed to set it to false in the case when useAssetIndexFreezeColumn is called in a page different than the asset index page
   */
  const freezeColumn = settings?.freezeColumn || false;

  let optimisticFrozen = freezeColumn;
  const fetchers = useFetchers();
  /** Find the fetcher used for toggling between asset index modes */
  const freezeFetcher = fetchers.find(
    (fetcher) => fetcher.key === "asset-index-settings-freeze-column"
  );

  if (freezeFetcher?.formData) {
    // Usage in your hook
    optimisticFrozen = freezeFetcher?.formData
      ? freezeFetcher.formData.get("freezeColumn") === "yes"
      : freezeColumn;
  }

  return optimisticFrozen;
}
