import type { AssetIndexMode } from "@prisma/client";
import { useFetchers, useLoaderData } from "@remix-run/react";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

/** Hook that returns the mode used in the asset index.
 * Can only be used in asset index page or its child routes
 */
export function useAssetIndexMode() {
  const { settings } = useLoaderData<AssetIndexLoaderData>();

  /** Get the mode from the settings */
  const mode = settings?.mode || "SIMPLE";

  let optimisticMode = mode;
  const fetchers = useFetchers();
  /** Find the fetcher used for toggling between asset index modes */
  const modeFetcher = fetchers.find(
    (fetcher) => fetcher.key === "asset-index-settings-mode"
  );

  if (modeFetcher?.formData) {
    optimisticMode = modeFetcher.formData.get("mode") as AssetIndexMode;
  }
  return {
    mode: optimisticMode,
    modeIsSimple: optimisticMode === "SIMPLE",
    modeIsAdvanced: optimisticMode === "ADVANCED",
  };
}
