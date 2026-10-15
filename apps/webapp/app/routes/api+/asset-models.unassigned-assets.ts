/**
 * Unassigned Assets API
 *
 * Returns the assets that carry no asset model, narrowed by the filters the
 * asset index is currently showing. Backs the "No model" row of the model
 * view's drill-down sheet, which is the row a customer starts from when
 * grouping an existing fleet into models.
 *
 * A separate path rather than a sentinel in the sibling route's
 * `:assetModelId` segment: no `AssetModel` row stands behind this bucket, and a
 * fake id sitting where every other value is a real cuid is a segment the
 * ownership check has to be taught to skip, which is exactly the shape in which
 * an organization scope goes missing. The path is one segment shallower than
 * `/:assetModelId/assets` so it cannot be shadowed by it either.
 *
 * The query and every guard around it live in
 * {@link loadAssetModelBucketAssets}, shared with the per-model route.
 *
 * @see {@link file://./../../modules/asset-model/bucket-assets.server.ts}
 * @see {@link file://./asset-models.$assetModelId.assets.ts} The per-model route
 * @see {@link file://./../../components/assets/assets-index/asset-model-assets-sheet.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { loadAssetModelBucketAssets } from "~/modules/asset-model/bucket-assets.server";

/**
 * Loader for `GET /api/asset-models/unassigned-assets`.
 *
 * Takes no id: the bucket is the absence of a model. The result is scoped by
 * the organization `requirePermission` resolves for the caller, which no part
 * of the request can influence.
 *
 * @returns The bucket's assets, or a returned error payload the sheet renders
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  return loadAssetModelBucketAssets({
    bucket: { kind: "unassigned" },
    userId,
    request,
  });
}
