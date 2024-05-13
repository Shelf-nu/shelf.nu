import {
  unstable_composeUploadHandlers,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type { ResizeOptions } from "sharp";

import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { cropImage } from "./crop-image";
import { SUPABASE_URL } from "./env";
import type { ErrorLabel } from "./error";
import { ShelfError } from "./error";

import { extractImageNameFromSupabaseUrl } from "./extract-image-name-from-supabase-url";
import { getFileArrayBuffer } from "./getFileArrayBuffer";
import { Logger } from "./logger";

const label: ErrorLabel = "File storage";

export async function getPublicFileURL({
  filename,
  bucketName = "profile-pictures",
}: {
  filename: string;
  bucketName?: string;
}) {
  try {
    await bucketExists(bucketName);
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
  await bucketExists(bucketName);

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

async function bucketExists(bucketName: string) {
  const { error } = await getSupabaseAdmin().storage.getBucket(bucketName);

  if (error) {
    throw new ShelfError({
      label: "Storage",
      cause: null,
      message: `Storage bucket "${bucketName}" does not exist. If the issue persists, please contact administrator.`,
    });
  }
}

async function uploadFile(
  fileData: AsyncIterable<Uint8Array>,
  {
    filename,
    contentType,
    bucketName,
    resizeOptions,
    updateExisting,
  }: UploadOptions
) {
  try {
    let file = resizeOptions
      ? await cropImage(fileData, resizeOptions)
      : await getFileArrayBuffer(fileData);

    const { data, error } = updateExisting
      ? await getSupabaseAdmin()
          .storage.from(bucketName)
          .update(filename, file, { contentType, upsert: true })
      : await getSupabaseAdmin()
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
  updateExisting?: boolean;
}

export async function parseFileFormData({
  request,
  newFileName,
  bucketName = "profile-pictures",
  resizeOptions,
  updateExisting = false,
}: {
  request: Request;
  newFileName: string;
  bucketName?: string;
  resizeOptions?: ResizeOptions;
  updateExisting?: boolean;
}) {
  try {
    await bucketExists(bucketName);

    const uploadHandler = unstable_composeUploadHandlers(
      async ({ contentType, data, filename }) => {
        if (!contentType) return undefined;
        if (contentType?.includes("image") && contentType.includes("pdf"))
          return undefined;
        const fileExtension = contentType.includes("pdf")
          ? "pdf"
          : filename?.split(".").pop();

        const uploadedFilePath = await uploadFile(data, {
          filename: `${newFileName}.${fileExtension}`,
          contentType,
          bucketName,
          resizeOptions,
          updateExisting,
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
