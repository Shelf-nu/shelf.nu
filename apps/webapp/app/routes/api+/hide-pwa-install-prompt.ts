import { type ActionFunctionArgs, data } from "react-router";
import { setCookie, installPwaPromptCookie } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";

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

    return data(payload({ success: true }), {
      headers: [setCookie(await installPwaPromptCookie.serialize(cookie))],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
