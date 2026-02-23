import { Readable } from "node:stream";

import {
  MaxFileSizeExceededError,
  parseFormData,
} from "@remix-run/form-data-parser";
import type { LRUCache } from "lru-cache";
import type { ResizeOptions } from "sharp";

import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  ASSET_MAX_IMAGE_UPLOAD_SIZE,
  DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
  PUBLIC_BUCKET,
} from "./constants";
import { cropImage } from "./crop-image";
import { delay } from "./delay";
import { SUPABASE_URL } from "./env";
import type { AdditionalData, ErrorLabel } from "./error";
import { isLikeShelfError, ShelfError } from "./error";
import { extractImageNameFromSupabaseUrl } from "./extract-image-name-from-supabase-url";
import { id } from "./id/id.server";
import { detectImageFormat } from "./image-format.server";
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
}): Promise<string> {
  const normalizedFilename = filename.startsWith("/")
    ? filename.substring(1)
    : filename;
  const maxAttempts = 2;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { data, error } = await getSupabaseAdmin()
        .storage.from(bucketName)
        .createSignedUrl(normalizedFilename, 24 * 60 * 60); //24h

      if (!error) {
        const signedUrl = data?.signedUrl;
        if (!signedUrl) {
          throw new ShelfError({
            cause: null,
            message: "Supabase did not return a signed URL",
            additionalData: { filename: normalizedFilename, bucketName },
            label,
          });
        }
        return signedUrl;
      }

      // Supabase occasionally responds with HTML on 50x/edge errors, which the client surfaces
      // as StorageUnknownError with a JSON parse failure. Retry once before surfacing it to keep
      // transient CDN hiccups from bubbling up as user-facing ShelfErrors.
      const isHtmlError = isSupabaseHtmlError(error);
      const isFetchFailed = isSupabaseFetchFailedError(error);

      if (isHtmlError || isFetchFailed) {
        if (attempt < maxAttempts) {
          Logger.warn(
            new ShelfError({
              cause: error,
              message: isHtmlError
                ? "Supabase returned a non-JSON response while creating a signed URL. Retrying."
                : "Supabase request failed while creating a signed URL. Retrying.",
              additionalData: {
                filename: normalizedFilename,
                bucketName,
                attempt,
              },
              label,
              shouldBeCaptured: false,
            })
          );
          await delay(1000);
          continue;
        }

        // All retry attempts exhausted with HTML errors - this is a transient
        // infrastructure issue that shouldn't spam Sentry
        throw new ShelfError({
          cause: error,
          message:
            "Supabase is experiencing temporary issues. Using existing URL.",
          additionalData: {
            filename: normalizedFilename,
            bucketName,
            attempts: maxAttempts,
            errorType: isHtmlError
              ? "persistent_html_error"
              : "persistent_fetch_failed",
          },
          label,
          shouldBeCaptured: false,
        });
      }

      throw error;
    }

    // The loop should always return or throw, but ensure we never fall through.
    throw new ShelfError({
      cause: null,
      message: "Unable to create signed URL after retries.",
      additionalData: { filename: normalizedFilename, bucketName },
      label,
    });
  } catch (cause) {
    // If it's already a ShelfError, preserve it (including shouldBeCaptured flag)
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a signed URL. Please try again. If the issue persists contact support.",
      additionalData: {
        filename: normalizedFilename,
        bucketName,
        errorName:
          typeof cause === "object" &&
          cause !== null &&
          "name" in cause &&
          typeof (cause as { name?: unknown }).name === "string"
            ? (cause as { name: string }).name
            : undefined,
        errorMessage:
          typeof cause === "object" &&
          cause !== null &&
          "message" in cause &&
          typeof (cause as { message?: unknown }).message === "string"
            ? (cause as { message: string }).message
            : undefined,
      },
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
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while uploading the file. Please try again or contact support.",
      additionalData: { filename, contentType, bucketName },
      label,
      shouldBeCaptured: isLikeShelfError(cause)
        ? cause.shouldBeCaptured
        : undefined,
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
  maxFileSize = DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
}: {
  request: Request;
  newFileName: string;
  bucketName?: string;
  resizeOptions?: ResizeOptions;
  generateThumbnail?: boolean;
  thumbnailSize?: number;
  maxFileSize?: number;
}) {
  try {
    const uploadHandler = async (upload: any) => {
      const file = upload?.file ?? upload;
      const mimeType =
        upload?.type ?? upload?.contentType ?? file?.type ?? undefined;
      const originalName =
        upload?.name ?? upload?.filename ?? file?.name ?? undefined;

      // Only process image files
      if (mimeType && !mimeType.includes("image")) {
        return undefined;
      }

      if (!file) {
        return undefined;
      }

      const fileStream = await normalizeToAsyncIterable(file);

      if (!fileStream) {
        return undefined;
      }

      const extension = originalName?.includes(".")
        ? originalName.split(".").pop()
        : undefined;
      const targetFilename = extension
        ? `${newFileName}.${extension}`
        : newFileName;

      const uploadedFilePaths = await uploadFile(fileStream, {
        filename: targetFilename,
        contentType: mimeType ?? "application/octet-stream",
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
    };

    const formData = await parseFormData(
      request,
      { maxFileSize },
      uploadHandler
    );

    return formData;
  } catch (cause) {
    const sizeLimitError = getMaxFileSizeExceededError(cause);

    if (sizeLimitError) {
      throw new ShelfError({
        cause,
        title: "File too large",
        message: `Image file size exceeds maximum allowed size of ${
          maxFileSize / (1024 * 1024)
        }MB`,
        additionalData: { maxFileSize },
        label,
        shouldBeCaptured: false,
      });
    }

    const nestedShelfError = findShelfErrorInCause(cause);

    throw new ShelfError({
      cause,
      message: nestedShelfError
        ? nestedShelfError.message
        : "Something went wrong while uploading the file. Please try again or contact support.",
      title: nestedShelfError?.title,
      label,
      shouldBeCaptured: nestedShelfError?.shouldBeCaptured,
    });
  }
}

/**
 * Recursively walks the `.cause` chain to find a `ShelfError`.
 *
 * Libraries like `@remix-run/form-data-parser` wrap errors in their own
 * `FormDataParseError`, hiding the nested ShelfError. This helper lets
 * callers recover the original message and `shouldBeCaptured` flag.
 */
function findShelfErrorInCause(error: unknown): ShelfError | null {
  if (isLikeShelfError(error)) {
    return error;
  }

  const cause = (error as { cause?: unknown })?.cause;

  if (!cause) {
    return null;
  }

  return findShelfErrorInCause(cause);
}

/**
 * Recursively walks the `.cause` chain to find a `MaxFileSizeExceededError`.
 *
 * `parseFormData` wraps errors, so this helper normalises the shape and lets
 * callers respond with the correct user-facing message when the underlying
 * file exceeds the configured size.
 */
function getMaxFileSizeExceededError(
  error: unknown
): MaxFileSizeExceededError | null {
  if (error instanceof MaxFileSizeExceededError) {
    return error;
  }

  const cause = (error as { cause?: unknown })?.cause;

  if (!cause) {
    return null;
  }

  return getMaxFileSizeExceededError(cause);
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
 * Normalise the various shapes `parseFormData` can hand us for file payloads
 * (Blob, File, Buffer, Node streams, async iterables) into an AsyncIterable
 * that Sharp can consume without crashing.
 */
async function normalizeToAsyncIterable(
  file:
    | AsyncIterable<Uint8Array>
    | Readable
    | Buffer
    | Blob
    | { stream?: () => any; arrayBuffer?: () => Promise<ArrayBuffer> }
    | null
    | undefined
): Promise<AsyncIterable<Uint8Array> | null> {
  if (!file) {
    return null;
  }

  if (typeof (file as any)[Symbol.asyncIterator] === "function") {
    return file as AsyncIterable<Uint8Array>;
  }

  if (file instanceof Readable) {
    return file as AsyncIterable<Uint8Array>;
  }

  if (Buffer.isBuffer(file)) {
    return (async function* bufferToIterable() {
      await Promise.resolve();
      yield file;
    })();
  }

  // Remix now uses the undici File polyfill which exposes stream()/arrayBuffer()
  if (typeof (file as Blob).stream === "function") {
    const webStream = (file as Blob).stream();
    if (typeof Readable.fromWeb === "function") {
      return Readable.fromWeb(
        webStream as any
      ) as unknown as AsyncIterable<Uint8Array>;
    }
  }

  if (typeof (file as Blob).arrayBuffer === "function") {
    const buffer = Buffer.from(await (file as Blob).arrayBuffer());
    return (async function* bufferToIterable() {
      await Promise.resolve();
      yield buffer;
    })();
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
          await delay(1000);
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
        await delay(1000);
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

    const file = await cropImage(
      (async function* webResponseToIterable() {
        await Promise.resolve();
        yield new Uint8Array(buffer);
      })(),
      resizeOptions
    );

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
  type: "locations" | "audits";
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

/**
 * Supabase can sporadically return HTML error pages (e.g., CDN/edge 50x) that the storage
 * client surfaces as StorageUnknownError due to JSON parsing. Detect that shape so callers
 * can retry once instead of immediately failing user-visible flows.
 */
function isSupabaseHtmlError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const name =
    "name" in error && typeof error.name === "string" ? error.name : "";

  // Detect JSON parse failures that typically show up when HTML is returned instead of JSON
  const lowerMessage = message.toLowerCase();
  const isJsonParseFailure =
    lowerMessage.includes("unexpected token") && lowerMessage.includes("json");
  const mentionsHtml =
    lowerMessage.includes("<html") ||
    lowerMessage.includes("html>") ||
    lowerMessage.includes("text/html");
  const isUnexpectedHtml =
    isJsonParseFailure && (mentionsHtml || lowerMessage.includes("<"));
  const isStorageUnknown =
    name === "StorageUnknownError" ||
    ("__isStorageError" in error &&
      typeof error.__isStorageError === "boolean" &&
      error.__isStorageError === true);

  return isUnexpectedHtml && isStorageUnknown;
}

/**
 * Supabase can also surface network failures as StorageUnknownError with a
 * generic "fetch failed" message. Treat those as transient for retries.
 */
function isSupabaseFetchFailedError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const name =
    "name" in error && typeof error.name === "string" ? error.name : "";

  const lowerMessage = message.toLowerCase();
  const isFetchFailed = lowerMessage.includes("fetch failed");
  const isStorageUnknown =
    name === "StorageUnknownError" ||
    ("__isStorageError" in error &&
      typeof error.__isStorageError === "boolean" &&
      error.__isStorageError === true);

  return isFetchFailed && isStorageUnknown;
}
