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
