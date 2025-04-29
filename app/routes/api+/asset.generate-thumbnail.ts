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
import { createSignedUrl, uploadFile } from "~/utils/storage.server";

const THUMBNAIL_SIZE = 108;

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  try {
    const { assetId } = parseData(
      url.searchParams,
      z.object({
        assetId: z.string(),
      })
    );

    // Get asset with mainImage
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: assetId },
      select: {
        id: true,
        mainImage: true,
        thumbnailImage: true,
        organizationId: true,
      },
    });

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

          return json(data({ asset: updatedAsset }));
        } catch (error) {
          Logger.warn(
            new ShelfError({
              cause: error,
              message: `Failed to refresh thumbnail URL for asset ${assetId}`,
              additionalData: { assetId, thumbnailPath },
              label: "Assets",
            })
          );

          // Return the existing thumbnail rather than failing
          return json(
            data({
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
      return json(
        data({
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
      return json(
        data({
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
      return json(
        data({
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
    });

    // Create signed URL for the thumbnail
    const thumbnailSignedUrl = await createSignedUrl({
      filename:
        typeof uploadedPath === "string"
          ? uploadedPath
          : uploadedPath.originalPath,
      bucketName: "assets",
    });

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

    return json(data({ asset: updatedAsset }));
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
          return json(data({ asset }));
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
    });

    // Log the error for debugging
    Logger.error(reason);

    // Return a successful response with error flag
    return json(
      data({
        asset: null,
        error: reason.message,
      })
    );
  }
}
