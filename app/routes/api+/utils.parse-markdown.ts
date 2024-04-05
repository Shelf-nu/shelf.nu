import { json, type ActionFunctionArgs } from "@remix-run/node";
import { assertIsPost, data, error, makeShelfError } from "~/utils";
import { parseMarkdownToReact } from "~/utils/md.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const formData = await request.formData();
    const markdown = formData.get("content") as string;

    return json(data({ content: parseMarkdownToReact(markdown) }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
