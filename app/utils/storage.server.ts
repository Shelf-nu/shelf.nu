import {
  json,
  unstable_composeUploadHandlers,
  unstable_parseMultipartFormData,
} from "@remix-run/node";

import { getSupabaseAdmin } from "~/integrations/supabase";
import { requireAuthSession } from "~/modules/auth";
import { cropImage } from ".";
import { createFileFromAsyncIterable } from "./create-buffer-from-async-iterable";
import { SUPABASE_URL } from "./env";

export function getPublicFileURL({
  filename,
  bucketName = "profile-pictures",
}: {
  filename: string;
  bucketName?: string;
}) {
  try {
    const { data: url } = getSupabaseAdmin()
      .storage.from(bucketName)
      .getPublicUrl(filename);

    return url.publicUrl;
  } catch (error) {
    return json({ error });
  }
}

async function uploadFile(
  data: AsyncIterable<Uint8Array>,
  { filename, contentType, bucketName = "profile-pictures" }: UploadOptions
) {
  try {
    const file = await cropImage(await createFileFromAsyncIterable(data));

    const upload = await getSupabaseAdmin()
      .storage.from(bucketName)
      .upload(filename, file, { contentType, upsert: true });

    const publicUrl = getPublicFileURL({
      filename: upload?.data?.path || "",
    }) as string;

    return publicUrl;
  } catch (error) {
    throw error;
  }
}

export interface UploadOptions {
  bucketName?: string;
  filename: string;
  contentType: string;
}

export async function parseFileFormData(request: Request) {
  const { userId } = await requireAuthSession(request);

  try {
    const uploadHandler = unstable_composeUploadHandlers(
      async ({ data, contentType }) => {
        const fileExtension = contentType.split("/")[1];
        const uploadedFileURL = await uploadFile(data, {
          filename: `${userId}/profile-${Math.floor(
            Date.now() / 1000
          )}.${fileExtension}`,
          contentType,
        });

        return uploadedFileURL;
      }
    );

    const formData = await unstable_parseMultipartFormData(
      request,
      uploadHandler
    );

    return formData;
  } catch (error) {
    throw error;
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
      throw new Error("Wrong url");
    }

    const { error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .remove([url.split(`${bucketName}/`)[1]]);

    if (error) {
      throw error;
    }
  } catch (error) {
    throw error;
  }
}
