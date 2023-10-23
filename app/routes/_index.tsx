import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { destroyAuthSession, getAuthSession } from "~/modules/auth";
import { getUserByEmail } from "~/modules/user";

export const loader = async ({ request }: LoaderFunctionArgs) => {
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
  /** Not finding user for the current session is sus
   * So we just destroy the session and redirect to /
   */
  return destroyAuthSession(request);
};
