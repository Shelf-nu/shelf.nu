import { json, type ActionFunctionArgs } from "@remix-run/node";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, data, error } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md";

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
