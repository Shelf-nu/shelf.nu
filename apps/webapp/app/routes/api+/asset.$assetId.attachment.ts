import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  clearStagedAssetAttachment,
  removeAssetAttachment,
  stageAssetAttachment,
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
 *
 * The create-asset form reuses this same widget/route before the asset
 * exists, passing a client-generated placeholder id - see AssetForm's
 * pendingId. When no asset with `assetId` exists in this org yet, POST/DELETE
 * fall through to the storage-only staging path (stageAssetAttachment /
 * clearStagedAssetAttachment) instead of the DB-backed one; createAsset()
 * persists the staged metadata once the rest of the form is submitted.
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

    const existingAsset = await db.asset.findFirst({
      where: { id: assetId, organizationId },
      select: { id: true },
    });

    switch (method) {
      case "POST": {
        if (!existingAsset) {
          const staged = await stageAssetAttachment({
            request,
            assetId,
            organizationId,
          });
          return data(payload(staged));
        }
        const asset = await updateAssetAttachment({
          request,
          assetId,
          organizationId,
        });
        return data(
          payload({
            attachmentUrl: asset.attachmentUrl,
            attachmentOriginalName: asset.attachmentOriginalName,
            attachmentSize: asset.attachmentSize,
          })
        );
      }
      case "DELETE": {
        if (!existingAsset) {
          await clearStagedAssetAttachment({ assetId, organizationId });
          return data(payload({ success: true }));
        }
        await removeAssetAttachment({ assetId, organizationId });
        return data(payload({ success: true }));
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
