import {
  json,
  unstable_composeUploadHandlers,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { getSupabaseAdmin } from "~/integrations/supabase";
import { requireAuthSession } from "~/modules/auth";
import { createFileFromAsyncIterable } from "./create-buffer-from-async-iterable";

export function getPublicFileURL(filePath: string, bucketName: string) {
  try {
    const { data: url } = getSupabaseAdmin()
      .storage.from(bucketName)
      .getPublicUrl(filePath);

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
    const file = await createFileFromAsyncIterable(data);

    const d = await getSupabaseAdmin()
      .storage.from(bucketName)
      .upload(filename, file, { contentType, upsert: true });

    return d?.data?.path;
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
      async ({ name, data, contentType }) => {
        const fileExtension = contentType.split("/")[1];
        const uploadedFileURL = await uploadFile(data, {
          filename: `${userId}/profile.${fileExtension}`,
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
