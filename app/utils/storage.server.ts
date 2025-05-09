import {
  unstable_composeUploadHandlers,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type { LRUCache } from "lru-cache";
import type { ResizeOptions } from "sharp";

import { v4 as uuid } from "uuid";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { MAX_IMAGE_UPLOAD_SIZE, PUBLIC_BUCKET } from "./constants";
import { cropImage } from "./crop-image";
import { SUPABASE_URL } from "./env";
import type { AdditionalData, ErrorLabel } from "./error";
import { isLikeShelfError, ShelfError } from "./error";
import { extractImageNameFromSupabaseUrl } from "./extract-image-name-from-supabase-url";
import {
  cacheOptimizedImage,
  type CachedImage,
} from "./import.image-cache.server";
import { Logger } from "./logger";

const label: ErrorLabel = "File storage";

export function getPublicFileURL({
  filename,
  bucketName = "profile-pictures",
}: {
  filename: string;
  bucketName?: string;
}) {
  try {
    const { data } = getSupabaseAdmin()
      .storage.from(bucketName)
      .getPublicUrl(filename);

    return data.publicUrl;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get public file URL",
      additionalData: { filename, bucketName },
      label,
    });
  }
}

export async function createSignedUrl({
  filename,
  bucketName = "assets",
}: {
  filename: string;
  bucketName?: string;
}) {
  try {
    // Check if there is a leading slash and we need to remove it as signing will not work with the slash included
    if (filename.startsWith("/")) {
      filename = filename.substring(1); // Remove the first character
    }

    const { data, error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .createSignedUrl(filename, 24 * 60 * 60); //24h

    if (error) {
      throw error;
    }

    return data.signedUrl;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a signed URL. Please try again. If the issue persists contact support.",
      additionalData: { filename, bucketName },
      label,
    });
  }
}

export async function uploadFile(
  fileData: AsyncIterable<Uint8Array>,
  {
    filename,
    contentType,
    bucketName,
    resizeOptions,
    generateThumbnail = false,
    thumbnailSize = 108, // Default thumbnail size
  }: UploadOptions & {
    generateThumbnail?: boolean;
    thumbnailSize?: number;
  }
): Promise<string | { originalPath: string; thumbnailPath: string }> {
  try {
    // Process original image
    const file = await cropImage(fileData, resizeOptions);

    // Upload original file
    const { data, error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .upload(filename, file, { contentType, upsert: true });

    if (error) {
      throw error;
    }

    // If thumbnail generation is requested
    if (generateThumbnail) {
      // Generate a thumbnail filename
      let thumbFilename: string;

      // Check if the file has an extension
      if (filename.includes(".")) {
        // File has extension, add '-thumbnail' before the extension
        thumbFilename = filename.replace(/(\.[^.]+)$/, "-thumbnail$1");
      } else {
        // File has no extension, just append '-thumbnail'
        thumbFilename = `${filename}-thumbnail`;
      }

      // Create thumbnail version with Sharp
      const thumbnailFile = await cropImage(
        // Convert Buffer back to AsyncIterable for consistency
        (async function* () {
          await Promise.resolve(); // Satisfy eslint requirement
          yield new Uint8Array(file);
        })(),
        {
          width: thumbnailSize,
          height: thumbnailSize,
          fit: "cover",
          withoutEnlargement: true,
        }
      );

      // Upload thumbnail
      const { data: thumbData, error: thumbError } = await getSupabaseAdmin()
        .storage.from(bucketName)
        .upload(thumbFilename, thumbnailFile, { contentType, upsert: true });

      if (thumbError) {
        throw thumbError;
      }

      return {
        originalPath: data.path,
        thumbnailPath: thumbData.path,
      };
    }

    // Return just the path string for backward compatibility
    return data.path;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while uploading the file. Please try again or contact support.",
      additionalData: { filename, contentType, bucketName },
      label,
    });
  }
}

export interface UploadOptions {
  bucketName: string;
  filename: string;
  contentType: string;
  resizeOptions?: ResizeOptions;
}

