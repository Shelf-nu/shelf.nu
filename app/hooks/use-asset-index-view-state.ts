import { useLoaderData, useLocation } from "@remix-run/react";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

export function useAssetIndexViewState() {
  const isAssetIndexPage = useIsAssetIndexPage();
  const data = useLoaderData<AssetIndexLoaderData>();

  if (!isAssetIndexPage) {
    /**
     * If we are not on the asset index, we always set the mode to simple,
     * because the asset list component could be used on other routes.
     * This makes sure it has the correct default mode.
     */
    return {
      mode: null,
      modeIsSimple: true,
      modeIsAdvanced: false,
      settings: null,
      isAssetIndexPage: false,
    };
  }

  const mode = data?.settings?.mode || "SIMPLE";
  return {
    mode,
    modeIsSimple: mode === "SIMPLE",
    modeIsAdvanced: mode === "ADVANCED",
    settings: data?.settings,
    isAssetIndexPage: true,
  };
}

/** Hook that returns the mode used in the asset index.
 * Can only be used in asset index page or its child routes
 */
export function useAssetIndexMode() {
  const { mode, modeIsSimple, modeIsAdvanced } = useAssetIndexViewState();
  return { mode, modeIsSimple, modeIsAdvanced };
}

/**
 * Checks if the current page is the asset index page.
 * @returns {boolean} - True if the current page is the asset index page, otherwise false.
 */
export const useIsAssetIndexPage = (): boolean => {
  const location = useLocation();
  return location.pathname === "/assets";
};
