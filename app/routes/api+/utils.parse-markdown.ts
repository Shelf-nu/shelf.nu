import { json, type ActionFunctionArgs } from "@remix-run/node";
import { assertIsPost } from "~/utils";
import { parseMarkdownToReact } from "~/utils/md.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const formData = await request.formData();
  const markdown = formData.get("content") as string;

  return json({ content: parseMarkdownToReact(markdown) });
}
