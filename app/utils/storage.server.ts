import {
  json,
  unstable_composeUploadHandlers,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type { ResizeOptions } from "sharp";

import { getSupabaseAdmin } from "~/integrations/supabase";
import { requireAuthSession } from "~/modules/auth";
import { cropImage, extractImageNameFromSupabaseUrl } from ".";
import { SUPABASE_URL } from "./env";
import { ShelfStackError } from "./error";
import { getFileArrayBuffer } from "./getFileArrayBuffer";

export function getPublicFileURL({
  filename,
  bucketName = "profile-pictures",
}: {
  filename: string;
  bucketName?: string;
}) {
  bucketExists(bucketName);

  const { data } = getSupabaseAdmin()
    .storage.from(bucketName)
    .getPublicUrl(filename);

  return data.publicUrl;
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
      .createSignedUrl(filename, 86_400_000); //24h

    if (error) throw error;

    return data.signedUrl;
  } catch (error) {
    return new ShelfStackError({
      message:
        "Something went wrong with updating your image. Please refresh the page. If the issue persists contact support.",
    });
  }
}

async function bucketExists(bucketName: string) {
  const { error } = await getSupabaseAdmin().storage.getBucket(bucketName);

  if (error) {
    throw new ShelfStackError({
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
  } catch (error) {
    /** We have to return null as thats what composeUploadHandlers expects
     * also we have to use try/catch. If i dont use it i get an error
     */
    return null;
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
  await requireAuthSession(request);
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
      throw new ShelfStackError({ message: "Wrong url" });
    }

    const { error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .remove([url.split(`${bucketName}/`)[1]]);

    if (error) {
      throw error;
    }
  } catch (error) {
    return json({ error });
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
      throw new ShelfStackError({ message: "Cannot find image" });
    }

    const { error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .remove([path]);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    return { error };
  }
}
