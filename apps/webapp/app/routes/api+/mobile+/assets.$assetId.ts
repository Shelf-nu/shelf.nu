import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl } from "~/utils/storage.server";

/**
 * GET /api/mobile/assets/:assetId
 *
 * Returns full asset details including category, location, custody, and kit.
 * Automatically refreshes expired signed image URLs.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const { assetId } = getParams(params, z.object({ assetId: z.string() }));

    const asset = await db.asset.findUnique({
      where: {
        id: assetId,
      },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        mainImage: true,
        mainImageExpiration: true,
        thumbnailImage: true,
        availableToBook: true,
        valuation: true,
        createdAt: true,
        updatedAt: true,
        organizationId: true,
        userId: true,
        category: { select: { id: true, name: true, color: true } },
        location: { select: { id: true, name: true } },
        custody: {
          select: {
            createdAt: true,
            custodian: {
              select: {
                id: true,
                name: true,
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    email: true,
                    profilePicture: true,
                  },
                },
              },
            },
          },
        },
        kit: { select: { id: true, name: true, status: true } },
        tags: { select: { id: true, name: true } },
        qrCodes: { select: { id: true } },
        organization: { select: { currency: true } },
        notes: {
          select: {
            id: true,
            content: true,
            type: true,
            createdAt: true,
            user: {
              select: { firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: "desc" as const },
          take: 25,
        },
        customFields: {
          select: {
            id: true,
            value: true,
            customField: {
              select: {
                id: true,
                name: true,
                type: true,
                helpText: true,
                active: true,
              },
            },
          },
        },
      },
    });

    if (!asset) {
      return data({ error: { message: "Asset not found" } }, { status: 404 });
    }

    // Verify user has access to the asset's organization
    const membership = await db.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: asset.organizationId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      return data({ error: { message: "Access denied" } }, { status: 403 });
    }

    // Refresh signed image URLs if expired (or expiring within 1 hour)
    let { mainImage, thumbnailImage } = asset;
    const needsRefresh =
      asset.mainImage &&
      (!asset.mainImageExpiration ||
        new Date(asset.mainImageExpiration).getTime() <
          Date.now() + 60 * 60 * 1000);

    if (needsRefresh && asset.mainImage) {
      try {
        const mainPath = extractStoragePath(asset.mainImage, "assets");
        if (mainPath) {
          mainImage = await createSignedUrl({
            filename: mainPath,
            bucketName: "assets",
          });

          // Also refresh thumbnail if present
          if (asset.thumbnailImage) {
            const thumbPath = extractStoragePath(
              asset.thumbnailImage,
              "assets"
            );
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
              where: { id: assetId },
              data: {
                mainImage,
                thumbnailImage,
                mainImageExpiration: oneDayFromNow(),
              },
            })
            .catch((err) => {
              Logger.error(
                new Error(
                  `Failed to update refreshed image URLs for asset ${assetId}: ${err}`
                )
              );
            });
        }
      } catch (err) {
        // If refresh fails, return the existing (possibly expired) URLs
        Logger.warn(
          `Failed to refresh image URLs for asset ${assetId}: ${err}`
        );
      }
    }

    // Strip internal fields before returning
    const { mainImageExpiration: _, userId: __, ...assetData } = asset;

    return data({
      asset: { ...assetData, mainImage, thumbnailImage },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
