import { type ActionFunctionArgs, json } from "@remix-run/node";
import { setCookie, installPwaPromptCookie } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { data, error } from "~/utils/http.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await installPwaPromptCookie.parse(cookieHeader)) || {};
    const bodyParams = await request.formData();

    if (bodyParams.get("pwaPromptVisibility") === "hidden") {
      cookie.hidden = true;
    }

    return json(data({ success: true }), {
      headers: [setCookie(await installPwaPromptCookie.serialize(cookie))],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
