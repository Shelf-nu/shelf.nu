import type { LoaderArgs, LoaderFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getAuthSession } from "~/modules/auth";
import { getAuthResponseByAccessToken } from "~/modules/auth/service.server";
import { getUserByEmail } from "~/modules/user";

export const loader: LoaderFunction = async ({ request }: LoaderArgs) => {
  const authSession = await getAuthSession(request);

  // If there's no authSession, user isn't logged in. Redirect to login.
  if (!authSession) {
    return redirect("login");
  }

  const { data, error } = await getAuthResponseByAccessToken(
    authSession.accessToken
  );

  if (error || !data.user.confirmed_at) {
    return redirect("/verify-email");
  }

  const user = await getUserByEmail(authSession.email);

  // If user isn't found (this shouldn't happen if authSession exists), redirect to login.
  if (!user) {
    return redirect("login");
  }

  // Check if user has verified their email. If not, redirect to verify-email page.

  // If the user is onboarded, redirect to /assets, otherwise to onboarding.
  return redirect(user.onboarded ? "/assets" : "onboarding");
};
