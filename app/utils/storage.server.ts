import {
  unstable_composeUploadHandlers,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type { ResizeOptions } from "sharp";

import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { MAX_FILE_SIZE } from "./constants";
import { cropImage } from "./crop-image";
import { SUPABASE_URL } from "./env";
import type { ErrorLabel } from "./error";
import { isLikeShelfError, ShelfError } from "./error";
import { extractImageNameFromSupabaseUrl } from "./extract-image-name-from-supabase-url";
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

async function uploadFile(
  fileData: AsyncIterable<Uint8Array>,
  { filename, contentType, bucketName, resizeOptions }: UploadOptions
) {
  try {
    const file = await cropImage(fileData, resizeOptions);

    const { data, error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .upload(filename, file, { contentType, upsert: true });

    if (error) {
      throw error;
    }

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
}: {
  request: Request;
  newFileName: string;
  bucketName?: string;
  resizeOptions?: ResizeOptions;
}) {
  try {
    const uploadHandler = unstable_composeUploadHandlers(
      async ({ contentType, data, filename }) => {
        if (!contentType?.includes("image")) {
          return undefined;
        }

        const fileExtension = filename?.split(".").pop();
        const uploadedFilePath = await uploadFile(data, {
          filename: `${newFileName}.${fileExtension}`,
          contentType,
          bucketName,
          resizeOptions,
        });

        return uploadedFilePath;
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
 * Downloads and processes an image from a URL for upload
 * @param imageUrl - URL of the image to download and process
 * @param options - Upload configuration options
 * @returns Processed file path after upload
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  { filename, contentType, bucketName, resizeOptions }: UploadOptions
) {
  try {
    // Fetch the image and validate content type
    const response = await fetch(imageUrl).catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to fetch image from URL",
        additionalData: { imageUrl },
        label,
      });
    });

    if (!response.ok) {
      throw new ShelfError({
        cause: null,
        message: "Failed to fetch image from URL",
        additionalData: { imageUrl, status: response.status },
        label,
      });
    }

    const responseContentType = response.headers.get("content-type");
    if (!responseContentType?.startsWith("image/")) {
      throw new ShelfError({
        cause: null,
        message: "URL does not point to a valid image",
        additionalData: { imageUrl, contentType: responseContentType },
        label,
      });
    }

    // Get the image data as blob
    const imageBlob = await response.blob();
    if (imageBlob.size > MAX_FILE_SIZE) {
      throw new ShelfError({
        cause: null,
        message: "Image file size exceeds maximum allowed size of 8MB",
        additionalData: { imageUrl, size: imageBlob.size },
        label,
      });
    }

    // Convert to AsyncIterable<Uint8Array>
    const arrayBuffer = await imageBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    async function* toAsyncIterable(): AsyncIterable<Uint8Array> {
      // Legitimate await to satisfy the linter and ensure async behavior
      await Promise.resolve();
      yield uint8Array;
    }

    // Process image through sharp for resizing/optimization
    const file = await cropImage(toAsyncIterable(), resizeOptions);

    // Upload to Supabase
    const { data, error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .upload(filename, file, {
        contentType,
        upsert: true,
        metadata: {
          source: "url",
          originalUrl: imageUrl,
        },
      });

    if (error) {
      throw error;
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
