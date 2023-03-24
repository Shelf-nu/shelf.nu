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
    //   uploadHandler // <-- we'll look at this deeper next
    // );

    // const someData = { 1: "hello world" };
    return json({ filename });
  } catch (error) {
    return json({ error, ok: false });
  }
};
