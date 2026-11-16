/**
 * Asset Index View
 *
 * Single source of truth for which of the asset index's three views is active.
 * The view lives in the URL (`?view=`), so it survives reloads and is
 * shareable; this hook is the only place that reads and writes that param.
 *
 * Availability is hidden on the user-assets page and below the `md` breakpoint
 * (the calendar needs the width). The model view additionally requires advanced
 * mode, because it renders advanced-index rows in its drill-down.
 *
 * Switching into the model view also drops the params that view cannot express,
 * via {@link stripModelViewInapplicableParams}. A URL that arrives already
 * carrying one is normalized by the Filter popover, which owns those controls.
 *
 * @see {@link file://./../components/assets/assets-index/advanced-asset-index-filters-and-sorting.tsx}
 */
import { useCallback } from "react";
import { stripModelViewInapplicableParams } from "~/modules/asset-model/view-params";
import { useSearchParams } from "./search-params";
import { useAssetIndexViewState } from "./use-asset-index-view-state";
import { useIsUserAssetsPage } from "./use-is-user-assets-page";
import { useViewportHeight } from "./use-viewport-height";

export type AssetIndexView = "table" | "availability" | "models";

/** Resolves the active view and the gates controlling which are offered. */
export function useAssetIndexView() {
  const isUserPage = useIsUserAssetsPage();
  const { isMd } = useViewportHeight();
  const { modeIsAdvanced } = useAssetIndexViewState();
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get("view");
  const view: AssetIndexView =
    raw === "availability" || raw === "models" ? raw : "table";

  const setView = useCallback(
    (next: AssetIndexView) => {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        if (next === "table") {
          newParams.delete("view");
        } else {
          newParams.set("view", next);
        }
        // Page numbers do not carry across views: each lists different things.
        newParams.delete("page");
        // The model view renders no control for the params it cannot express,
        // so one carried in from the list would be state with no way back off.
        // Dropped on the way in; the other views keep them.
        if (next === "models") {
          stripModelViewInapplicableParams(newParams);
        }
        return newParams;
      });
    },
    [setSearchParams]
  );

  return {
    view,
    // Re-exported because this hook already resolves them to gate the model
    // view: a consumer needing both the view and the mode reads the asset
    // index loader once instead of twice.
    modeIsSimple: !modeIsAdvanced,
    modeIsAdvanced,
    isAvailabilityView: view === "availability",
    // Gated on `shouldShowModelView`, unlike `isAvailabilityView`: `?view=models`
    // survives a switch back to SIMPLE mode, where the model view cannot render
    // and its toggle button is gone. Gating at the source means no call site can
    // forget it and render an advanced-only view in simple mode.
    isModelView: view === "models" && !isUserPage && isMd && modeIsAdvanced,
    shouldShowAvailabilityView: !isUserPage && isMd,
    shouldShowModelView: !isUserPage && isMd && modeIsAdvanced,
    setView,
  };
}
