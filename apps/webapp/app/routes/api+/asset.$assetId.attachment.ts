/**
 * View, upload, replace and remove endpoint for an asset's single PDF
 * attachment.
 *
 * Branches on whether the asset already exists: for an existing asset it
 * reads and writes the asset's own attachment; for one that doesn't exist yet
 * (the create form's staging flow) it only touches storage, and
 * `createAsset()` stores the staged path once the rest of the form is
 * submitted. See `loader()` and `action()` below.
 *
 * @see {@link file://./../../modules/asset/attachment.server.ts}
 */
import {
  data,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  ATTACHMENT_FOLDER_ID_PATTERN,
  clearStagedAssetAttachment,
  findStagedAttachmentPath,
  removeAssetAttachment,
  signAttachmentForViewing,
  stageAssetAttachment,
  updateAssetAttachment,
} from "~/modules/asset/attachment.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  error,
  payload,
  getActionMethod,
  getParams,
} from "~/utils/http.server";
import { assertAssetsAreNotArchived } from "~/utils/org-validation.server";
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
 * GET /api/asset/:assetId/attachment - open the attachment.
 *
 * Pages link here instead of to a signed URL. Every click checks permission
 * again and redirects to a URL signed for 60 seconds, so a copied, forwarded
 * or bookmarked link is useless to anyone who cannot open the asset, and to a
 * member who has since left the workspace.
 *
 * `assetId` is the asset's id, or the create form's placeholder id while a
 * staged file has no asset yet. Opening a staged file needs the permission
 * that staged it (`asset: update`).
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetId } = getParams(params, AttachmentParamsSchema, {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    const asset = await db.asset.findFirst({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: an archived asset's page still shows its attachment
      where: { id: assetId, organizationId },
      select: { attachmentPath: true },
    });

    let attachmentPath: string | null;
    if (asset) {
      attachmentPath = asset.attachmentPath;
    } else {
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
      });
      attachmentPath = await findStagedAttachmentPath({
        placeholderId: assetId,
        organizationId,
      });
    }

    if (!attachmentPath) {
      throw new ShelfError({
        cause: null,
        title: "No attachment",
        message: "This asset has no attachment.",
        additionalData: { assetId },
        label: "Assets",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    return redirect(await signAttachmentForViewing(attachmentPath));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetId });
    return data(error(reason), { status: reason.status });
  }
}

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

    if (existingAsset) {
      // An archived asset is read-only until it is reinstated, its
      // attachment included. Refused with the same wording as other edits.
      await assertAssetsAreNotArchived({
        assetIds: [assetId],
        organizationId,
        fix: "reinstate",
        actorUserId: userId,
      });
    }

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
