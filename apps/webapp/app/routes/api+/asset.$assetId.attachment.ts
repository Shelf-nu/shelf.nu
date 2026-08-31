import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  removeAssetAttachment,
  updateAssetAttachment,
} from "~/modules/asset/service.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import {
  error,
  payload,
  getActionMethod,
  getParams,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * POST /api/asset/:assetId/attachment - upload (or replace) the asset's
 * single PDF attachment.
 * DELETE /api/asset/:assetId/attachment - remove it.
 *
 * A dedicated route (rather than folded into the edit-asset form action) so
 * the drag-and-drop widget can upload/delete instantly, independent of
 * whatever else is unsaved elsewhere on the edit page. See issue #2660.
 */
export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { assetId } = getParams(params, z.object({ assetId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const asset = await updateAssetAttachment({
          request,
          assetId,
          organizationId,
        });
        return data(payload({ asset }));
      }
      case "DELETE": {
        const asset = await removeAssetAttachment({ assetId, organizationId });
        return data(payload({ asset }));
      }
      default: {
        throw notAllowedMethod(method);
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}
