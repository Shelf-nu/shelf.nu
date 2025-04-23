import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";

import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import { extractImageNameFromSupabaseUrl } from "~/utils/extract-image-name-from-supabase-url";
import { data, error, parseData } from "~/utils/http.server";
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
      console.error(`Could not extract image path for asset ${asset.id}`);
      return null;
    }

    // Download the original image from Supabase
    const { data: originalFile, error: downloadError } =
      await getSupabaseAdmin().storage.from("assets").download(originalPath);

    if (downloadError) {
      console.error(
        `Error downloading image for asset ${asset.id}:`,
        downloadError
      );
      return null;
    }

    // Convert to AsyncIterable for the uploadFile function
    const arrayBuffer = await originalFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    async function* toAsyncIterable(): AsyncIterable<Uint8Array> {
      yield new Uint8Array(buffer);
    }

    // Generate thumbnail filename
    const thumbnailPath = originalPath.replace(/(\.[^.]+)$/, "-thumbnail$1");

    // Create and upload thumbnail
    const paths = await uploadFile(toAsyncIterable(), {
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
    console.error(`Error generating thumbnail for asset ${asset.id}:`, error);
    return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { assetId, mainImage } = parseData(
      await request.formData(),
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

    // Generate new signed URL for main image
    const newMainImageUrl = await createSignedUrl({
      filename:
        extractImageNameFromSupabaseUrl({
          url: mainImage,
          bucketName: "assets",
        }) || mainImage,
      bucketName: "assets",
    });

    // Check if thumbnail exists, generate if missing
    let thumbnailUrl = null;
    if (asset.thumbnailImage) {
      // Refresh existing thumbnail URL
      const thumbnailPath = extractImageNameFromSupabaseUrl({
        url: asset.thumbnailImage,
        bucketName: "assets",
      });

      if (thumbnailPath) {
        thumbnailUrl = await createSignedUrl({
          filename: thumbnailPath,
          bucketName: "assets",
        });
      }
    } else {
      // Generate thumbnail if missing
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
    const reason = new ShelfError({
      cause,
      message: "Error refreshing image.",
      label: "Assets",
    });

    return json(error(reason), { status: 400 });
  }
}