export async function parseFileFormData({
  request,
  newFileName,
  bucketName = "profile-pictures",
  resizeOptions,
  generateThumbnail = false,
  thumbnailSize = 108,
}: {
  request: Request;
  newFileName: string;
  bucketName?: string;
  resizeOptions?: ResizeOptions;
  generateThumbnail?: boolean;
  thumbnailSize?: number;
}) {
  try {
    const uploadHandler = unstable_composeUploadHandlers(
      async ({ contentType, data, filename }) => {
        if (!contentType?.includes("image")) {
          return undefined;
        }

        const fileExtension = filename?.split(".").pop();
        const uploadedFilePaths = await uploadFile(data, {
          filename: `${newFileName}.${fileExtension}`,
          contentType,
          bucketName,
          resizeOptions,
          generateThumbnail,
          thumbnailSize,
        });

        // For profile pictures and other cases that don't need thumbnails,
        // the uploadFile function returns a string path
        if (typeof uploadedFilePaths === "string") {
          return uploadedFilePaths;
        }

        // For cases where thumbnails are generated, we need to store the object
        // in a way that FormData can handle. We'll store it as a stringified JSON
        if (generateThumbnail) {
          return JSON.stringify(uploadedFilePaths);
        }

        // This shouldn't happen, but if it does, return the originalPath
        return (uploadedFilePaths as { originalPath: string }).originalPath;
      }
    );

    const formData = await unstable_parseMultipartFormData(
      request,
      uploadHandler
    );

    return formData;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while uploading the file. Please try again or contact support.",
      label,
    });
  }
}

/**
 * Logs an error that occurred during image upload to Supoabase
 * @param cause
 * @param additionalData
 */
function logUploadError(cause: unknown, additionalData: AdditionalData) {
  Logger.error(
    new ShelfError({
      cause,
      message: "Failed to upload image",
      additionalData,
      label,
    })
  );
}

/**
 * Downloads and processes an image from a URL for upload
 * Implements caching of Supabase-optimized versions for repeated URLs
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  { filename, contentType, bucketName, resizeOptions }: UploadOptions,
  cache?: LRUCache<string, CachedImage>
) {
  try {
    let buffer: Buffer;
    let actualContentType: string;

    // Check cache first if provided
    if (cache) {
      const cached = cache.get(imageUrl);
      if (cached) {
        buffer = cached.buffer;
        actualContentType = cached.contentType;

        // Upload cached optimized version
        const { data, error } = await getSupabaseAdmin()
          .storage.from(bucketName)
          .upload(filename, buffer, {
            contentType: actualContentType,
            upsert: true,
            metadata: {
              source: "url",
              originalUrl: imageUrl,
            },
          });

        if (error) {
          /** Log the error so we are aware if there are some issues with uploading */
          logUploadError(error, {
            imageUrl,
            filename,
            contentType,
            bucketName,
          });

          throw error;
        }
        return data.path;
      }
    }

    // If not in cache, download the image
    const response = await fetch(imageUrl).catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to fetch image from URL",
        additionalData: { imageUrl },
        label,
        shouldBeCaptured: false,
      });
    });

    if (!response.ok) {
      throw new ShelfError({
        cause: null,
        message: "Failed to fetch image from URL",
        shouldBeCaptured: false,
        additionalData: { imageUrl, status: response.status },
        label,
      });
    }

    actualContentType = response.headers.get("content-type") || contentType;
    if (!actualContentType?.startsWith("image/")) {
      throw new ShelfError({
        cause: null,
        message: "URL does not point to a valid image",
        additionalData: { imageUrl, contentType: actualContentType },
        label,
        shouldBeCaptured: false,
      });
    }

    const imageBlob = await response.blob();
    if (imageBlob.size > MAX_IMAGE_UPLOAD_SIZE) {
      throw new ShelfError({
        cause: null,
        message: `Image file size exceeds maximum allowed size of ${
          MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)
        }MB`,
        additionalData: { imageUrl, size: imageBlob.size },
        label,
        shouldBeCaptured: false,
      });
    }

    const arrayBuffer = await imageBlob.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);

    async function* toAsyncIterable(): AsyncIterable<Uint8Array> {
      await Promise.resolve();
      yield new Uint8Array(buffer);
    }

    const file = await cropImage(toAsyncIterable(), resizeOptions);

    // Upload to Supabase
    const { data, error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .upload(filename, file, {
        contentType: actualContentType,
        upsert: true,
        metadata: {
          source: "url",
          originalUrl: imageUrl,
        },
      });

    if (error) {
      /** Log the error so we are aware if there are some issues with uploading */
      logUploadError(error, {
        imageUrl,
        filename,
        contentType,
        bucketName,
      });
      throw error;
    }

    // After successful upload, cache the optimized version if cache is provided
    if (cache && data.path) {
      await cacheOptimizedImage(data.path, imageUrl, cache);
    }

    return data.path;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Failed to process and upload image from URL",
      additionalData: { imageUrl, filename, contentType, bucketName },
      label,
      shouldBeCaptured: isShelfError ? cause.shouldBeCaptured : true,
    });
  }
}

