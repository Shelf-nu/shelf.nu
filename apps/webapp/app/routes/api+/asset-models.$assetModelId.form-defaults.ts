/**
 * Asset Model Form Defaults API
 *
 * `GET /api/asset-models/:assetModelId/form-defaults` returns one model with
 * the defaults the asset form pre-fills from it (category, value, custom
 * fields) and its cover image.
 *
 * The asset form loads a page of models with their defaults. A model found by
 * searching the picker can be outside that page, and the form fetches it here
 * when it is picked so the pre-fill still works.
 *
 * @see {@link file://./../../components/assets/use-asset-model-lookup.ts}
 * @see {@link file://./../../modules/asset-model/service.server.ts} getAssetModelFormDefaults
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getAssetModelFormDefaults } from "~/modules/asset-model/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Loader for `GET /api/asset-models/:assetModelId/form-defaults`.
 *
 * `assetModelId` is request input; the lookup is scoped to the caller's
 * workspace, so another workspace's model reads as not found.
 *
 * @returns `{ assetModel }`, or a 404 error payload
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { assetModelId } = getParams(
      params,
      z.object({ assetModelId: z.string().min(1) })
    );

    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.assetModel,
      action: PermissionAction.read,
    });

    const assetModel = await getAssetModelFormDefaults({
      organizationId,
      assetModelId,
    });

    if (!assetModel) {
      throw new ShelfError({
        cause: null,
        message: "Asset model not found",
        additionalData: { assetModelId },
        status: 404,
        label: "Asset Model",
        shouldBeCaptured: false,
      });
    }

    return data(payload({ assetModel }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    // No toast: the form still works without the pre-fill, and the server
    // fills empty fields from the model on save.
    throw data(error(reason, false), { status: reason.status });
  }
}
