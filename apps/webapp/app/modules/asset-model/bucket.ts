/**
 * Asset Model View Buckets
 *
 * The model view's list is a rollup of the asset index's current result set,
 * and its rows come in two kinds: one per asset model, plus one synthetic
 * bucket holding the matching assets that carry no model at all. Both kinds
 * drill down into the same sheet, so both need a way to name "the assets
 * behind this row" as filters the asset index can parse.
 *
 * A bucket is a discriminated union rather than a nullable model id. Both the
 * drill-down URL and the sheet's escape-hatch link are built by string
 * interpolation, and a `null` id interpolates to the literal `"null"` with no
 * complaint from the compiler: a request to `/api/asset-models/null/assets`
 * that renders as "couldn't load" instead of failing the build. Narrowing on
 * `kind` is what makes the no-model case impossible to write as an id.
 *
 * Deliberately a plain module with no server imports. The drill-down endpoint
 * and the sheet component must produce the SAME predicate: the sheet states a
 * count and its footer link has to land on the set that count described, so
 * the predicate lives in one place both of them read.
 *
 * @see {@link file://./bucket-assets.server.ts} The shared drill-down loader
 * @see {@link file://./rollup.server.ts} Produces the rows a bucket addresses
 * @see {@link file://./../../components/assets/assets-index/asset-model-assets-sheet.tsx}
 */
import { AssetType } from "@prisma/client";

/**
 * The `assetModel` filter value that selects assets carrying no model.
 *
 * `generateWhereClause`'s `assetModel` branch (`~/modules/asset/query.server`)
 * reads this sentinel and emits `assetModelId IS NULL`, and the advanced
 * filter UI offers it as "No model". Model ids are cuids, so the sentinel can
 * never collide with one.
 */
export const WITHOUT_MODEL_FILTER_VALUE = "without-model";

/**
 * One row of the model view, named as something the asset index can filter on.
 *
 * `kind: "unassigned"` is the "No model" bucket. It deliberately carries no
 * id: no `AssetModel` row exists behind it, and the rollup builds it from the
 * absence of one.
 */
export type AssetModelBucket =
  | { kind: "model"; assetModelId: string }
  | { kind: "unassigned" };

/**
 * The endpoint that lists one bucket's assets.
 *
 * The two paths exist because the bucket has no id to put in one. Resolving
 * them here, behind the union, is what keeps every caller from interpolating a
 * missing id into a path segment.
 *
 * @param bucket - The rollup row to list
 * @returns The API path to fetch, without a query string
 */
export function getAssetModelBucketAssetsEndpoint(
  bucket: AssetModelBucket
): string {
  return bucket.kind === "model"
    ? `/api/asset-models/${bucket.assetModelId}/assets`
    : "/api/asset-models/unassigned-assets";
}

/**
 * Narrows a set of asset-index filter params to the assets behind one rollup
 * row. Mutates `params` in place, so callers hand it a copy of the search
 * string they want to extend.
 *
 * `assetModel` is `set`: the row IS the model selection, so it replaces any
 * model filter already in force instead of conflicting with it.
 *
 * `type` is added for the no-model bucket only. The rollup counts `INDIVIDUAL`
 * assets exclusively (a model describes N distinguishable units, so
 * `createAsset` and `updateAsset` both refuse to put one on a stock pool),
 * while `assetModelId IS NULL` also matches every `QUANTITY_TRACKED` asset.
 * Without this predicate the sheet lists rows the count above it never
 * included. A real model id implies `INDIVIDUAL` on its own, which is why the
 * model branch needs nothing.
 *
 * It is `append`, not `set`, because the rollup ANDs its own
 * `type = 'INDIVIDUAL'` onto whatever the caller already filtered by, and
 * `parseFilters` reads every entry of the query string. A second `type` entry
 * reproduces that conjunction exactly and leaves the caller's own
 * tracking-method filter standing; replacing it would widen the result past
 * the count.
 *
 * @param params - Filter params to narrow, mutated in place
 * @param bucket - The rollup row to narrow to
 */
export function applyAssetModelBucketFilters(
  params: URLSearchParams,
  bucket: AssetModelBucket
): void {
  if (bucket.kind === "model") {
    params.set("assetModel", `is:${bucket.assetModelId}`);
    return;
  }

  params.set("assetModel", `is:${WITHOUT_MODEL_FILTER_VALUE}`);

  // Skipped when the caller already asked for exactly this, which a user
  // filtering by tracking method before opening the view does. Adding it twice
  // narrows to the same set, but the escape-hatch link is read by the filter UI
  // as well, and it would draw the duplicate as a second identical row.
  const individualOnly = `is:${AssetType.INDIVIDUAL}`;

  if (!params.getAll("type").includes(individualOnly)) {
    params.append("type", individualOnly);
  }
}
