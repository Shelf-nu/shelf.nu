import { composeUploadHandlers, parseMultipartFormData } from "react-router";
import type { LRUCache } from "lru-cache";
import type { ResizeOptions } from "sharp";

import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { ASSET_MAX_IMAGE_UPLOAD_SIZE, PUBLIC_BUCKET } from "./constants";
import { cropImage } from "./crop-image";
import { SUPABASE_URL } from "./env";
import type { AdditionalData, ErrorLabel } from "./error";
import { isLikeShelfError, ShelfError } from "./error";
import { extractImageNameFromSupabaseUrl } from "./extract-image-name-from-supabase-url";
import { id } from "./id/id.server";
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
    upsert = false,
  }: UploadOptions & {
    generateThumbnail?: boolean;
    thumbnailSize?: number;
    upsert?: boolean;
  }
): Promise<string | { originalPath: string; thumbnailPath: string }> {
  try {
    // Process original image
    const file = await cropImage(fileData, resizeOptions);

    // Upload original file
    const { data, error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .upload(filename, file, { contentType, upsert });

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
  upsert?: boolean;
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
    const uploadHandler = composeUploadHandlers(
      async ({ contentType, data, filename }) => {
        if (!contentType?.includes("image")) {
          return undefined;
        }

        // const fileSize = await calculateAsyncIterableSize(data);
        // if (fileSize > ASSET_MAX_IMAGE_UPLOAD_SIZE) {
        //   throw new ShelfError({
        //     cause: null,
        //     title: "File too large",
        //     message: `Image file size exceeds maximum allowed size of ${
        //       ASSET_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)
        //     }MB`,
        //     additionalData: { filename, contentType, bucketName },
        //     label,
        //     shouldBeCaptured: false,
        //   });
        // }

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

    const formData = await parseMultipartFormData(request, uploadHandler);

    return formData;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while uploading the file. Please try again or contact support.",
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
 * Detects image format from file content using magic bytes (file signatures)
 * Returns the detected MIME type or null if not a supported image format
 */
function detectImageFormat(buffer: Buffer): string | null {
  // Check for common image format signatures
  if (buffer.length < 4) return null;

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: 47 49 46 38 (GIF8)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return "image/gif";
  }

  // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  // BMP: 42 4D
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }

  return null;
}

/**
 * Downloads and processes an image from a URL for upload
 * Implements caching of Supabase-optimized versions for repeated URLs
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  { filename, contentType, bucketName, resizeOptions }: UploadOptions,
  cache?: LRUCache<string, CachedImage>
): Promise<string | null> {
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

    // If not in cache, download the image with retry logic
    let response: Response | null = null;
    let fetchError: Error | null = null;

    // Try to fetch the image up to 2 times
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await fetch(imageUrl);

        if (response.ok) {
          fetchError = null;
          break; // Success, exit retry loop
        } else {
          fetchError = new Error(
            `HTTP ${response.status}: ${response.statusText}`
          );
          if (attempt === 2) {
            // Last attempt failed, log and return null
            Logger.error(
              new ShelfError({
                cause: fetchError,
                message: "Failed to fetch image from URL after 2 attempts",
                additionalData: {
                  imageUrl,
                  status: response.status,
                  attempts: 2,
                },
                label,
                shouldBeCaptured: false,
              })
            );
            return null;
          }
          // Wait a moment before retrying
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (cause) {
        fetchError = cause as Error;
        if (attempt === 2) {
          // Last attempt failed, log and return null
          Logger.error(
            new ShelfError({
              cause: fetchError,
              message: "Failed to fetch image from URL after 2 attempts",
              additionalData: {
                imageUrl,
                attempts: 2,
              },
              label,
              shouldBeCaptured: false,
            })
          );
          return null;
        }
        // Wait a moment before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // This should not happen due to the early returns above, but TypeScript needs the check
    if (!response) {
      Logger.error(
        new ShelfError({
          cause: null,
          message: "Unexpected null response after retry loop",
          additionalData: { imageUrl },
          label,
          shouldBeCaptured: false,
        })
      );
      return null;
    }

    actualContentType = response.headers.get("content-type") || contentType;

    // Get the response as a buffer to validate the actual content
    const imageBlob = await response.blob();
    buffer = Buffer.from(await imageBlob.arrayBuffer());

    // For URLs that don't return proper image content-type headers (like Sortly),
    // detect the image format from the actual file content using magic bytes
    const detectedImageType = detectImageFormat(buffer);

    if (!actualContentType?.startsWith("image/") && !detectedImageType) {
      throw new ShelfError({
        cause: null,
        message: "URL does not point to a valid image",
        additionalData: { imageUrl, contentType: actualContentType },
        label,
        shouldBeCaptured: false,
      });
    }

    // Use detected format if HTTP header doesn't provide proper image content-type
    if (detectedImageType && !actualContentType?.startsWith("image/")) {
      actualContentType = detectedImageType;
    }

    if (imageBlob.size > ASSET_MAX_IMAGE_UPLOAD_SIZE) {
      throw new ShelfError({
        cause: null,
        message: `Image file size exceeds maximum allowed size of ${
          ASSET_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)
        }MB`,
        additionalData: { imageUrl, size: imageBlob.size },
        label,
        shouldBeCaptured: false,
      });
    }

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

    // Log the error and return null instead of throwing
    // This allows the import process to continue without the image
    Logger.error(
      new ShelfError({
        cause,
        message: isShelfError
          ? cause.message
          : "Failed to process and upload image from URL",
        additionalData: { imageUrl, filename, contentType, bucketName },
        label,
        shouldBeCaptured: isShelfError ? cause.shouldBeCaptured : true,
      })
    );

    return null; // Return null to indicate failure, allowing import to continue
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
}: {
  organizationId: string;
  type: "locations";
  typeId: string;
}) {
  return `${organizationId}/${type}/${typeId}/${id()}`;
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

// Utility function to get size from AsyncIterable<Uint8Array>
export async function calculateAsyncIterableSize(
  data: AsyncIterable<Uint8Array>
): Promise<number> {
  let totalSize = 0;
  for await (const chunk of data) {
    totalSize += chunk.byteLength;
  }
  return totalSize;
}
