import {
  json,
  unstable_composeUploadHandlers,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type { ResizeOptions } from "sharp";

import { getSupabaseAdmin } from "~/integrations/supabase";
import { requireAuthSession } from "~/modules/auth";
import { cropImage } from ".";
import { SUPABASE_URL } from "./env";

export function getPublicFileURL({
  filename,
  bucketName = "profile-pictures",
}: {
  filename: string;
  bucketName?: string;
}) {
  const { data } = getSupabaseAdmin()
    .storage.from(bucketName)
    .getPublicUrl(filename);

  return data.publicUrl;
}

export async function createSignedUrl({
  filename,
  bucketName = "items",
}: {
  filename: string;
  bucketName?: string;
}) {
  const { data, error } = await getSupabaseAdmin()
    .storage.from(bucketName)
    .createSignedUrl(filename, 604_800_000); //1 week

  if (error) throw error;

  return data.signedUrl;
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

    console.log(error);

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
  await requireAuthSession(request);
  console.log(request);

  const uploadHandler = unstable_composeUploadHandlers(
    async ({ name, contentType, data, filename }) => {
      console.log(contentType);
      console.log(name);
      console.log(typeof data);
      console.log(filename);
      if (!contentType?.includes("image")) return undefined;

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
      throw new Error("Wrong url");
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
