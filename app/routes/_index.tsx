import type { LoaderArgs, LoaderFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getAuthSession } from "~/modules/auth";
import { getUserByEmail } from "~/modules/user";

export const loader: LoaderFunction = async ({ request }: LoaderArgs) => {

    const authSession = await getAuthSession(request);

    if (!authSession) {
      return redirect("login");
    }

    const user = authSession
    ? await getUserByEmail(authSession?.email)
    : undefined;

  if (user) {
    return redirect(user.onboarded ? "/assets" : "onboarding");
  }
  return redirect("login");
};