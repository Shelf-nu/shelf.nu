import { useFetchers } from "react-router";
import { useAssetIndexViewState } from "./use-asset-index-view-state";

/** Hook that returns the image flag for the first column.
 * Can only be used in asset index page or its child routes
 */
export function useAssetIndexShowImage() {
  const { settings } = useAssetIndexViewState();

  /** Get the mode from the settings */
  const showAssetImage = settings?.showAssetImage || false;

  let optimisticShowAssetImage = showAssetImage;
  const fetchers = useFetchers();
  /** Find the fetcher used for toggling between asset index modes */
  const fetcher = fetchers.find(
    (fetcher) => fetcher.key === "asset-index-settings-show-image"
  );

  if (fetcher?.formData) {
    // Usage in your hook
    optimisticShowAssetImage = fetcher?.formData
      ? fetcher.formData.get("showAssetImage") === "yes"
      : optimisticShowAssetImage;
  }

  return optimisticShowAssetImage;
}
