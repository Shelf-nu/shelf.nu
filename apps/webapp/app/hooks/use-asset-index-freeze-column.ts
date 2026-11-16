import { useFetchers, useLoaderData } from "react-router";
import { useAssetIndexSettingsOverrides } from "~/context/asset-index-settings-context";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

/** Hook that returns the flags for the first column.
 * Can only be used in asset index page or its child routes.
 *
 * A mounted `AssetIndexSettingsProvider` overriding `freezeColumn` wins over
 * the loader's stored value and the optimistic fetcher update below — this is
 * how the drill-down sheet turns the frozen column off without a checkbox
 * column of its own to anchor it to.
 */
export function useAssetIndexFreezeColumn() {
  const overrides = useAssetIndexSettingsOverrides();
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

  // Checked last, after every hook above has run in a stable order: an
  // early return here would change the hook call order between renders.
  if (overrides?.freezeColumn !== undefined) {
    return overrides.freezeColumn;
  }

  return optimisticFrozen;
}
