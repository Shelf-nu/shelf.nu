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
 * Params the model view cannot express, stripped from any asset query it
 * builds.
 *
 * The inverse of {@link MODEL_VIEW_SCOPED_PARAMS}: these mean something real
 * to a query over assets, but nothing reachable from this view, so a value
 * left in the URL is stale state the user has no control to clear.
 *
 * `lowStockOnly` narrows to `QUANTITY_TRACKED` assets at or below their
 * reorder threshold. The rollup counts `INDIVIDUAL` assets only, so the two
 * are mutually exclusive by construction: forwarded into a drill-down it
 * returns nothing, every time, and the model view hides the toggle that would
 * let anyone turn it back off.
 */
export const MODEL_VIEW_INAPPLICABLE_PARAMS = ["lowStockOnly"] as const;
