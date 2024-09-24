import { useFetchers, useLoaderData } from "@remix-run/react";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

/** Hook that returns the flags for the first column.
 * Can only be used in asset index page or its child routes
 */
export function useAssetIndexFreezeColumn() {
  const { settings } = useLoaderData<AssetIndexLoaderData>();

  /** Get the mode from the settings */
  const { freezeColumn } = settings;

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
