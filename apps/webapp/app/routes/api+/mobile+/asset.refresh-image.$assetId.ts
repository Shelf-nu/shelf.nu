import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl } from "~/utils/storage.server";

/**
 * GET /api/mobile/asset/refresh-image/:assetId?orgId=xxx
 *
 * Returns fresh signed URLs for an asset's main and thumbnail images. The
 * mobile client calls this lazily when it sees a near-expired
 * `mainImageExpiration` from a list/detail response, mirroring the webapp's
 * `/api/asset.refresh-main-image` pattern.
 *
 * Why a dedicated endpoint:
 * - List/detail loaders no longer fan out N updates per request, so a
 *   paginated read can't amplify into a write storm.
 * - Refreshes are explicit and awaited, so callers see fresh URLs in the
 *   response (no stale data or eventual consistency).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const { assetId } = getParams(
      params,
      z.object({ assetId: z.string().min(1) })
    );

    const asset = await db.asset.findUnique({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        mainImage: true,
        thumbnailImage: true,
        mainImageExpiration: true,
      },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    if (!asset.mainImage) {
      return data({
        asset: {
          id: asset.id,
          mainImage: null,
          thumbnailImage: null,
          mainImageExpiration: null,
        },
      });
    }

    let { mainImage, thumbnailImage } = asset;

    try {
      const mainPath = extractStoragePath(asset.mainImage, "assets");
      if (mainPath) {
        mainImage = await createSignedUrl({
          filename: mainPath,
          bucketName: "assets",
        });

        if (asset.thumbnailImage) {
          const thumbPath = extractStoragePath(asset.thumbnailImage, "assets");
          if (thumbPath) {
            thumbnailImage = await createSignedUrl({
              filename: thumbPath,
              bucketName: "assets",
            });
          }
        }

        const newExpiration = oneDayFromNow();
        await db.asset.update({
          where: { id: assetId, organizationId },
          data: {
            mainImage,
            thumbnailImage,
            mainImageExpiration: newExpiration,
          },
        });

        return data({
          asset: {
            id: asset.id,
            mainImage,
            thumbnailImage,
            mainImageExpiration: newExpiration.toISOString(),
          },
        });
      }
    } catch (err) {
      Logger.warn(`Failed to refresh image URL for asset ${assetId}: ${err}`);
    }

    return data({
      asset: {
        id: asset.id,
        mainImage,
        thumbnailImage,
        mainImageExpiration: asset.mainImageExpiration?.toISOString() ?? null,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
