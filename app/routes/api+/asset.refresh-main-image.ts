import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import { data, parseData } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { createSignedUrl, uploadFile } from "~/utils/storage.server";

const THUMBNAIL_SIZE = 108;

/**
 * Generates a thumbnail for an asset if missing, with proper handling for existing files
 */
async function generateThumbnailIfMissing(asset: {
  id: string;
  mainImage: string | null;
  thumbnailImage: string | null;
  userId: string;
}): Promise<string | null> {
  if (asset.thumbnailImage || !asset.mainImage) {
    return asset.thumbnailImage;
  }

  try {
    // Extract the original filename from the mainImage URL using the consistent function
    const originalPath = extractStoragePath(asset.mainImage, "assets");

    if (!originalPath) {
      Logger.error(
        new ShelfError({
          cause: null,
          message: `Could not extract image path for asset ${asset.id}`,
          additionalData: { assetId: asset.id, imagePath: asset.mainImage },
          label: "Assets",
        })
      );
      return null;
    }

    // Download the original image from Supabase
    const { data: originalFile, error: downloadError } =
      await getSupabaseAdmin().storage.from("assets").download(originalPath);

    if (downloadError) {
      Logger.error(
        new ShelfError({
          cause: downloadError,
          message: `Error downloading image for asset ${asset.id}: ${downloadError.message}`,
          additionalData: { assetId: asset.id, originalPath },
          label: "Assets",
        })
      );

      return null;
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

    // Try to upload thumbnail, but handle the case where it already exists
    let uploadResult: string | { originalPath: string; thumbnailPath: string };

    try {
      // Create and upload thumbnail
      uploadResult = await uploadFile(createAsyncIterable(), {
        filename: thumbnailPath,
        contentType: originalFile.type,
        bucketName: "assets",
        resizeOptions: {
          width: THUMBNAIL_SIZE,
          height: THUMBNAIL_SIZE,
          fit: "cover",
          withoutEnlargement: true,
        },
      });
    } catch (uploadError: any) {
      // Check if it's a duplicate error (file already exists)
      if (
        uploadError?.cause?.statusCode === "409" ||
        uploadError?.cause?.error === "Duplicate" ||
        (uploadError?.message && uploadError.message.includes("already exists"))
      ) {
        // File already exists in storage, so we can just create a signed URL for it
        Logger.info(
          `Thumbnail already exists for asset ${asset.id}, creating signed URL for existing file`,
          { assetId: asset.id, thumbnailPath }
        );

        // Create signed URL for the existing thumbnail
        const thumbnailSignedUrl = await createSignedUrl({
          filename: thumbnailPath,
          bucketName: "assets",
        });

        return thumbnailSignedUrl;
      }

      // If it's a different error, re-throw it
      throw uploadError;
    }

    // Create signed URL for the thumbnail
    const thumbnailSignedUrl = await createSignedUrl({
      filename:
        typeof uploadResult === "string"
          ? uploadResult
          : uploadResult.originalPath,
      bucketName: "assets",
    });

    return thumbnailSignedUrl;
  } catch (error) {
    Logger.error(
      new ShelfError({
        cause: error,
        message: `Error generating thumbnail for asset ${asset.id}`,
        additionalData: { assetId: asset.id, userId: asset.userId },
        label: "Assets",
      })
    );
    return null;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const authSesssion = context.getSession();
  const { userId } = authSesssion;

  try {
    const { assetId, mainImage } = parseData(
      url.searchParams,
      z.object({
        assetId: z.string(),
        mainImage: z.string(),
      })
    );

    // Validate user has permission to access assets in their organization
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.read,
    });

    // Get asset details with organization scoping to prevent cross-tenant access
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        mainImage: true,
        thumbnailImage: true,
      },
    });

    // Extract the path from the URL using the consistent function
    const mainImagePath = extractStoragePath(mainImage, "assets");

    let newMainImageUrl = asset.mainImage; // Default to existing URL

    if (mainImagePath) {
      try {
        // Try to create a new signed URL
        newMainImageUrl = await createSignedUrl({
          filename: mainImagePath,
          bucketName: "assets",
        });
      } catch (error) {
        // If it fails, log the error and keep the existing URL
        Logger.error(
          new ShelfError({
            cause: error,
            message: `Failed to refresh main image URL for asset ${assetId}`,
            additionalData: { assetId, mainImagePath, userId },
            label: "Assets",
          })
        );
      }
    }

    // Check if thumbnail exists and refresh it
    let thumbnailUrl = asset.thumbnailImage; // Default to existing URL

    if (asset.thumbnailImage) {
      const thumbnailPath = extractStoragePath(asset.thumbnailImage, "assets");

      if (thumbnailPath) {
        try {
          thumbnailUrl = await createSignedUrl({
            filename: thumbnailPath,
            bucketName: "assets",
          });
        } catch (error) {
          Logger.error(
            new ShelfError({
              cause: error,
              message: `Failed to refresh thumbnail URL for asset ${assetId}`,
              additionalData: { assetId, thumbnailPath, userId },
              label: "Assets",
            })
          );
        }
      }
    } else if (asset.mainImage && !asset.thumbnailImage) {
      // If we have a main image but no thumbnail, try to generate one
      thumbnailUrl = await generateThumbnailIfMissing({
        id: asset.id,
        mainImage: asset.mainImage,
        thumbnailImage: asset.thumbnailImage,
        userId,
      });
    }

    // Update the asset with new signed URLs and expiration date
    const updatedAsset = await db.asset.update({
      where: { id: assetId },
      data: {
        mainImage: newMainImageUrl,
        thumbnailImage: thumbnailUrl,
        mainImageExpiration: oneDayFromNow(),
      },
      select: {
        id: true,
        mainImage: true,
        thumbnailImage: true,
      },
    });

    return json(data({ asset: updatedAsset }));
  } catch (cause) {
    // Log the error for debugging
    Logger.error(
      new ShelfError({
        cause,
        message: "Error refreshing image.",
        label: "Assets",
        additionalData: {
          userId,
          assetId: url.searchParams.get("assetId"),
          mainImage: url.searchParams.get("mainImage"),
        },
      })
    );

    // Return a successful response with error flag
    return json(
      data({
        asset: null,
        error: "Error refreshing image.",
      })
    );
  }
}