export async function deleteProfilePicture({
  url,
  bucketName = "profile-pictures",
}: {
  url: string;
  bucketName?: string;
}) {
  try {
    if (
      !url.startsWith(
        `${SUPABASE_URL}/storage/v1/object/public/profile-pictures/`
      ) ||
      url === ""
    ) {
      throw new ShelfError({
        cause: null,
        message: "Invalid file URL",
        additionalData: { url },
        label,
      });
    }

    const { error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .remove([url.split(`${bucketName}/`)[1]]);

    if (error) {
      throw error;
    }
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Fail to delete the profile picture",
        additionalData: { url, bucketName },
        label,
      })
    );
  }
}

export async function deleteAssetImage({
  url,
  bucketName,
}: {
  url: string;
  bucketName: string;
}) {
  try {
    const path = extractImageNameFromSupabaseUrl({ url, bucketName });
    if (!path) {
      throw new ShelfError({
        cause: null,
        message: "Cannot extract the image path from the URL",
        additionalData: { url, bucketName },
        label,
      });
    }

    const { error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .remove([path]);

    if (error) {
      throw error;
    }

    return true;
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Fail to delete the asset image",
        additionalData: { url, bucketName },
        label,
      })
    );
  }
}

/**
 * This function constructs the path for the file to be uploaded to Supabase storage.
 */
export function getFileUploadPath({
  organizationId,
  type,
  typeId,
  extension,
}: {
  organizationId: string;
  type: "locations";
  typeId: string;
  extension: string;
}) {
  return `${organizationId}/${type}/${typeId}/${uuid()}.${extension}`;
}

/**
 * This function uploads the file to `files` bucket in Supabase.
 * `files` bucket is public and can be accessed by anyone.
 * After uploading the file, it returns the public URL of the file.
 */
export async function uploadPublicFile({
  fileData,
  path,
}: {
  fileData: ArrayBuffer;
  /*
   * The path to upload file
   * Format: `organizationId/type/typeId/fileName`
   */
  path: string;
}) {
  try {
    const { data, error } = await getSupabaseAdmin()
      .storage.from(PUBLIC_BUCKET)
      .upload(path, fileData);

    if (error) {
      throw error;
    }

    const {
      data: { publicUrl },
    } = getSupabaseAdmin().storage.from(PUBLIC_BUCKET).getPublicUrl(data.path);

    return publicUrl;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while uploading the file. Please try again.",
      label,
    });
  }
}

/**
 * This function remove the public file from `files` bucket in Supabase using a public URL.
 */
export async function removePublicFile({ publicUrl }: { publicUrl: string }) {
  try {
    if (
      !publicUrl.startsWith(
        `${SUPABASE_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/`
      )
    ) {
      throw new ShelfError({
        cause: null,
        message: "Invalid file URL",
        additionalData: { publicUrl },
        label,
      });
    }

    const { error } = await getSupabaseAdmin()
      .storage.from(PUBLIC_BUCKET)
      .remove([publicUrl.split(`${PUBLIC_BUCKET}/`)[1]]);

    if (error) {
      throw error;
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Failed to remove file. Please try again.",
      label,
    });
  }
}
