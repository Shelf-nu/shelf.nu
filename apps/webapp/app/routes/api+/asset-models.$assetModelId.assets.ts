/**
 * Asset Model Assets API
 *
 * Returns the assets of one asset model, narrowed by the filters the asset
 * index is currently showing. Backs the model view's drill-down sheet, which
 * loads lazily because a model can hold hundreds of assets and a page shows
 * many models.
 *
 * The query, and every guard around it, lives in
 * {@link loadAssetModelBucketAssets}: the sibling route for the "No model"
 * bucket runs the same one, and a second copy of the permission gate,
 * organization scope and custodian redaction is how one of the two ends up
 * missing a guard.
 *
 * @see {@link file://./../../modules/asset-model/bucket-assets.server.ts}
 * @see {@link file://./asset-models.unassigned-assets.ts} The no-model bucket
 * @see {@link file://./../../components/assets/assets-index/asset-model-assets-sheet.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { loadAssetModelBucketAssets } from "~/modules/asset-model/bucket-assets.server";
import { getParams } from "~/utils/http.server";

/**
 * Loader for `GET /api/asset-models/:assetModelId/assets`.
 *
 * `assetModelId` is request input and is proven to belong to the caller's
 * organization before it reaches any query.
 *
 * @returns The bucket's assets, or a returned error payload the sheet renders
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetModelId } = getParams(
    params,
    z.object({ assetModelId: z.string().min(1) })
  );

  return loadAssetModelBucketAssets({
    bucket: { kind: "model", assetModelId },
    userId,
    request,
  });
}
