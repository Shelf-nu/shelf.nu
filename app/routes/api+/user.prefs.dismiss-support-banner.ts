import { type ActionFunctionArgs, json } from "@remix-run/node";
import { data, error, makeShelfError } from "~/utils";
import { setCookie, userPrefs } from "~/utils/cookies.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const cookieHeader = request.headers.get("Cookie");
    const cookie = (await userPrefs.parse(cookieHeader)) || {};
    const bodyParams = await request.formData();

    if (bodyParams.get("bannerVisibility") === "hidden") {
      cookie.hideSupportBanner = true;
    }

    return json(data({ success: true }), {
      headers: [setCookie(await userPrefs.serialize(cookie))],
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
