/**
 * Params that describe the asset index's MODEL view.
 *
 * They configure the rollup — which view is active, how its rows are sorted,
 * which page of models is shown — and mean nothing to a query over assets. Any
 * surface that turns the model view's URL into an asset-scoped one strips them
 * first: leaving `view=models` in place would send the user straight back to
 * the rollup, and leaving `page` would apply a model page number to a list of
 * assets.
 *
 * Deliberately a plain module with no server imports: both the drill-down
 * endpoint and the sheet component need this list, and importing it from the
 * route would pull server-only code into the client bundle.
 *
 * @see {@link file://./../../routes/api+/asset-models.$assetModelId.assets.ts}
 * @see {@link file://./../../components/assets/assets-index/asset-model-assets-sheet.tsx}
 */
export const MODEL_VIEW_SCOPED_PARAMS = [
  "view",
  "modelSortBy",
  "modelSortDirection",
  "page",
] as const;

/**
 * Params the model view cannot express.
 *
 * The inverse of {@link MODEL_VIEW_SCOPED_PARAMS}: these mean something real
 * to a query over assets, but nothing reachable from this view, so they are
 * stripped twice over. Any asset query the view builds drops them, and the
 * Filter popover drops them from the URL itself while the view is on screen,
 * because the view hides the toggles that set them and a param no control can
 * reach is state the user cannot get back off.
 *
 * `lowStockOnly` narrows to `QUANTITY_TRACKED` assets at or below their
 * reorder threshold. The rollup counts `INDIVIDUAL` assets only, so the two
 * are mutually exclusive by construction: forwarded into a drill-down it
 * returns nothing, every time.
 *
 * @see {@link file://./../../components/assets/assets-index/advanced-asset-index-filters-and-sorting.tsx}
 * @see {@link file://./../../hooks/use-asset-index-view.ts}
 */
export const MODEL_VIEW_INAPPLICABLE_PARAMS = ["lowStockOnly"] as const;

/**
 * Which of {@link MODEL_VIEW_INAPPLICABLE_PARAMS} are set in `params`.
 *
 * Read-only, so a caller holding react-router's live `URLSearchParams` can ask
 * the question without mutating the URL it is rendering from.
 *
 * @param params - The params to inspect
 * @returns The names that are present, in declaration order
 */
export function findModelViewInapplicableParams(
  params: URLSearchParams
): string[] {
  return MODEL_VIEW_INAPPLICABLE_PARAMS.filter((param) => params.has(param));
}

/**
 * Removes {@link MODEL_VIEW_INAPPLICABLE_PARAMS} from `params`, in place.
 *
 * The one place the removal happens, so the surface that switches INTO the model
 * view and the one that normalizes a URL arriving on it cannot come to disagree
 * about which params this view is unable to express.
 *
 * @param params - The params to normalize; mutated
 * @returns The names that were present and have been removed
 */
export function stripModelViewInapplicableParams(
  params: URLSearchParams
): string[] {
  const present = findModelViewInapplicableParams(params);
  present.forEach((param) => params.delete(param));
  return present;
}
