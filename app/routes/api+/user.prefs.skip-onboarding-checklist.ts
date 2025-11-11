import { type ActionFunctionArgs, data } from "@remix-run/node";
import { setCookie, userPrefs } from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await userPrefs.parse(cookieHeader)) || {};
    const bodyParams = await request.formData();
    cookie.skipOnboardingChecklist =
      bodyParams.get("skipOnboardingChecklist") === "skipped";

    return data(payload({ success: true }), {
      headers: [setCookie(await userPrefs.serialize(cookie))],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
