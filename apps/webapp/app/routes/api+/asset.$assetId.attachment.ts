/**
 * Upload / replace / remove endpoint for an asset's single PDF attachment.
 *
 * Branches on whether the asset already exists: for an existing asset it
 * persists directly via `updateAssetAttachment` / `removeAssetAttachment`;
 * for one that doesn't exist yet (the create-asset form's staging flow) it
 * only touches storage via `stageAssetAttachment` / `clearStagedAssetAttachment`,
 * and `createAsset()` persists the staged path once the rest of the form is
 * submitted. See the `action()` doc comment below for the full behavior.
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  ATTACHMENT_FOLDER_ID_PATTERN,
  clearStagedAssetAttachment,
  removeAssetAttachment,
  stageAssetAttachment,
  updateAssetAttachment,
} from "~/modules/asset/attachment.server";
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
 * `assetId` becomes a storage path segment, so it must be a plain id: React
 * Router decodes `%2F` inside a param, and `..` would climb out of the
 * workspace's folder.
 */
const AttachmentParamsSchema = z.object({
  assetId: z.string().regex(ATTACHMENT_FOLDER_ID_PATTERN, "Invalid asset id"),
});

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
  const { assetId } = getParams(params, AttachmentParamsSchema, {
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

    // No asset with this id means a create-form placeholder, so archived
    // assets must be found here too, or their id would be staged against.
    const existingAsset = await db.asset.findFirst({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an archived asset is still an asset, never a placeholder
      where: { id: assetId, organizationId },
      select: { id: true },
    });

    switch (method) {
      case "POST": {
        if (!existingAsset) {
          const staged = await stageAssetAttachment({
            request,
            placeholderId: assetId,
            organizationId,
          });
          return data(payload(staged));
        }
        // The response here isn't read client-side: AssetAttachmentUpload
        // has no onUploaded callback wired for an already-existing asset
        // (only the create form's not-yet-existing-asset path needs one),
        // so this relies on React Router's automatic loader revalidation
        // to pick up the new attachment instead.
        await updateAssetAttachment({ request, assetId, organizationId });
        return data(payload({ success: true }));
      }
      case "DELETE": {
        if (!existingAsset) {
          await clearStagedAssetAttachment({
            placeholderId: assetId,
            organizationId,
          });
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
