import { json, type ActionArgs } from "@remix-run/node";
import { requireAuthSession } from "~/modules/auth";
import { assertIsPost } from "~/utils";
import { parseMarkdownToReact } from "~/utils/md.server";

export async function action({ request }: ActionArgs) {
  assertIsPost(request);
  await requireAuthSession(request);

  const formData = await request.formData();
  const markdown = formData.get("content") as string;

  return json({ content: parseMarkdownToReact(markdown) });
}
