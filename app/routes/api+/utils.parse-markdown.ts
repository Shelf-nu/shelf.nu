import { json, type ActionFunctionArgs } from "@remix-run/node";
import { requireAuthSession } from "~/modules/auth";
import { assertIsPost } from "~/utils";
import { parseMarkdownToReact } from "~/utils/md.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requireAuthSession(request);

  const formData = await request.formData();
  const markdown = formData.get("content") as string;

  return json({ content: parseMarkdownToReact(markdown) });
}
