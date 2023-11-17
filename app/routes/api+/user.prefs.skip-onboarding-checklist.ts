import { type ActionFunctionArgs, json } from "@remix-run/node";
import { userPrefs } from "~/utils/cookies.server";

export async function action({ request }: ActionFunctionArgs) {
  const cookieHeader = request.headers.get("Cookie");
  const cookie = (await userPrefs.parse(cookieHeader)) || {};
  const bodyParams = await request.formData();
  cookie.skipOnboardingChecklist =
    bodyParams.get("skipOnboardingChecklist") === "skipped";

  return json(
    { success: true },
    {
      headers: {
        "Set-Cookie": await userPrefs.serialize(cookie),
      },
    }
  );
}
