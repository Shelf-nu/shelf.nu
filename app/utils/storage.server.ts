import {
  json,
  unstable_composeUploadHandlers,
  unstable_parseMultipartFormData,
} from "@remix-run/node";

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

  if (error) return error;

  return data.signedUrl;
}

async function uploadFile(
  fileData: AsyncIterable<Uint8Array>,
  { filename, contentType, bucketName }: UploadOptions
) {
  try {
    const file = await cropImage(fileData);

    const { data, error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .upload(filename, file, { contentType, upsert: true });

    if (!error) {
      return data.path;
    }

    throw error;
  } catch (error) {
    return { error };
  }
}

export interface UploadOptions {
  bucketName: string;
  filename: string;
  contentType: string;
}

export async function parseFileFormData({
  request,
  newFileName,
  bucketName = "profile-pictures",
}: {
  request: Request;
  newFileName: string;
  bucketName?: string;
}) {
  await requireAuthSession(request);

  const uploadHandler = unstable_composeUploadHandlers(
    // @ts-ignore
    async ({ contentType, data, filename }) => {
      const fileExtension = filename?.split(".").pop();
      const uploadedFilePath = await uploadFile(data, {
        filename: `${newFileName}.${fileExtension}`,
        contentType,
        bucketName,
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
