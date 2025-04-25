import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import { extractImageNameFromSupabaseUrl } from "~/utils/extract-image-name-from-supabase-url";
import { data, parseData } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl, uploadFile } from "~/utils/storage.server";

const THUMBNAIL_SIZE = 108;

async function generateThumbnailIfMissing(asset: {
  id: string;
  mainImage: string | null;
  thumbnailImage: string | null;
}) {
  if (asset.thumbnailImage || !asset.mainImage) {
    return asset.thumbnailImage;
  }

  try {
    // Extract the original filename from the mainImage URL
    const originalPath = extractImageNameFromSupabaseUrl({
      url: asset.mainImage,
      bucketName: "assets",
    });

    if (!originalPath) {
      Logger.error(
        new ShelfError({
          cause: null,
          message: `Could not extract image path for asset ${asset.id}`,
          additionalData: { assetId: asset.id, originalPath },
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
          cause: null,
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

    // Create and upload thumbnail
    const paths = await uploadFile(createAsyncIterable(), {
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
      filename: typeof paths === "string" ? paths : paths.originalPath,
      bucketName: "assets",
    });

    return thumbnailSignedUrl;
  } catch (error) {
    Logger.error(
      new ShelfError({
        cause: null,
        message: `Error generating thumbnail for asset ${asset.id}: ${error}`,
        additionalData: { assetId: asset.id },
        label: "Assets",
      })
    );
    return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);

  try {
    const { assetId, mainImage } = parseData(
      url.searchParams,
      z.object({
        assetId: z.string(),
        mainImage: z.string(),
      })
    );
    // Get asset details
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: assetId },
      select: {
        id: true,
        mainImage: true,
        thumbnailImage: true,
      },
    });

    // Extract the path from the URL
    const mainImagePath = extractImageNameFromSupabaseUrl({
      url: mainImage,
      bucketName: "assets",
    });

    let newMainImageUrl = asset.mainImage; // Default to existing URL

    if (mainImagePath) {
      try {
        // Try to create a new signed URL
        newMainImageUrl = await createSignedUrl({
          filename: mainImagePath,
          bucketName: "assets",
        });
      } catch (error) {
        // If it fails, keep the existing URL
        Logger.warn(
          new ShelfError({
            cause: error,
            message: `Failed to refresh main image URL for asset ${assetId}`,
            additionalData: { assetId, mainImagePath },
            label: "Assets",
          })
        );
      }
    }

    // Check if thumbnail exists and refresh it
    let thumbnailUrl = asset.thumbnailImage; // Default to existing URL

    if (asset.thumbnailImage) {
      const thumbnailPath = extractImageNameFromSupabaseUrl({
        url: asset.thumbnailImage,
        bucketName: "assets",
      });

      if (thumbnailPath) {
        try {
          thumbnailUrl = await createSignedUrl({
            filename: thumbnailPath,
            bucketName: "assets",
          });
        } catch (error) {
          Logger.warn(
            new ShelfError({
              cause: error,
              message: `Failed to refresh thumbnail URL for asset ${assetId}`,
              additionalData: { assetId, thumbnailPath },
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
    // Instead of throwing, return a successful response with error information
    const reason = new ShelfError({
      cause,
      message: "Error refreshing image.",
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
