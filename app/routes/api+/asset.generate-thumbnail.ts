import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import { payload, parseData } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { createSignedUrl, uploadFile } from "~/utils/storage.server";

const THUMBNAIL_SIZE = 108;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    const { assetId } = parseData(
      url.searchParams,
      z.object({
        assetId: z.string(),
      })
    );

    // Validate user has permission to access assets in their organization
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    // Use findUnique with organization scoping to prevent cross-tenant access
    const asset = await db.asset.findUnique({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        mainImage: true,
        thumbnailImage: true,
        organizationId: true,
      },
    });

    // If asset doesn't exist, return early with error information
    if (!asset) {
      Logger.error(
        new ShelfError({
          cause: null,
          message: `Asset not found for thumbnail generation: ${assetId}`,
          additionalData: { assetId, userId },
          label: "Assets",
        })
      );

      return data(
        payload({
          asset: null,
          error: "Asset not found",
        })
      );
    }

    // If thumbnail already exists, refresh its URL
    if (asset.thumbnailImage) {
      // Extract the path from the existing thumbnail URL
      const thumbnailPath = extractStoragePath(asset.thumbnailImage, "assets");

      if (thumbnailPath) {
        try {
          // Generate a fresh signed URL
          const refreshedThumbnailUrl = await createSignedUrl({
            filename: thumbnailPath,
            bucketName: "assets",
          });

          // Update with the fresh URL
          const updatedAsset = await db.asset.update({
            where: { id: assetId },
            data: {
              thumbnailImage: refreshedThumbnailUrl,
              mainImageExpiration: oneDayFromNow(),
            },
            select: {
              id: true,
              thumbnailImage: true,
            },
          });

          return data(payload({ asset: updatedAsset }));
        } catch (error) {
          Logger.error(
            new ShelfError({
              cause: error,
              message: `Failed to refresh thumbnail URL for asset ${assetId}`,
              additionalData: { assetId, thumbnailPath, userId },
              label: "Assets",
            })
          );

          // Return the existing thumbnail rather than failing
          return data(
            payload({
              asset: {
                id: asset.id,
                thumbnailImage: asset.thumbnailImage,
              },
            })
          );
        }
      }
    }

    // If there's no main image, we can't generate a thumbnail
    if (!asset.mainImage) {
      return data(
        payload({
          asset: {
            id: asset.id,
            thumbnailImage: asset.thumbnailImage, // Will be null
          },
        })
      );
    }

    // Extract the original filename from the mainImage URL using the consistent function
    const originalPath = extractStoragePath(asset.mainImage, "assets");

    if (!originalPath) {
      // If we can't extract the path, return existing values
      return data(
        payload({
          asset: {
            id: asset.id,
            thumbnailImage: asset.thumbnailImage,
          },
        })
      );
    }

    // Download the original image from Supabase
    const { data: originalFile, error: downloadError } =
      await getSupabaseAdmin().storage.from("assets").download(originalPath);

    if (downloadError) {
      // If download fails, return existing values
      return data(
        payload({
          asset: {
            id: asset.id,
            thumbnailImage: asset.thumbnailImage,
          },
        })
      );
    }

    // Convert to AsyncIterable for the uploadFile function
    const arrayBuffer = await originalFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create an async iterable from the buffer - use a proper async generator
    async function* createAsyncIterable() {
      await Promise.resolve(); // Add await to satisfy eslint
      yield new Uint8Array(buffer);
    }

    // Generate thumbnail filename
    let thumbnailPath: string;

    // Check if the file has an extension
    if (originalPath.includes(".")) {
      // File has extension, replace before the extension
      thumbnailPath = originalPath.replace(/(\.[^.]+)$/, "-thumbnail$1");
    } else {
      // File has no extension, just append -thumbnail
      thumbnailPath = `${originalPath}-thumbnail`;
    }

    // Create and upload thumbnail
    const uploadedPath = await uploadFile(createAsyncIterable(), {
      filename: thumbnailPath,
      contentType: originalFile.type,
      bucketName: "assets",
      resizeOptions: {
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        fit: "cover",
        withoutEnlargement: true,
      },
      upsert: true,
    });

    // Create signed URL for the thumbnail
    const thumbnailSignedUrl = await createSignedUrl({
      filename:
        typeof uploadedPath === "string"
          ? uploadedPath
          : uploadedPath.originalPath,
      bucketName: "assets",
    });

    // Double-check the asset still exists before updating (in case it was deleted during processing)
    const existsCheck = await db.asset.findUnique({
      where: { id: assetId },
      select: { id: true },
    });

    if (!existsCheck) {
      Logger.error(
        new ShelfError({
          cause: null,
          message: `Asset was deleted during thumbnail generation: ${assetId}`,
          additionalData: { assetId, userId },
          label: "Assets",
        })
      );

      return data(
        payload({
          asset: null,
          error: "Asset was deleted during processing",
        })
      );
    }

    // Update the asset record with both the thumbnail and a fresh expiration
    const updatedAsset = await db.asset.update({
      where: { id: assetId },
      data: {
        thumbnailImage: thumbnailSignedUrl,
        mainImageExpiration: oneDayFromNow(),
      },
      select: {
        id: true,
        thumbnailImage: true,
      },
    });

    return data(payload({ asset: updatedAsset }));
  } catch (cause) {
    // In case of any error, try to return existing values instead of failing
    try {
      const assetId = url.searchParams.get("assetId");
      if (assetId) {
        const asset = await db.asset.findUnique({
          where: { id: assetId },
          select: {
            id: true,
            thumbnailImage: true,
          },
        });

        if (asset) {
          return data(payload({ asset }));
        }
      }
    } catch {
      // Fall through to error response
    }

    // If everything fails, log the error and return a response with error information
    const reason = new ShelfError({
      cause,
      message: "Error generating thumbnail.",
      label: "Assets",
      additionalData: {
        assetId: url.searchParams.get("assetId") || "unknown",
        userId,
      },
    });

    // Log the error for debugging
    Logger.error(reason);

    // Return a successful response with error flag
    return data(
      payload({
        asset: null,
        error: reason.message,
      })
    );
  }
}
