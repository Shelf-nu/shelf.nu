import { data, type ActionFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { updateAssetMainImage } from "~/modules/asset/service.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/asset/update-image
 *
 * Updates the main image of an asset.
 * Expects multipart/form-data with:
 * - mainImage: the image file
 * - assetId: the asset ID (as a form field)
 *
 * Uses the same image processing pipeline as the webapp:
 * - Resizes to 1200px width
 * - Generates 108px thumbnail
 * - Uploads to Supabase Storage
 * - Creates signed URLs
 * - Cleans up old images
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    // Clone the request URL to extract the assetId from query params
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId");

    if (!assetId) {
      return data(
        { error: { message: "Missing assetId query parameter" } },
        { status: 400 }
      );
    }

    // Verify asset exists and belongs to the organization
    const asset = await db.asset.findUnique({
      where: { id: assetId, organizationId },
      select: { id: true, title: true },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    // Use the same image processing pipeline as the webapp.
    // updateAssetMainImage handles: parse form data, resize, thumbnail,
    // upload to storage, create signed URLs, update DB record.
    await updateAssetMainImage({
      request,
      assetId,
      userId: user.id,
      organizationId,
    });

    // Fetch the updated asset to return fresh image URLs
    const updatedAsset = await db.asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        title: true,
        mainImage: true,
        thumbnailImage: true,
      },
    });

    return data({ asset: updatedAsset });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
