import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl, uploadFile } from "~/utils/storage.server";

const THUMBNAIL_SIZE = 108;

/**
 * Extracts the storage path from a Supabase URL, handling different URL formats
 */
function extractStoragePath(url: string, bucketName: string): string | null {
  try {
    const parsedUrl = new URL(url);
    const pathname = parsedUrl.pathname;

    // Handle signed URLs (format: /storage/v1/object/sign/bucket/path?token=...)
    if (pathname.includes("/object/sign/")) {
      const signMatch = pathname.match(`/object/sign/${bucketName}/(.+)`);
      if (signMatch && signMatch[1]) {
        return signMatch[1];
      }
    }

    // Handle public URLs (format: /storage/v1/object/public/bucket/path)
    if (pathname.includes("/object/public/")) {
      const publicMatch = pathname.match(`/object/public/${bucketName}/(.+)`);
      if (publicMatch && publicMatch[1]) {
        return publicMatch[1];
      }
    }

    // Handle authenticated URLs (format: /storage/v1/object/authenticated/bucket/path)
    if (pathname.includes("/object/authenticated/")) {
      const authMatch = pathname.match(
        `/object/authenticated/${bucketName}/(.+)`
      );
      if (authMatch && authMatch[1]) {
        return authMatch[1];
      }
    }

    // Fallback: try to find bucket name anywhere in the path
    const parts = pathname.split("/");
    const bucketIndex = parts.indexOf(bucketName);
    if (bucketIndex !== -1 && bucketIndex < parts.length - 1) {
      return parts.slice(bucketIndex + 1).join("/");
    }

    return null;
  } catch (e) {
    return null;
  }
}

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

    // If thumbnail already exists, return it
    if (asset.thumbnailImage) {
      return json(
        data({
          asset: {
            id: asset.id,
            thumbnailImage: asset.thumbnailImage,
          },
        })
      );
    }

    if (!asset.mainImage) {
      // If there's no main image, we can't generate a thumbnail
      // Return success with existing values instead of throwing an error
      return json(
        data({
          asset: {
            id: asset.id,
            thumbnailImage: asset.thumbnailImage, // Will be null
          },
        })
      );
    }

    // Extract the original filename from the mainImage URL
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

    // Update the asset record
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
    // In case of any error, return existing values instead of failing
    try {
      const asset = await db.asset.findUnique({
        where: { id: (request.body as any).assetId },
        select: {
          id: true,
          thumbnailImage: true,
        },
      });

      throw json(data({ asset }));
    } catch {
      // If everything fails, return minimal error response
      const reason = new ShelfError({
        cause,
        message: "Error generating thumbnail.",
        label: "Assets",
      });

      throw json(error(reason), { status: 400 });
    }
  }
}
