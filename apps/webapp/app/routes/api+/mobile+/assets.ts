import { data, type LoaderFunctionArgs } from "react-router";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl } from "~/utils/storage.server";

/**
 * GET /api/mobile/assets?orgId=xxx&search=xxx&page=1&perPage=20&myCustody=true&status=IN_CUSTODY
 *
 * Returns paginated assets for the given organization.
 * Optional filters:
 *   - myCustody=true  → only assets in the current user's custody
 *   - status=X         → filter by asset status (e.g. AVAILABLE, IN_CUSTODY, CHECKED_OUT)
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);

    // Validate and sanitize search input
    const rawSearch = url.searchParams.get("search") || "";
    const search = rawSearch.slice(0, 100);

    // Parse pagination with NaN guards
    const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
    const page = Number.isNaN(rawPage) ? 1 : Math.max(1, rawPage);

    const rawPerPage = parseInt(url.searchParams.get("perPage") || "20", 10);
    const perPage = Number.isNaN(rawPerPage)
      ? 20
      : Math.min(50, Math.max(1, rawPerPage));

    const skip = (page - 1) * perPage;

    // Optional filters
    const myCustody = url.searchParams.get("myCustody") === "true";
    const statusFilter = url.searchParams.get("status");

    const where: Record<string, unknown> = {
      organizationId,
      ...(search
        ? {
            title: { contains: search, mode: "insensitive" as const },
          }
        : {}),
      ...(myCustody
        ? {
            custody: {
              custodian: {
                userId: user.id,
              },
            },
          }
        : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    const [assets, totalCount] = await Promise.all([
      db.asset.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          mainImage: true,
          mainImageExpiration: true,
          thumbnailImage: true,
          category: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          custody: {
            select: {
              custodian: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: perPage,
      }),
      db.asset.count({ where }),
    ]);

    // Refresh expired signed image URLs in batch (same pattern as
    // the webapp asset-image component, but done server-side for mobile)
    const oneHourFromNow = Date.now() + 60 * 60 * 1000;
    const refreshedAssets = await Promise.all(
      assets.map(async (asset) => {
        const { mainImageExpiration, ...rest } = asset;
        let { mainImage, thumbnailImage } = rest;

        const needsRefresh =
          mainImage &&
          (!mainImageExpiration ||
            new Date(mainImageExpiration).getTime() < oneHourFromNow);

        if (needsRefresh && mainImage) {
          try {
            const mainPath = extractStoragePath(mainImage, "assets");
            if (mainPath) {
              mainImage = await createSignedUrl({
                filename: mainPath,
                bucketName: "assets",
              });

              if (thumbnailImage) {
                const thumbPath = extractStoragePath(thumbnailImage, "assets");
                if (thumbPath) {
                  thumbnailImage = await createSignedUrl({
                    filename: thumbPath,
                    bucketName: "assets",
                  });
                }
              }

              // Update DB with fresh URLs (fire and forget)
              db.asset
                .update({
                  where: { id: asset.id },
                  data: {
                    mainImage,
                    thumbnailImage,
                    mainImageExpiration: oneDayFromNow(),
                  },
                })
                .catch((err) => {
                  Logger.error(
                    new Error(
                      `Failed to update refreshed image URLs for asset ${asset.id}: ${err}`
                    )
                  );
                });
            }
          } catch (err) {
            // If refresh fails, return existing (possibly expired) URLs
            Logger.warn(
              `Failed to refresh image URL for asset ${asset.id}: ${err}`
            );
          }
        }

        return { ...rest, mainImage, thumbnailImage };
      })
    );

    return data({
      assets: refreshedAssets,
      page,
      perPage,
      totalCount,
      totalPages: Math.ceil(totalCount / perPage),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
