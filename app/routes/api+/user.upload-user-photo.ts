import type { ActionArgs } from "@remix-run/node";
// import { unstable_parseMultipartFormData } from "@remix-run/node";
import { json } from "react-router";
import { assertIsPost } from "~/utils";

export const action = async ({ request }: ActionArgs) => {
  assertIsPost(request);
  try {
    const formData = await request.formData();
    const filename = formData.get("filename");

    // const formData = await unstable_parseMultipartFormData(
    //   request,
    //   uploadHandler // <-- can use this example > https://dev.to/aaronksaunders/how-to-upload-to-storage-buckets-and-write-data-with-remix-and-supabase-3l7c
    // );

    // const someData = { 1: "hello world" };
    return json({ filename });
  } catch (error) {
    return json({ error, ok: false });
  }
};
