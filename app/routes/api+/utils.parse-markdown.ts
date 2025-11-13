import { data, type ActionFunctionArgs } from "react-router";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, payload, error } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const formData = await request.formData();
    const markdown = formData.get("content") as string;

    return payload({ content: parseMarkdownToReact(markdown) });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
